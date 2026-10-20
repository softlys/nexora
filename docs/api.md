# Public API

NEXORA exposes a REST API at `/api/v1`. The machine-readable contract is the OpenAPI 3.1 document at `/api/v1/openapi.json`. It is generated from the same Zod schemas the route handlers validate with (`src/domain/api/contract.ts`), so the document cannot drift from the code. The app also renders a reference page at **Integrations → API reference** (`/integrations/api`).

## Authentication

1. An admin creates a key in **Settings → API keys**, choosing a kind and scopes.
2. The key is shown **once**. NEXORA stores only its SHA-256 hash and a short prefix, which identifies the key in the UI and in logs.
3. Clients send it as a bearer token:

```http
Authorization: Bearer nxk_int_ab12cd34_…
```

A key acts **with the permissions of the admin who created it, limited by its scopes**. If that user is later disabled or demoted, the key stops working or sees less. Revoked keys fail immediately, and any further use is logged as `api_key.used_after_revoke`.

| Kind | Scopes | Used by |
| --- | --- | --- |
| Integration (`nxk_int_…`) | `leads:write`, `records:read`, `events:write` | Website forms, Make, n8n |
| SIEM (`nxk_siem_…`) | `security:read`, `security:respond` | VIGIL or another SIEM |

The two kinds cannot share scopes: an integration key can never read the security log or disable users.

## Conventions

- **Success:** `{ "data": …, "meta": … }`. Lists add `meta: { page, per_page, total, page_count }`.
- **Errors:** `{ "error": { "code", "message", "details"?, "request_id" } }`. `details` lists `{ path, message }` per invalid field.
- **Strict input:** unknown fields are rejected (`validation_failed`). Bodies are limited to 64 KB.
- **Idempotency:** POST endpoints accept `Idempotency-Key` (1–200 characters).
  - The same key with the same body returns the stored response for 24 hours, with the header `Idempotent-Replayed: true`.
  - The same key with a different body returns 409 `idempotency_key_reused`.
  - A key still being processed returns 409 `idempotency_in_progress`.
  - Server errors (5xx) free the key, so the request can be retried.
- **Rate limits:** 120 requests per minute per key (429 `rate_limited` with `Retry-After`). Failed authentication is limited to 20 per minute per client IP. The limiter is in memory, so a multi-instance deployment needs a shared store; see [deployment.md](deployment.md).
- **Tracing:** every response carries `X-Request-Id`. The same id appears in server logs and in security events.

## Endpoints

| Method | Path | Scope | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | none | Liveness check |
| POST | `/leads` | `leads:write` | Submit a lead (source `api`). Runs the New lead automations. |
| GET | `/companies`, `/contacts`, `/deals`, `/orders` | `records:read` | Paginated lists (`page`, `per_page` ≤ 100, `q`) |
| POST | `/events` | `events:write` | External workflow event → `webhook.received` workflows |
| POST | `/test-event` | `events:write` | Checks the key and echoes the body; nothing is stored |
| GET | `/security-events` | `security:read` | Hash-chained security log, cursor by sequence number |
| POST | `/security-actions/revoke-api-key` | `security:respond` | Incident response: revoke a key (reason required) |
| POST | `/security-actions/disable-user` | `security:respond` | Incident response: disable a user (reason required) |
| GET | `/openapi.json` | none | OpenAPI 3.1 document |

### Submit a lead

```bash
curl -X POST "$NEXORA_URL/api/v1/leads" \
  -H "Authorization: Bearer $NEXORA_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: form-2026-10-22-0042" \
  -d '{"title":"Conveyor retrofit, line 3","company_name":"Example Logistics GmbH","contact_name":"Alex Example","email":"alex@example.com","country":"DE","estimated_value":48000,"message":"Please call back this week."}'
```

The lead is created unassigned with status `new`. The enabled **New lead** workflow then runs after the request commits. It assigns an owner by country, falling back to round robin, and creates the follow-up task. The response returns the lead as created, so `owner_id` is still null.

### Send an external event

```bash
curl -X POST "$NEXORA_URL/api/v1/events" \
  -H "Authorization: Bearer $NEXORA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"event_type":"make.lead_notified","entity":"lead","record_id":"<lead id>","data":{"channel":"slack"}}'
```

The endpoint raises `webhook.received`, which runs workflows whose trigger has the same `event_type` and entity. The response reports `workflows_matched`. `entity` and `record_id` go together, and the record must exist and be visible to the key's owner (otherwise 404). `data` is limited to 16 KB.

**Optional signature check.** A Make or n8n callback can prove it holds an integration's signing secret by sending two headers:
- `X-Nexora-Integration: make` (or `n8n` / `generic_webhook`)
- `X-Nexora-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`

A wrong or stale signature (older than 5 minutes) returns 401 `signature_invalid` and records `webhook.signature_invalid`.

### Security API (SIEM)

```bash
curl "$NEXORA_URL/api/v1/security-events?after_sequence=0&limit=500" -H "Authorization: Bearer $NEXORA_SIEM_KEY"
```

Events come in sequence order, with `prev_hash` and `hash`, so the reader can verify the chain itself ([security-events.md](security-events.md)). Continue with `after_sequence = meta.next_after_sequence` while `meta.has_more` is true. `meta.last_sequence` is the current head of the chain.

Both response actions:
- require a `reason` of at least 3 characters
- write `audit_logs`
- emit a security event (`api_key.revoked` or `user.disabled`, with `via: "siem"`)

`disable-user` refuses to disable the last active admin (409), and `revoke-api-key` refuses to revoke the calling key.

## Errors

| HTTP | Code | When |
| --- | --- | --- |
| 400 | `validation_failed`, `invalid_json` | Body or query does not match the schema |
| 401 | `unauthorized` | Missing, malformed, unknown or revoked key, or the key's creator was disabled |
| 401 | `signature_invalid` | Integration signature does not verify |
| 403 | `insufficient_scope` | The key lacks the scope (`api.scope_denied` is recorded) |
| 403 | `forbidden` | The key owner's role does not allow the action |
| 404 | `not_found` | Missing or out-of-scope record (the two look the same on purpose) |
| 409 | `conflict`, `idempotency_key_reused`, `idempotency_in_progress` | State conflict or idempotency mismatch |
| 413 | `payload_too_large` | Body larger than 64 KB |
| 429 | `rate_limited` | Rate limit exceeded |
| 500 | `internal_error` | Unexpected; quote the `request_id` |

## Security events raised by the API

These security events are recorded for API activity: `api_key.created`, `api_key.revoked`, `api_key.used_after_revoke`, `api.auth_failed`, `api.scope_denied`, `webhook.signature_invalid`, `validation.failed` and `rate_limit.exceeded`. Events caused by an API request carry the actor `{ type: "api_key", api_key_id }`, and the related audit log rows include `via_api_key_id`.

A wrong secret with a known key prefix is logged to that organization as `api.auth_failed` (reason `wrong_secret`). Completely unknown keys belong to no organization, so they are written to the server log only.
