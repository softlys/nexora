# Security model

This document covers roles, the permission matrix and how it is enforced. It grows with each phase.

## Principles

1. **One permission matrix.** `src/domain/permissions.ts` defines what each role may do. Every server action, page guard and repository query asks `can()` or `visibleOwnerIds()`.
2. **The client is never trusted.** Organization and user always come from the server-side session. Hidden navigation is a convenience, not a boundary: opening a URL directly is refused by the same check (403 page).
3. **Defense in depth.** In Supabase mode, row-level security in PostgreSQL enforces the same matrix again, so a bug in application code cannot leak another team's data. A unit test (`tests/unit/database.test.ts`) runs the real migrations on PostgreSQL (PGlite) and checks that RLS returns exactly the rows the TypeScript matrix allows, for every demo user.
4. **Strict input.** Mutation inputs are Zod `.strict()` schemas; unknown fields (for example `role` or `organization_id`) are rejected.
5. **Safe errors.** Users see a generic message with a short reference; details go to server logs.

## Roles

| Role | Scope |
| --- | --- |
| `sales_rep` | Records they own (`owner_id`, or `assignee_id` for tasks). |
| `manager` | Their own records plus records owned by profiles whose `manager_id` is the manager. |
| `admin` | Everything in the organization. |

## Permission matrix

`own` / `team` / `all` = scope of records; `—` = not allowed.

| Resource | Action | Admin | Manager | Sales Rep |
| --- | --- | --- | --- | --- |
| Companies, contacts, leads, deals, orders, tasks | view, create, update, archive | all | team | own |
| Same | hard delete | all | — | — |
| Payments (simulated) | view, record | all | team | own |
| Activities | view, log | all | team | own |
| Products | view | all | all | all |
| Products | create, update, archive | all | all | — |
| Pipeline stages | view | all | all | all |
| Pipeline stages | rename, reorder, flags | all | — | — |
| Organization settings | update | all | — | — |
| Team | view | all | all | — |
| Team | change roles | all | — | — |
| Own profile | update name, title | own | own | own |
| Automation workflows | view, create, update, enable | all | all | — |
| Integrations | view | all | all | — |
| Integrations, API keys | manage | all | — | — |
| Audit log | view | all | — | — |
| Demo data | reset | all | — | — |
| Notifications | read, mark read | own | own | own |
| Analytics | view | all | team | own |

## Row-level security (Supabase mode)

Defined in `supabase/migrations/20261019000002_row_level_security.sql`.

- Helper functions in the non-exposed `private` schema resolve the caller's organization, role and visible owner ids from `auth.uid()`.
- Owned tables (companies, contacts, leads, deals, orders, tasks): select, insert and update require the same organization and an owner inside the caller's scope. The `with check` clause stops a sales rep from reassigning a record to someone outside their scope. Delete is admin-only.
- Child tables (order items, payments, stage history) follow the visibility of their parent record. Payments are append-only for non-admins.
- Activities and comments are visible when the author is in scope or the linked record is visible.
- Profiles: only `full_name` and `title` are updatable through column grants; roles change only through `change_profile_role()`, which also refuses to remove the last admin.
- Pipeline stages: read-only for the client role; writes go through admin-only functions that keep exactly one won and one lost stage.
- Notifications: only the recipient can read them and mark them read (`read_at` is the only writable column).
- API key hashes and integration secret hashes are excluded from the client role by column grants.
- Audit log: insert-only for the caller's own entries, readable by admins, no update or delete.
- The `anon` role has no table access.

## Demo mode

- No login. The acting user is stored in an `httpOnly`, `SameSite=Lax` cookie signed with HMAC-SHA256. A tampered cookie is ignored and the session falls back to the admin user.
- The signing secret comes from `NEXORA_SESSION_SECRET`, or is generated once and stored in `.data/session-secret` (git-ignored).
- The user switcher lets anyone act as any demo user. That is the point of a demo, so **demo mode must not hold real data**.
- Data lives in `.data/demo.json` on the server, never in browser storage. On serverless hosts the file system is not persistent, so demo changes can be lost on a cold start.
- Server code enforces the same permission matrix in demo mode as in Supabase mode.

## CRM security controls (phase 2)

Every CRM mutation goes through `serviceAction` (`src/server/service-action.ts`) and a service in `src/server/services`.

