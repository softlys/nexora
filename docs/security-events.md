# Security events

NEXORA writes a dedicated, tamper-evident security log in the `security_events` table. It is the contract with the companion SIEM, VIGIL, which copies this schema, ingests the events and re-verifies the chain. The source of truth is `src/domain/security/events.ts`, and the tests are in `tests/unit/security-events.test.ts`.

Domain changes such as "deal updated" go to `audit_logs`. Security-relevant facts go here: authentication, authorization failures, configuration changes, automation changes, suspicious data access and system health.

## Schema

The field names follow the Elastic Common Schema, flattened for a relational table.

| Field | Type | Notes |
| --- | --- | --- |
| `event_id` | uuid | Unique per event. |
| `organization_id` | uuid | Tenant. Each organization has its own chain. |
| `sequence` | integer ≥ 1 | Per organization, gap-free. `unique (organization_id, sequence)`. |
| `occurred_at` | ISO 8601 with offset | When it happened, in server time. |
| `category` | enum | `authentication`, `authorization`, `configuration`, `data_access`, `integration`, `automation`, `system`. Derived from the action. |
| `action` | enum | See the catalog below. Form: `area.verb`. |
| `outcome` | enum | `success`, `failure`, `unknown`. Defaults from the catalog and can be overridden per event. |
| `severity` | enum | `info`, `low`, `medium`, `high`. Defaults from the catalog and can be overridden per event. |
| `actor` | object | One of `{type:"user", user_id, role}`, `{type:"api_key", api_key_id}`, `{type:"service", name}` or `{type:"anonymous"}`. |
| `source` | object | `{ip, user_agent, request_id}`. Each field may be null. |
| `target` | object | `{type, id}`, for example `{type:"workflow", id:"…"}`. Both may be null. |
| `metadata` | object | Event-specific details, passed through redaction. |
| `prev_hash` | hex(64) | `hash` of the previous event in the chain, or 64 zeros for the first event. |
| `hash` | hex(64) | See below. |

Every row is validated against `securityEventSchema`, a strict Zod schema, both on write and on verification.

## Hash chain

```
hash = SHA-256( prev_hash + canonicalJson(event without prev_hash and hash) )
```

`canonicalJson` sorts object keys recursively, adds no whitespace, drops `undefined` and turns `undefined` array items into `null`. It is byte-for-byte deterministic, so any implementation (VIGIL, a Python script) can recompute the hash.

`verifySecurityLogChain(events)` walks one organization's events in `sequence` order and reports the first problem:

| Reason | Meaning |
| --- | --- |
| `schema_invalid` | A row does not match the schema. |
| `sequence_gap` | A sequence number is missing (deleted event) or duplicated. |
| `prev_hash_mismatch` | An event does not point at its predecessor (inserted or reordered event). |
| `hash_mismatch` | An event's content changed after it was written. |

Admins can run the check in **Settings → Security log**, using the **Verify now** button. The result is shown in the UI. The check is read-only.

### Write path

- **Demo mode.** The JSON store seals each event onto the last event of the organization inside the serialized write queue.
- **Supabase mode.** Events are written with the service-role client (`src/server/supabase/service.ts`, server-only). The writer reads the last `(sequence, hash)`, seals the event and inserts it. When two writers race, the unique `(organization_id, sequence)` constraint rejects one with `23505`, and that writer reloads the tail and retries.
- The table has no `update` or `delete` grants, and RLS lets admins read their own organization only. The chain still makes tampering by the database owner detectable.

### What the chain does not prove

The chain proves that the stored sequence was not edited in place. It cannot prove that the *newest* events were not truncated. That is why VIGIL stores the last verified `(sequence, hash)` per organization and alerts when NEXORA later reports a shorter or different chain. The scheduler also writes a `system.heartbeat` every five minutes, so a silent gap shows up as a missing heartbeat.

## Redaction

`redact()` runs over `metadata` before sealing:

- Keys matching `secret|password|passwd|token|api_key|authorization|cookie|signature|credential|private` (any case) become `"[redacted]"`.
- Strings longer than 500 characters are truncated with `…`.
- Arrays and objects are capped at 50 entries, and nesting is capped at depth 4.

Callers never pass request bodies. A failed login stores `account_key`, the first 24 hex characters of SHA-256 of the lower-cased email. It does not store the email itself, so VIGIL can count attempts per account without seeing the address.

## Action catalog

