# NEXORA build progress

The project is built in four phases (plus a separate companion app, VIGIL). Each phase starts by reading this file and ends by updating it.

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Foundation: shell, design system, data model, seed, demo mode, roles, base settings | Done |
| 2 | CRM core: companies, contacts, leads, deals, pipeline, orders, tasks, search, security hardening | Not started |
| 3 | Dashboard, analytics, automation engine, security telemetry | Not started |
| 4 | Integrations, public API, UI kit, documentation, release | Not started |

---

## Phase 1: Foundation (2026-10-19)

### Done

- **Project setup.** Next.js 16 (App Router, Turbopack), React 19, TypeScript strict, Tailwind CSS 4, shadcn/ui (Radix, restyled), Lucide, Recharts, React Hook Form + Zod 4, dnd-kit, Supabase JS/SSR, Vitest, Playwright. Scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:e2e`, `demo:seed`, `demo:reset`, plus `supabase:seed` and `tokens:build`. `.gitignore`, `.env.example` (every variable commented), MIT `LICENSE`, README skeleton.
- **Design system.** `tokens/tokens.json` is the single source of truth (neutral scale, indigo accent, success/warning/danger/info, typography, spacing, radius, borders, shadows, motion, light and dark semantic colors). `npm run tokens:build` generates `src/styles/tokens.css`; `globals.css` maps those variables into Tailwind and shadcn. A test fails if the CSS drifts from the JSON.
  Components: Button (+ `danger` variant) and IconButton (tooltip, required label), Input, Textarea, Select, Combobox, Checkbox, DatePicker (date-only strings), StatusBadge (one tone per status word), Tabs, Tooltip, DropdownMenu, Dialog, ConfirmDialog (async, stays open while working), Sheet, Toast (sonner), DataTable (search, sorting, pagination, row click and keyboard activation, column visibility, responsive column collapse, controllable state for URL sync), EmptyState, Skeleton, ErrorState (reference id, no stack traces), PageHeader, KpiCard (deltas, drill-down link, "Illustrative" label), ChartContainer (+ token-styled axis, grid, tooltip, accessible summary), FormField, SettingsCard.
- **App shell.** Collapsible sidebar (state remembered in a cookie so the server renders it correctly), active states, mobile drawer, skip link. Top bar: breadcrumbs, Ctrl/Cmd+K command palette (page and settings navigation, theme), quick-create (only actions that exist and the role may use; today: pipeline stage for admins), notifications bell reading the notifications table with mark-as-read, help menu (guide page and keyboard shortcuts), theme toggle, user menu with the demo user switcher. Every sidebar route exists with a header and an honest empty state listing what the section will hold and how many records already exist for the role.
- **Data model.** 22 tables in `supabase/migrations/20261019000001_core_schema.sql` with composite `(id, organization_id)` foreign keys for tenant integrity, indexes, `created_at`/`updated_at` (trigger), `archived_at`, `orders.source_deal_id` unique, `notifications (organization_id, dedupe_key)` unique, `automation_executions (organization_id, idempotency_key)` unique, `payments.is_simulated` forced true, hashed API keys. TypeScript types and Zod schemas per entity in `src/domain/entities.ts`, shared by both adapters. `docs/data-model.md` with a Mermaid ER diagram.
- **Row-level security** in `20261019000002_row_level_security.sql`, mirroring the TypeScript matrix: org scoping, own/team/all visibility by role, column grants (profiles: only name/title; notifications: only `read_at`; secrets hidden), append-only audit log, no anon access. Admin functions in `20261019000003_admin_functions.sql`: `change_profile_role` (refuses to remove the last admin), `create/update/reorder_pipeline_stage(s)` (exactly one won and one lost stage). Documented in `docs/security.md`.
- **Seed data.** `src/domain/seed/generate.ts`: deterministic and fictional (`.example` domains, 555 phone numbers). 1 organization, 5 users (1 admin, 1 manager with 2 reps, 1 rep reporting to the admin), 25 companies in 21 countries, 78 contacts, 40 leads (8 converted into deals), 60 deals across all 7 stages with 214 stage-history rows over 12 months, 20 products, 40 orders across all statuses with 99 items and simulated payments (some overdue), 80 tasks (23 overdue), 317 activities, 20 comments, 17 notifications. All dates are offsets from "now".
- **Demo mode.** Repository layer `src/server/repositories` with a demo adapter (server-side store in `.data/demo.json`, atomic writes, serialized mutations, picks up external changes, shifts all dates forward by whole days when loaded on a later day) and a Supabase adapter behind the same interface, selected by `NEXORA_DATA_MODE` (demo when Supabase variables are missing). No business data in browser storage.
- **Auth and roles.** Demo mode: no login, HMAC-signed `httpOnly` cookie selects the demo user (secret from env or generated into `.data/session-secret`). Supabase mode: Supabase Auth sign-in page, session refresh in `src/proxy.ts`, profile with role. One permission matrix (`src/domain/permissions.ts`) drives navigation, page guards (`forbidden()` → 403 page) and server actions.
- **Settings.** Organization (name, currency, locale, order conversion mode; admin), profile (name, title), team (admin changes roles, last-admin protection; managers read-only), pipeline stage editor (add, rename, probability, won/lost flags, drag-and-drop and keyboard/arrow reordering; admin), reset demo data with confirmation (admin). Every sensitive change writes an `audit_logs` row with actor, role, before/after, IP, user agent and request id.
- **Tests.** Vitest (89): permission matrix and navigation, strict Zod schemas (mass-assignment rejection), seed integrity (every foreign key resolves, uniqueness, determinism, totals equal item sums), order totals and payment status, demo store (persistence, failed mutations not persisted, concurrency, date shifting), design tokens in sync, and **migrations + RLS on a real PostgreSQL engine (PGlite)** checking each demo user sees exactly the rows the TypeScript matrix allows. Playwright (5): app loads in demo mode, sidebar reaches every route, a Sales Rep gets 403 on admin settings by direct URL, role switching changes navigation and server-side counts, command palette navigation.

### Verified in this session

Commands run from the project root on Windows 11, Node 24.21:

| Command | Result |
| --- | --- |
| `npm run lint` | pass, 0 problems |
| `npm run typecheck` | pass |
| `npm test` | 89 passed (6 files) |
| `npm run build` | pass, no warnings |
| `npm run test:e2e` | 5 passed (production build, demo mode, isolated data file) |
| `npm run dev` with no `.env` | starts in demo mode; every route renders; checked in a browser at desktop and mobile widths, light and dark |

### Remaining (later phases)

- Phase 2: CRM screens and services, domain event bus (`src/domain/events`), record search in the command palette, quick-create for records, deal-to-order conversion, and the security requirements (Origin checks, rate limits, IDOR tests, security events).
- Phase 2 must extend the repository interface (`src/server/repositories/types.ts`) for each entity and implement it in both adapters.
- Phase 3: metrics, dashboard (replaces the Overview placeholder), analytics, automation engine, `security_events` table and log.
- Phase 4: integrations, API, UI kit page, full docs.

### Known issues

- The Supabase adapter and the sign-in flow have not been run against a live Supabase project in this session. Migrations and RLS are verified on PostgreSQL 17 via PGlite with a stubbed `auth` schema (`tests/unit/helpers/pglite.ts`); `npm run supabase:seed` has only been checked for its missing-configuration path.
- Demo mode stores data in a local file, so it does not persist on serverless hosts (documented in `.env.example` and README).
- In demo mode the user switcher lets anyone act as any user, by design. Demo instances must not hold real data.
- Managers can see unassigned leads via RLS, but the TypeScript matrix has no "unassigned" scope yet; phase 2 lead routing should add it to `visibleOwnerIds` so both layers match.
- `automation_executions` has no insert policy for the client role: phase 3 must decide how the engine writes (service principal on the server) and document it.
- In the in-app browser pane, a hidden copy of streamed content (`<div hidden id="S:0">`) sometimes remains in the DOM. It is not visible, does not appear in Playwright runs, and looks like a React streaming artifact in background tabs. Worth re-checking in phase 2.

### Decisions

- **No Cache Components.** The `create-next-app` template enables `cacheComponents`; NEXORA disables it because every page depends on the session and role, so request-time rendering is simpler and avoids Suspense requirements around every cookie read.
- **`forbidden()` for 403s** (`experimental.authInterrupts`), so a direct URL gets the same refusal as a hidden menu item.
- **Composite tenant foreign keys** in SQL, not just `organization_id` columns: cross-organization references are impossible at the database level.
- **Seed via script, not `seed.sql`.** The same TypeScript generator feeds demo mode and Supabase, so the two never drift. Supabase seeding uses the service-role key only on the developer's machine.
- **Demo dataset time-shifting.** Instead of reseeding daily, stored dates move forward by whole days, keeping relative timing (and any demo edits) intact.
- **Team = direct reports** (`profiles.manager_id`). One manager with two reps, plus a rep reporting to the admin, so the demo shows a manager who cannot see another team's records.
- **Order totals and payment status** modules were created in phase 1 because the seed needs them; phase 2 builds the order screens on them.
- **Event naming for later phases** (decided now so phases 2–4 and VIGIL agree): security events use the `category.action` form of the phase 3 schema, for example `authz.denied`, `validation.failed`, `rate_limit.exceeded`, `security.ssrf_blocked`. Phase 2 emits them through the event bus with these names. An outbound webhook send must also emit `integration.webhook_sent` (target domain in metadata) so VIGIL's automation-tampering rule has an event to match.
- **Heartbeat.** `system.heartbeat` comes from the scheduler. Without a cron calling it, VIGIL would flag a missing heartbeat; phase 3 docs must state that a cron is required for the heartbeat, and VIGIL should treat "no scheduler configured" as a setup state.
