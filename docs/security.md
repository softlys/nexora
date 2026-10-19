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

## Headers

`next.config.ts` sets `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` and a restrictive `Permissions-Policy`, and removes `X-Powered-By`.