| Action | Category | Default outcome | Default severity | Emitted when |
| --- | --- | --- | --- | --- |
| `auth.login_succeeded` | authentication | success | info | Supabase sign-in succeeded. |
| `auth.login_failed` | authentication | failure | low | Supabase sign-in failed (metadata: `account_key`, `reason`). |
| `auth.demo_user_switched` | authentication | success | info | The demo user switcher changed the acting user. |
| `authz.denied` | authorization | failure | medium | Out-of-scope record, forbidden action or forbidden field. `reason`: `not_visible`, `not_permitted`, `forbidden_field`. |
| `validation.failed` | data_access | failure | low | Invalid input, aggregated to at most one event per user and action per minute (`count`). |
| `rate_limit.exceeded` | system | failure | medium | A rate-limit bucket overflowed (once per window). |
| `record.owner_changed` | data_access | success | info | A record was reassigned (`from`, `to`). |
| `data.bulk_read` | data_access | success | medium | One user read more than `NEXORA_BULK_READ_THRESHOLD` records (default 300) within 5 minutes. |
| `role.changed` | configuration | success | high | An admin changed a user's role (`from`, `to`). |
| `user.invited` | configuration | success | medium | An admin invited a user (Supabase mode). |
| `user.disabled` / `user.enabled` | configuration | success | high / medium | An admin disabled or re-enabled a user. |
| `pipeline.stages_changed` | configuration | success | low | Pipeline stages were added, edited or reordered. |
| `settings.changed` | configuration | success | medium | Organization settings changed (`fields`). |
| `workflow.created` / `workflow.updated` | automation | success | medium | An automation was created or a new version saved. |
| `workflow.enabled` / `workflow.disabled` | automation | success | medium / low | An automation was switched on or off (archiving also emits `workflow.disabled` with `archived: true`). |
| `workflow.limit_exceeded` | automation | failure | high | A run hit a guardrail: `runs_per_minute` or `step_timeout`. |
| `cron.unauthorized` | system | failure | high | The scheduler endpoint was called without the right secret. |
| `demo.reset` | system | success | medium | An admin reset the demo dataset. |
| `system.heartbeat` | system | success | info | The scheduler ran (at most every five minutes). |

| `api_key.created` | configuration | success | medium | An admin created an API key (`kind`, `prefix`, `scopes`; never the key). |
| `api_key.revoked` | configuration | success | medium | A key was revoked in Settings or by the SIEM (`via`, `reason`). |
| `api_key.used_after_revoke` | authentication | failure | high | A revoked key was presented to the API. |
| `api.auth_failed` | authentication | failure | medium | A known key prefix with a wrong secret, or a key whose creator is disabled (`reason`). |
| `api.scope_denied` | authorization | failure | medium | A key called an endpoint outside its scopes (`required`, `scopes`). |
| `integration.changed` | configuration | success | medium | An integration was created, updated, had its secret rotated, or was disconnected (`change`, `domain`). |
| `integration.webhook_sent` | integration | success / failure | info | An outbound webhook attempt got an HTTP response (`domain`, `event_type`, `event_id`, `attempt`, `status_code`). |
| `webhook.signature_invalid` | integration | failure | high | A callback to `POST /api/v1/events` carried an invalid integration signature. |
| `security.ssrf_blocked` | integration | failure | high | A webhook URL resolved to, or pointed at, a private, loopback, link-local or metadata address, or redirected to another host (`host`, `reason`, `stage`). |

Events caused by an API request have the actor `{ "type": "api_key", "api_key_id": … }`. Automation runs started by an API request stay `{ "type": "service" }` and carry `caused_by_api_key_id` in their metadata.

VIGIL reads the log through `GET /api/v1/security-events` with a SIEM key (see [api.md](api.md#security-api-siem)).

## Rules VIGIL can build on

- Brute force: many `auth.login_failed` events for one `account_key`, or for one `source.ip`, within a short window.
- Privilege escalation: `role.changed` to `admin` outside business hours, or by an admin created recently.
- Scraping: `data.bulk_read`, or repeated `authz.denied` with `reason = not_visible` (id guessing).
- Automation tampering: `workflow.updated` followed by `workflow.enabled` and `integration.webhook_sent` to a new `domain`.
- Key abuse: `api_key.used_after_revoke`, bursts of `api.scope_denied`, or `api.auth_failed` for one prefix.
- Exfiltration attempts: `security.ssrf_blocked`, `webhook.signature_invalid`.
- Liveness: no `system.heartbeat` for more than 15 minutes, or a broken chain.
