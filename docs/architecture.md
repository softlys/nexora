# Architecture

## Layers

```
src/
  app/            Next.js routes: pages (server components), client components, route handlers (/api)
  components/     UI primitives (shadcn/ui on tokens), patterns, CRM forms, charts, integrations
  domain/         Pure TypeScript: entities, permissions, metrics, automation schema and logic,
                  security event schema and hash chain, API contract and OpenAPI, webhooks (sign/verify),
                  SSRF policy, design token conversion, seed data
  server/
    services/     Domain services: every read and write, with permission checks and events
    db/           Tx abstraction: demo store adapter and Supabase adapter
    automation/   Engine, scheduler, runtime wiring
    integrations/ Secret encryption, SSRF-safe transport, webhook delivery and retries
    api/          /api/v1 pipeline (auth, scopes, validation, idempotency) and handlers
    actions/      Server actions ("use server"): thin wrappers around services
    security/     Origin check, rate limiter, validation log, security event recording
supabase/migrations/  Schema, RLS, functions
tests/unit, tests/e2e
```

Rules:
- `src/domain` does not import from `src/server` or React.
- Components never import services directly; they call server actions.
- Every write goes through a service.

## Request lifecycle

**Server action (browser)**
1. `serviceAction` checks the `Origin` header, loads the session (actor = user, organization, role, team) and applies the per-user rate limit.
2. It parses input with a strict Zod schema; unknown fields are rejected.
3. It calls a service. The service checks `can()` or scope, opens a unit of work (`db.write(orgId, tx => …)`) and emits domain events.
4. Event bus subscribers run inside the unit of work:
   - `audit-log` writes domain events to `audit_logs`, with field-level diffs.
   - `security-log` appends security events to the hash chain.
   - `automation-queue` collects trigger events.
5. After the commit, the queued security events (raised by failed checks) are flushed, and `dispatchAutomations` runs matching workflows.
6. Errors are mapped to safe messages carrying a request id.

**Public API (`/api/v1`)**
1. `apiRoute` resolves the key by its SHA-256 hash. It rejects revoked keys and keys whose creator is disabled, checks the scope and applies the per-key rate limit.
2. It parses query and body with the contract schemas and applies `Idempotency-Key`.
3. It calls the same services as the UI, with the key creator as actor and the key id in the request meta.
4. The rest matches the server action path: events, automations, then `{ data }` or `{ error }`.

## Data access

`Tx` is bound to one organization; every query is filtered by it.

| Adapter | How it works |
| --- | --- |
| Demo | Runs a write against a copy of the dataset and commits only on success, through a serialized queue. Reads return copies of rows. |
| Supabase | Runs as the signed-in user (RLS applies). Automation, the security log, API key lookup and webhook deliveries use the service-role client, always scoped to one organization by the server. |

Invariants such as one order per deal, one lead conversion, idempotency keys and the security event sequence are enforced by unique constraints in both adapters.

## Events and engines

| Engine | Owns | Triggered by |
| --- | --- | --- |
| Automation engine (`src/server/automation`) | Changes to NEXORA data: tasks, owners, notifications, orders, activities, email | Domain events after commit; scheduler (date triggers, delays); `POST /api/v1/events` (`webhook.received`) |
| Outbound webhooks (`src/server/integrations`) | Telling external systems | Every event the engine handles (`onEvent`), sent after the response; retries from the scheduler |
| Make / n8n | Fan-out to SaaS tools, custom logic | Signed webhooks; they call back through the public API |

**Idempotency strategy, end to end.** Each layer deduplicates on its own key:

| Layer | Key |
| --- | --- |
| Workflow runs | `workflow_id:event_id` (unique) |
| Webhook deliveries | Once per integration and outbound `event_id`; retries and redeliveries reuse it |
| Receivers | Expected to deduplicate on `event_id` |
| Callbacks into NEXORA | Use `Idempotency-Key`, typically the received `event_id` |
| Side effects | Their own unique keys: one order per deal, notification dedupe keys |

## Security model

See [security.md](security.md):
- one permission matrix, enforced in services and again by RLS
- 404 for out-of-scope records
- strict schemas
- Origin checks
- rate limits
- a hash-chained security log ([security-events.md](security-events.md)) read by the companion SIEM through the security API

## Key decisions

- **One repository/Tx layer with two adapters.** Demo mode needs no credentials and behaves like the database (copies, unique constraints, rollback), so the same services and tests cover both.
- **Workflows are data.** JSON validated by strict schemas, with no code execution. That makes the automation engine safe to expose to managers.
- **Automations run after commit; webhooks run after the response.** A user action never fails because a workflow or a receiver failed, and slow receivers never delay the UI.
- **The API contract drives the OpenAPI document.** Zod schemas are converted with `z.toJSONSchema`, so the spec cannot fall out of date.
- **Secrets.** API keys are hashed. Integration signing secrets are encrypted, because HMAC signing needs the secret itself. Both are shown once.
- **No Cache Components.** Every page depends on the session and role, so pages render per request.