| Threat | Control | Where |
| --- | --- | --- |
| Tenant mixing | Organization and actor come only from the server session. Every `Tx` is bound to one organization and filters every read and write by it. SQL uses composite tenant foreign keys and RLS. | `src/server/db`, migrations |
| IDOR (guessing ids) | `getVisible()` loads by id **and** checks the actor's scope. A record outside the scope returns the same 404 as a missing one and records `authz.denied` (reason `not_visible`). Links to other records (task → deal, activity → company, …) are checked the same way, so they cannot be used to probe ids. | `src/server/services/context.ts`, `records.ts` |
| Mass assignment | All inputs are Zod `.strict()` schemas. `organization_id`, ids, stage history, totals, payment status, `is_simulated` and timestamps are never accepted. `owner_id` is accepted only where reassignment exists, and `resolveOwner()` refuses it for sales reps and outside a manager's team (`authz.denied`, reason `forbidden_field`). A sales rep cannot change the amount or currency of a won deal. | `src/domain/inputs.ts`, services |
| XSS | Notes, comments, descriptions and activity bodies are plain text rendered as React text with `white-space: pre-wrap`. No `dangerouslySetInnerHTML` anywhere. External links are http(s) only and open with `rel="noopener noreferrer"`. Notification links must be internal paths. | `src/components/crm/*` |
| Injection | No SQL is built from strings: the demo adapter filters in memory and the Supabase adapter uses the query builder (parameterized). Search input is capped at 100 characters; `escapeLike()` exists for any future `ILIKE` use. | `src/domain/list.ts` |
| CSRF / cross-site calls | `serviceAction` checks that `Origin` matches the host on every mutation (in addition to Next.js's own Server Action check). `NEXORA_ALLOWED_ORIGINS` adds trusted origins. | `src/server/security/origin.ts` |
| Enumeration and scraping | Per-user rate limits: search 30/min, create 60/min, other mutations 240/min (`rate_limit.exceeded`, once per window). List page size is capped at 100. In Supabase mode the counters are shared by every instance (PostgreSQL `public.hit_counter`); demo mode counts in memory. Client IPs come from `X-Forwarded-For` only as far as `NEXORA_TRUSTED_PROXY_HOPS` proxies vouch for them. | `src/server/security/rate-limit.ts`, `src/server/security/client-ip.ts` |
| Information leaks in errors | Users see generic messages with a short reference; details are logged with the request id. | `serviceAction`, `error.tsx` |
| Destructive actions | Archive (anyone with edit rights) and restore are confirmed in the UI; permanent delete is admin-only and the audit entry keeps a copy of the deleted row. | `src/server/services/records.ts` |
| Repudiation | Every change emits a typed domain event; the audit subscriber stores actor, role, action, target, field-level before/after, IP, user agent, request id and time. | `src/domain/events`, `audit_logs` |

### Security events

Emitted through the same event bus as domain events (`src/domain/events/types.ts`) and stored in the dedicated, hash-chained `security_events` log (phase 3). The full schema, chain and action catalog are in [security-events.md](security-events.md).

| Event | When |
| --- | --- |
| `authz.denied` | A record outside the actor's scope was requested, an action was not permitted, or a forbidden field change was attempted. Reason: `not_visible`, `not_permitted` or `forbidden_field`. |
| `validation.failed` | Invalid input. Aggregated: at most one event per user and action per minute, carrying the failure count. |
| `rate_limit.exceeded` | A user exceeded a rate-limit bucket. Once per window. |
| `record.owner_changed` | A record was reassigned. |

Security events raised inside a unit of work are queued and written after it finishes, even when the operation itself fails.

Supabase mode note: RLS hides out-of-scope rows entirely, so a guessed id looks exactly like a missing one. The 404 behavior is identical, but `authz.denied` with reason `not_visible` is only recorded in demo mode.

## Security telemetry and automation (phase 3)

| Concern | Control | Where |
| --- | --- | --- |
| Tampering with the security log | `security_events` is a per-organization hash chain (SHA-256 over canonical JSON, gap-free sequence). No update or delete grants; admins read it through RLS. **Settings → Security log** verifies the chain on demand. | `src/domain/security/events.ts`, [security-events.md](security-events.md) |
| Secrets in logs | Metadata is redacted before sealing (secret-looking keys, long strings, deep nesting). Failed logins store a truncated hash of the email, not the email. | `redact()` |
| Scraping | `data.bulk_read` when one user reads more than `NEXORA_BULK_READ_THRESHOLD` records in 5 minutes. | `trackRead()` in `src/server/services/context.ts` |
| Automation as an escalation path | Workflows are JSON validated by strict schemas: no code evaluation, allowlisted variables and fields only, no step that touches roles, permissions, keys or integrations. Only admins and managers edit them; every change is audited and emits `workflow.*` security events. | `src/domain/automation`, [automation-guide.md](automation-guide.md) |
| Runaway automations | 20 steps, 30 runs per workflow per minute, 5 s step timeout, causation depth 3, no self-retrigger, idempotency key per workflow and event (`workflow.limit_exceeded`). | `src/server/automation/engine.ts` |
| Unauthenticated scheduler calls | `/api/cron/scheduler` is disabled without `CRON_SECRET` (16+ characters), compares the bearer token in constant time and logs `cron.unauthorized`. | `src/app/api/cron/scheduler/route.ts` |

## Integrations and public API (phase 4)

| Concern | Control | Where |
| --- | --- | --- |
| Stolen API keys | Keys are random 256-bit secrets shown once and stored as SHA-256 hashes. Each key carries scopes, and acts as its creator: a disabled creator disables the key, a demoted creator narrows it. Revocation is immediate; later use is logged as `api_key.used_after_revoke`. | `src/domain/api/keys.ts`, `src/server/api/handler.ts` |
| Privilege separation | Integration keys (`leads:write`, `records:read`, `events:write`) and SIEM keys (`security:read`, `security:respond`) are separate kinds with disjoint scopes. | `SCOPES_BY_KIND` |
| Abuse of the API | Strict Zod schemas (unknown fields rejected), 64 KB body limit, per-key rate limit (120/min), per-IP limit on failed authentication (20/min), `Idempotency-Key` for POST. | `src/domain/api/contract.ts` |
| Forged webhooks | Every outbound request is signed: `X-Nexora-Signature: t=…,v1=HMAC-SHA256(secret, "t.body")`. Receivers reject stale timestamps (5 min). Callbacks into `POST /events` can be signed the same way. | `src/domain/integrations/webhooks.ts` |
| SSRF through webhook URLs | URLs must be https in production, without credentials or internal hostnames. DNS is resolved in the socket's lookup hook, and every address is checked against private, loopback, link-local, CGNAT, multicast, documentation and metadata ranges (IPv4 and IPv6, including mapped addresses). The check runs both when the URL is saved and at connection time, which closes the DNS-rebinding window. Redirects are followed only to the same host (at most 2). Responses are capped at 64 KB, with a 5 s timeout. Every block raises `security.ssrf_blocked`. | `src/domain/integrations/ssrf.ts`, `src/server/integrations/transport.ts` |
| Secret exposure | Signing secrets are encrypted at rest (AES-256-GCM, `NEXORA_ENCRYPTION_KEY`) because HMAC needs the secret itself. They are shown once, then masked to the last four characters. Column grants hide the hash and ciphertext from the client role. | `src/server/integrations/secret-box.ts`, migration `20261022000001` |
| Incident response | The SIEM can revoke keys and disable users through `security:respond`. Both require a reason, write `audit_logs` and a security event, and can never disable the last active admin. | `src/server/services/api-keys.ts` |
| Repudiation | API keys, integration settings, secret rotation and disconnects are written to `audit_logs`. Changes made through the API carry `via_api_key_id`. | services |

### Service role

In Supabase mode the server uses the service-role key (`SUPABASE_SERVICE_ROLE_KEY`, server-only, `src/server/supabase/service.ts`) for these things only:
- automation runs, which need to see records outside the triggering user's RLS scope (for example, managers to notify)
- appending to the security log, which must also work for anonymous events such as failed logins
- sending member invites
- the public API, which has no user session: the key is resolved by its hash, and every query is then scoped to that key's organization and filtered by its creator's permissions in the services
- webhook deliveries and their retries

Every user-facing read and write still goes through the anon key and the user's session, so it remains subject to RLS. Service-role code paths are scoped to one organization by the `Tx` and never accept an organization id from the client.

## Headers

`next.config.ts` sets `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` and a restrictive `Permissions-Policy`, and removes `X-Powered-By`.
