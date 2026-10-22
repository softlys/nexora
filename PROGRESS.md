# NEXORA build progress

The project is built in four phases (plus a separate companion app, VIGIL). Each phase starts by reading this file and ends by updating it.

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Foundation: shell, design system, data model, seed, demo mode, roles, base settings | Done |
| 2 | CRM core: companies, contacts, leads, deals, pipeline, orders, tasks, search, security hardening | Done |
| 3 | Dashboard, analytics, automation engine, security telemetry | Done |
| 4 | Integrations, public API, UI kit, documentation, release | Done |


## Final verification (2026-10-20)

Run from the project root on Windows 11, Node 24.21, after a clean install:

| Command | Result |
| --- | --- |
| `npm ci` | pass. npm only warns that the esbuild and unrs-resolver install scripts await approval; all commands below work |
| `npm run lint` | pass, 0 problems |
| `npm run typecheck` | pass |
| `npm test` | 212 passed (13 files) |
| `npm run build` | pass |
| `npm run test:e2e` | 17 passed (production build, demo mode, isolated data file) |
| Browser | All main pages render without console errors. No horizontal scroll at 390 px. README screenshots taken from the production build with Playwright |

VIGIL, the companion SIEM, is built in its own repository (https://github.com/softlys/vigil). It was verified live against this NEXORA: ingestion with chain verification, a drill, and an approved key revocation through the security API.

---

## Stage 1 hardening (2026-10-22)

From the platform audit (audit-output/AUDIT_REPORT.md, section F):
- **NX-001** `NEXORA_DATA_MODE` is required when `NODE_ENV=production`; a forgotten variable no longer serves the demo (no sign-in, admin by default). `next build` is exempt.
- **NX-002** Supabase reads page through tables in a stable order (PostgREST returns at most `max_rows` rows per request); `/api/v1/security-events` uses a database cursor (`Tx.securityEventsAfter`).
- **NX-003** Migration `20261023000001_platform_hardening.sql`: signed-in users can no longer append to `security_events` through the REST API.
- **NX-004** The Supabase adapter refuses inserts into another organization (the service client bypasses RLS).
- **NX-005** Multi-step writes in Supabase mode run with an undo journal (`journaledTx`): a failure reverts the operation's inserts, updates and deletes.
- **NX-006** `tests/unit/tenant-isolation.test.ts`: two organizations in one database; no role sees or changes a row of the other in any table.
- **NX-007** Rate limits and the bulk-read detector use a PostgreSQL counter in Supabase mode (`public.hit_counter`, migration `20261023000002_shared_rate_limits.sql`).
- **INT-001** Client IPs honor `NEXORA_TRUSTED_PROXY_HOPS` (default 1) instead of trusting the first `X-Forwarded-For` entry.
- **OPS-001** GitHub Actions CI: lint, typecheck, unit tests, production-dependency audit, then build and e2e.
- **OPS-005** The shadcn CLI moved to devDependencies; `npm audit --omit=dev` reports 0 vulnerabilities.

Verified: 238 unit tests, 21 e2e tests, lint and typecheck pass.

## QA fixes (2026-10-21)

A manual QA pass found 23 issues. Fixed:
- **`auth.login_succeeded` had an anonymous actor** (found in VIGIL QA): a successful sign-in is now recorded with the signed-in user as the actor. The Next.js dev indicator moved bottom-right, away from the sidebar.
- **Task due date was lost** on create and edit: the form's custom resolver returned the parsed values without `due_date` and `due_time`. Regression e2e.
- **Order save failed silently**: server errors now also show as a banner inside the form, and the toast moved to the top of the screen so it no longer covers the buttons. The message gives amounts ("The new total ($x) is lower than the payments already recorded ($y)"). Regression e2e.
- **Future payment dates** are refused, on the server and in the date picker. This keeps order balances and "Outstanding receivables" in agreement.
- **Won and lost deals show when they closed** (`closed_at`) on the deal page and in the list. Open deals show their expected date, marked "exp.".
- **Pipeline "Avg. days here"** is now the average of the deals shown in each column, so it matches the cards and follows filters and search.
- **Sorting.** Companies sort by country name (not ISO code) and by lifecycle order.
- **New lead automation.**
  - The lead form offers "Unassigned (route automatically)" and uses it by default, so admins and managers no longer become owners by accident.
  - The demo seed now applies what its run history says: routed leads have owners, follow-up tasks and activities. Regression unit test.
- **Number input.** Number fields accept "10,600" and "$10,600.50"; bad input says "Enter a number…" instead of "received NaN". "Api" is shown as "API".
- **Lead conversion** errors use plain field names inline; Industry is marked required.
- **Custom period**: an end date before the start date shows a message and disables Apply.
- **Company Tasks tab**: open tasks first, by due date; overdue tasks highlighted; the count is labelled "open".
- **Pipeline cards** keep room for the hover actions, so they never cover the deal name.
- **Browser tab titles** show the record name on company, contact, lead, deal, order and task pages.
- **HTTP status codes**: missing records answer **404** and forbidden pages **403** (the shared loading boundary that forced 200 was removed).
- **Conversion activity** no longer says "X became X".
- **Dates and money in text**:
  - automation texts and seeded notifications use the app's date format
  - "-$0.00" no longer appears
  - money in errors has cents
- **Seeded timed-out runs** last 5 s, matching their error.
- **Order cancel dialog** has "Keep order" / "Cancel order" buttons and explains that payments stay and refunds are handled outside the app.
- **Escape with unsaved changes** asks in an in-app dialog (Keep editing / Discard changes) instead of the browser `confirm`.
- **Charts**: evenly spaced axis labels; months read "Jan 2026", not "Jan 26".

Not reproduced: missing accessible names. The Industry and Website inputs have linked labels, and the × buttons are named "Close"; checked in the DOM.

Verified: lint, typecheck, 214 unit tests and 21 e2e tests (production build).

---

## Phase 4: Integrations, API, UI kit, release (2026-10-20)

### Done

**A. Outbound webhooks**
- Event catalog: `lead.created`, `deal.stage_changed`, `deal.won`, `order.created`, `task.overdue` and `workflow.webhook`, all raised by the Send webhook step. Envelope: `{ event_id, type, occurred_at, organization_id, data }`, where `data` carries a snapshot of the record.
- Signature header `X-Nexora-Signature: t=<unix>,v1=HMAC-SHA256(secret, "t.body")`, plus `X-Nexora-Event-Id` and `X-Nexora-Event-Type`. There is an optional header-token mode for receivers like n8n Header Auth.
- Delivery:
  - 5 s timeout and a 64 KB response cap.
  - Retries for timeouts, 408, 429 and 5xx after 1 and 4 minutes, run by the scheduler, with at most 3 attempts.
  - Every attempt is stored in `webhook_deliveries` with status code, duration, response excerpt, error, next retry and reason (event, test, retry, redeliver).
  - Each event is delivered once per integration.
  - Webhooks are sent after the HTTP response (Next.js `after`), so a slow receiver never delays a user action.
- SSRF protection:
  - https only in production; no credentials, no internal hostnames.
  - DNS is checked inside the socket's lookup hook, so the checked address is the connected address.
  - Blocked: private, loopback, link-local (including 169.254.169.254), CGNAT, multicast, documentation and metadata ranges, for IPv4, IPv6 and IPv4-mapped addresses.
  - Redirects are followed only to the same host, at most 2.
  - Checked when a URL is saved and again at send time. Every block raises `security.ssrf_blocked`.
- Signing secrets are encrypted at rest (AES-256-GCM, `NEXORA_ENCRYPTION_KEY`; demo mode generates a key into `.data/`). They are shown once, then masked to the last 4 characters. Column grants hide them from the client role.
- The Send webhook workflow step and the `webhook.received` trigger are implemented. Events caused by workflow runs are delivered too, through the engine's `onEvent` hook.

**B. Public API `/api/v1`**
- API keys (Settings → API keys, admin only):
  - Format `nxk_<int|siem>_<prefix>_<secret>`. Stored as SHA-256 and shown once.
  - Scopes: `leads:write`, `records:read`, `events:write`, `security:read`, `security:respond`.
  - Integration and SIEM keys are separate kinds with disjoint scopes.
  - A key acts as its creator: a disabled creator blocks the key.
- Endpoints:
  - `POST /leads` (runs the New lead automation)
  - `GET /companies`, `/contacts`, `/deals`, `/orders` (paginated, permission-scoped)
  - `POST /events` (raises `webhook.received`, with an optional integration signature check)
  - `POST /test-event`, `GET /health`
  - `GET /security-events` (cursor by sequence, includes chain hashes)
  - `POST /security-actions/revoke-api-key` and `/disable-user` (reason required; audit_logs plus a security event; never the last active admin; a key cannot revoke itself)
- Shared pipeline:
  - strict Zod validation, envelope `{ data, meta }` / `{ error: { code, message, details, request_id } }`
  - 64 KB body limit, `Idempotency-Key` with a stored response for 24 h (`api_idempotency_keys`)
  - in-memory rate limits: 120 per minute per key, 20 failed authentications per minute per IP
- Security events: `api_key.created`, `api_key.revoked`, `api_key.used_after_revoke`, `api.auth_failed`, `api.scope_denied`, `webhook.signature_invalid`, `security.ssrf_blocked`, `integration.changed` and `integration.webhook_sent`. Audit rows from API calls carry `via_api_key_id`. Automation runs started by the API stay `service` actors, with `caused_by_api_key_id`.
- OpenAPI 3.1 at `/api/v1/openapi.json`, generated from the contract's Zod schemas (`z.toJSONSchema`; named schemas become components). There is an in-app API reference at `/integrations/api`.

**C. Integrations section**
- The overview lists Make, n8n, Generic webhook and Email provider. Status is honest:
  - Not configured
  - Configured (untested)
  - Connected (last test succeeded, with its time)
  - Error
- Each webhook provider page has:
  - URL, auth mode, events and an enable switch
  - Send test event, Rotate secret and Disconnect
  - a delivery log with status and event filters, a payload and response viewer, and Redeliver with the same `event_id`
  - a step-by-step guide
- The Make guide covers new lead → custom webhook → Slack or email → `POST /events` → activity in NEXORA. The n8n guide covers Webhook → validate → IF → NEXORA API → notify → log.
- **No Make blueprint and no n8n workflow JSON are shipped**: their formats could not be verified against current vendor documentation, so the written guides are the supported path. This is stated in the app and in the docs.
- "Which engine runs what" panel, plus a warning when an event routed to an external platform is also handled by an enabled internal workflow (it lists the workflow's actions). The idempotency strategy is documented in `docs/architecture.md`.
- Email provider page: Resend through env vars, with a real test email that sets the status. Without configuration, Send email steps are logged as skipped. SMTP is not implemented.

**D. Figma & UI Kit**
- `/ui-kit` living style guide, rendered from `tokens/tokens.json` and the real components. It covers:
  - principles
  - semantic and primitive colors (theme-aware)
  - typography, spacing, radius and shadows
  - buttons and states
  - inputs and validation
  - tables and badges
  - modals, drawers, confirmations and toasts
  - tabs, cards, empty and loading states
  - charts
  - responsive rules and accessibility
- Downloads: `/ui-kit/tokens-studio.json`, in Tokens Studio format with sets core, light and dark, the themes Light and Dark, and aliases kept; and the source `/ui-kit/tokens.json`.
- `docs/figma-design-system.md` covers the plugin steps, the file structure 01–08 and the sync process. No live Figma connection is claimed.

**E. Hardening**
- Every route handler goes through `apiRoute` or the cron secret check. Every server action uses `serviceAction` or `runAction`, and `runAction` now also checks `Origin`.
- Audit entries for API keys (create, revoke), integration settings (create, update, secret rotation, disconnect) and SIEM responses.
- Responsive pass at 390 px: no main screen scrolls horizontally any more. Fixes:
  - grid and flex children got `min-w-0`
  - `relative` on scroll wrappers, so absolutely positioned `sr-only` text no longer widens the page
  - record header actions wrap
- Fixed a hydration mismatch on the pipeline board and the stage editor (dnd-kit ids). The console is now clean on all main pages.

**F. Documentation**
- README rewritten: features, architecture diagram, real screenshots, setup, demo mode, Supabase, integration guides, limitations and roadmap.
- New docs: `architecture.md`, `api.md`, `make-integration.md`, `n8n-integration.md`, `figma-design-system.md`, `deployment.md` (Vercel + Supabase, cron, all env vars, demo storage on serverless), `demo-guide.md` (5-minute click path).
- Updated: `security.md`, `security-events.md`, `data-model.md`, `automation-guide.md` and `.env.example` (`NEXORA_ENCRYPTION_KEY`, `NEXORA_WEBHOOK_ALLOW_PRIVATE`).
- Migration `20261022000001_integrations_api.sql`.

**G. Tests**
- Vitest: 212 tests (+47).
  - `integrations.test.ts`: SSRF ranges and URL rules; sign and verify (tamper, stale, malformed); backoff; event mapping; encrypted secret shown once; signed delivery; one delivery per event; 3-attempt retry log; no retry on 4xx; test status Connected or Error; redelivery with the same id; SSRF block on save; real HTTP transport (loopback block, same-host redirects, size cap).
  - `api.test.ts`: key authentication (missing, wrong, revoked), scope denial, kind separation, validation errors, 413, `POST /leads` with the New lead automation, `Idempotency-Key` replay and reuse, inbound event running a workflow, integration signature check, the SIEM read API with the hash chain, revoke and disable (last admin refused), OpenAPI coverage of every endpoint and route file.
- Playwright: 17 tests (+3). The main journey: API key in Settings → lead via the API (with an idempotent replay and a wrong key) → follow-up task appears → convert to a deal → Won → exactly one order → the dashboard's Won deal value rises by the deal amount. Also: honest integration statuses, the API reference and OpenAPI, a refused metadata URL, and the UI kit with the Tokens Studio export.

### Verified in this session

See the final verification table at the top of this file.

### Known issues

- The Supabase adapter, Auth and RLS are verified on PGlite with a stubbed `auth` schema, not against a live Supabase project.
- Rate limits, the failed-auth limiter and the bulk-read detector are in memory, per instance.
- Webhook sends run after the response, and retries run from the scheduler. A crash between the commit and the send can drop an attempt (no durable queue). Without a cron, retries and `task.overdue` events wait for a manual scheduler run.
- Unknown API keys (no matching prefix) belong to no organization, so they are logged only on the server, not in a security log.
- No SMTP; email goes through Resend only. No Make blueprint and no n8n workflow file (see above).
- `NEXORA_ENCRYPTION_KEY` rotation is manual: rotate the integration secrets after changing it.

### Decisions

- **The contract drives the API.** Zod schemas in `src/domain/api/contract.ts` are used by the handlers, the OpenAPI generator and the reference page. A test asserts every endpoint has a route file and a path in the document.
- **Encrypt signing secrets, hash API keys.** HMAC signing needs the secret itself; API keys only need comparing.
- **API keys act as their creator.** Scopes limit what a key may call; the creator's role limits what it may see. Disabling the creator disables the key.
- **Integration and SIEM keys are different kinds.** A leaked Make key can never read the security log or disable users.
- **Data changes belong to one engine.** External platforms call back through `POST /events`, and a NEXORA workflow performs the change. Idempotency is per layer: run key, event id, `Idempotency-Key`, unique side effects.
- **Prefer honest gaps to unverified artifacts.** No blueprint or workflow files whose format could not be checked.

---

## Phase 3: Dashboard, analytics, automation (2026-10-20)

### Done

- **Metrics module** (`src/domain/metrics`). Pure functions for every number on the dashboard and analytics pages:
  - money: won deal value, order value, collected, outstanding receivables, open and weighted pipeline, average deal size (six distinct money metrics, never mixed)
  - deals: active deals, conversion rate, sales cycle
  - breakdowns: receivables ageing buckets, orders by status, deals by stage, conversion funnel from stage history, sales by owner and by source, pipeline distribution
  - tasks: overdue tasks, task completion rate
  - time: revenue series with day, week or month buckets
  - periods: presets and custom ranges in the URL (`?range=`, `?from=&to=`), comparison with the previous period of equal length
  - Every definition is written down in `docs/metrics.md`. 19 unit tests check them against a hand-computed fixture.
- **Overview dashboard** (replaces the placeholder):
  - six KPI cards with change versus the previous period
  - a sales-over-time chart and a deals-by-stage chart
  - recent activities, upcoming tasks, recent orders and high-priority deals
  - Scope follows the role (admin: organization, manager: team, rep: own records).
  - Every number and every bar drills down to the filtered list. Clicking a revenue point opens `/deals?status=won&closed_from…`. Clicking a stage bar opens `/deals?stage=…&created_from…`. Receivables open `/orders?receivable=1` and overdue tasks open `/tasks?status=overdue`. The deals and orders lists gained the matching filters (`created_from/to`, `closed_from/to`, `status=closed`, `receivable`).
- **Analytics page.** Totals, revenue over time, conversion funnel, pipeline distribution, receivables ageing, orders by status, sales by owner and source, and work completion, with the same period filter.
- **Charts** (`src/components/charts`) on Recharts 3:
  - The chart palette is moved into tokens (`chart-1..5`, separate light and dark steps) and validated with the dataviz palette validator against both surfaces.
  - Thin marks, a single axis, recessive grid, token tooltips.
  - Each chart has a "Show data" table and an accessible summary, plus an empty state.
- **Security events.**
  - Dedicated `security_events` table: an ECS-style schema with a per-organization SHA-256 hash chain over canonical JSON and a gap-free sequence (`src/domain/security/events.ts`).
  - Redaction of secret-looking metadata.
  - A catalog of 22 actions, emitted for logins, the demo user switch, demo reset, settings, role changes, user disable, enable and invite, pipeline stages, workflow changes and limits, unauthorized cron calls, bulk reads (`data.bulk_read`), authz denials, validation failures, rate limits and the scheduler heartbeat.
  - **Settings → Security log** (admin): event table with a detail sheet, plus chain verification on demand.
  - Documented in `docs/security-events.md`, the contract for VIGIL.
  - Migration `20261021000001_security_events_and_automation.sql`: insert-only table, admin-only reads, unique `(organization_id, sequence)`.
- **Automation engine** (`src/server/automation`). Workflows are JSON validated by strict schemas, with no code evaluation:
  - 5 trigger types and 10 step types: condition, assign owner, create task, update record (field allowlist), activity, notification, deal → order, email via Resend, webhook (phase 4), delay
  - per-step execution log, idempotency key per workflow and event, causation chain (depth 3, no self-retrigger)
  - guardrails: 20 steps, 30 runs per minute, 5 s step timeout, 30-day delay
  - retry from the failed step, and dry-mode test runs
  - Runs act as a service principal and execute after the user's action commits, so a failing automation never breaks the user's action.
- **Scheduler.** Handles `date.reached` triggers, resumes delayed runs and writes a heartbeat. It runs from the "Run scheduler" button and from `/api/cron/scheduler`, which is disabled without `CRON_SECRET`, compares the bearer token in constant time and logs `cron.unauthorized`.
- **Automation Studio UI.**
  - Workflow list with stats and enable toggles.
  - "New workflow" blank or from three templates (new lead, deal won, overdue follow-up), all seeded and enabled in the demo with a run history.
  - Editor with flow view, trigger and step panels, inline validation, versions, test run and archive.
  - Run history with filters, a detail sheet and Retry.
  - Documented in `docs/automation-guide.md`.
- **Team actions.** Admins can disable or re-enable users (`set_profile_active()`); invites work in Supabase mode. The server actions exist; their UI is still pending (see Remaining).
- **Docs.** `docs/metrics.md`, `docs/automation-guide.md` and `docs/security-events.md` are new. `docs/security.md` covers telemetry, automation controls and the service role. `docs/data-model.md`, the README and `.env.example` are updated with `CRON_SECRET`, `RESEND_API_KEY`, `NEXORA_EMAIL_FROM`, `NEXORA_BULK_READ_THRESHOLD` and `NEXORA_ALLOWED_ORIGINS`.
- **Tests.**
  - Vitest: 165 tests across 11 files. New suites cover metrics, automation logic, the automation engine (idempotency, loops, limits, retry, delays, scheduler) and security events (chain, tamper detection, redaction). There are new regressions for stage history and owner-change metadata.
  - Playwright: 14 tests, 5 of them new:
    - creating a lead runs the New lead automation (follow-up task plus execution log)
    - clicking a dashboard stage bar opens the filtered deals list
    - KPI drill-downs
    - a sales rep gets 403 on the Studio and the security log
    - the security log chain verifies
  - The CRM test now expects the order to be created by the Deal won automation, with no second order.

### Verified in this session

Commands run from the project root on Windows 11, Node 24.21:

| Command | Result |
| --- | --- |
| `npm run lint` | pass |
| `npm run typecheck` | pass |
| `npm test` | 165 passed (11 files) |
| `npm run build` | pass; every app route is dynamic |
| `npm run test:e2e` | 14 passed (production build, demo mode, isolated data file) |
| Browser | Overview, Analytics, Automation Studio, a workflow detail page and the security log were checked at desktop width in light and dark, and Overview at 390 px. A failed run was retried successfully. |

### Remaining (phase 4)

- The `send_webhook` step and the `webhook.received` trigger are wired into the engine but need the integrations module: outbound webhooks with HMAC signatures and SSRF protection, plus inbound endpoints.
- Public API `/api/v1` with keys and scopes, a SIEM pull API for `security_events`, OpenAPI, Make/n8n pages, the UI kit page with a Tokens Studio export, and hardening.
- Team settings UI for disable, enable and invite (the server actions exist), and a "filtered by" chip on deals and orders when they are opened from a drill-down.

### Known issues

- In Supabase mode a service action is not one database transaction: the adapter runs statements one by one under RLS, as it did in phase 2. Automations run after commit and are idempotent, so a retry is safe, but a crash between two statements of a user action can leave a partial write.
- Supabase mode now **requires `SUPABASE_SERVICE_ROLE_KEY` on the server** (automation runs, security log, invites). This is documented in `.env.example` and `docs/security.md`. It has not yet been run against a live Supabase project; the migration and RLS were checked on PGlite.
- Time-based automations and the heartbeat only happen when something calls the scheduler. Vercel Hobby allows only daily crons, so use an external cron there (`docs/automation-guide.md`).
- The rate limiter and the bulk-read counter are in memory, per instance.
- Resolved from phase 1: "managers can see unassigned leads" now holds in both layers (`ownerInScope()` allows a null owner for leads with team or all scope).

### Decisions

- **Automations run after commit**, on events collected in `ctx.pendingEvents`, each step in its own unit of work. Nested writes would deadlock the demo store's serialized queue, and a user action should never fail because a workflow failed.
- **The in-memory adapter returns copies of rows** (`find`, `get` and `update`). It used to return live objects, so "before" values read ahead of an update were silently overwritten. That made demo-mode stage history record `from = to` and lost owner-change `from` values. Regression tests cover it.
- **Separate `security_events` from `audit_logs`.** The audit log answers "what changed in my data"; the security log is the SIEM feed, hash-chained, with its own schema contract.
- **The service role is used only where RLS cannot express the need** (automation, security log, invites), always bound to one organization by the server.
- **Cookie first in the demo session.** Reading the cookie before any file I/O marks every authenticated page dynamic, so `next build` never prerenders a page or writes the demo store. Store renames on Windows retry on `EPERM`/`EBUSY`.
- **Cache Components stays disabled** (decided in phase 1). Every page depends on the session.
- **The stage chart is horizontal** so long stage names stay readable at any width.

---

## Phase 2: CRM core (2026-10-19)

### Done

- **Data access for services.** `src/server/db`: a small `Tx` primitive (`find/get/insert/update/remove/nextOrderNumber`) bound to one organization, with a demo adapter (atomic: runs against a copy and commits only on success; enforces the same unique keys as SQL) and a Supabase adapter (query builder under the user's JWT, RLS applies). Services in `src/server/services` hold the business rules; server actions in `src/server/actions/crm.ts` only parse and call them.
- **Domain events.** Typed events in `src/domain/events` (`record.created/updated/archived/restored/deleted`, `record.owner_changed`, `deal.stage_changed`, `lead.converted`, `task.completed`, `order.status_changed`, `order.created_from_deal`, and the security events). In-process bus; the `audit-log` subscriber writes every event to `audit_logs` with actor, role, field-level diff, IP, user agent and request id, inside the same unit of work.
- **Companies.** List with search, filters (industry, size, country, owner, lifecycle stage), sorting and pagination, all in URL params; detail page with tabs (overview, contacts, deals, orders, tasks, notes + comments, activity timeline); create, edit, archive with confirmation, restore, admin-only permanent delete.
- **Contacts.** List (search by name, email, company, tag), last interaction derived from activities, detail page with timeline, create/edit/archive, Zod-validated email and phone.
- **Leads.** List and detail; conversion dialog that creates or links a company and contact, creates the deal in the first open stage, marks the lead converted and logs an activity. Double conversion is impossible (status check, unique `deals.lead_id` and `leads.converted_deal_id`; tested sequentially and concurrently).
- **Deals.** List with stage/owner/status/date/amount filters, detail page with full change history (stage history + audited field changes), detail drawer used from the deals list and the pipeline, probability defaulting from the stage and overridable.
- **Sales Pipeline.** Kanban with dnd-kit (drag handle, keyboard drag with screen-reader announcements, plus a "Move to" menu as a keyboard-first alternative), per-column count, total and weighted value, cards with amount, company, owner, days in stage and close date (overdue in red). Optimistic move with server validation, rollback and error toast, history record and event; totals recompute immediately. Lost stage asks for a reason. Won shows a toast with "Create order". Quick edit (amount, probability, close date) from the card; full edit in the drawer. Table view with the same filters. Weighted forecast and average days per stage from history.
- **Orders.** Generated unique numbers (`NX-YYYY-NNNN`, organization-wide even under RLS via `next_order_number()`), line-item editor with live totals from the same domain function as the server, list with status/payment/company/owner filters, detail page. Payment status is derived on every read (it changes with the date). Simulated payments only, labelled everywhere, capped at the outstanding amount. Status transitions enforced on the server (`ORDER_TRANSITIONS`); only draft and confirmed orders are editable.
- **Deal → order conversion.** `convertDealToOrder(ctx, dealId)` with mode from the organization setting (draft or confirmed); idempotent through the unique `source_deal_id`, also under concurrent calls; exposed as "Create order" on won deals.
- **Tasks & Activities.** List, month and week calendar, activity feed; filters by assignee, priority and status (open and overdue presets); overdue indicators; one-click complete with optimistic UI; task page with comments. Activities (call, meeting, email, note, follow-up) can be logged from company, contact, lead, deal and order pages. Timelines merge activities, tasks, stage changes and comments in time order.
- **Search and quick create.** The command palette searches companies, contacts, deals and orders on the server, scoped to the role, rate limited. Quick create offers company, contact, lead, deal, order and task (only what the role may create); forms open from `?new=1`.
- **UX.** Skeleton loading, empty states with a primary action, inline validation (client and server), success/error toasts, unsaved-changes warning on sheets (close and page unload), confirm dialogs for archive, delete and cancel, visible focus states, record names in breadcrumbs and the browser tab.
- **Security** (details in `docs/security.md`): session-only tenant and actor; IDOR returns 404 and records `authz.denied`; strict schemas and owner/won-deal field guards; plain-text rendering; Origin check on mutations; per-user rate limits on search, create and mutations; page size cap; safe errors with request id; archive for editors, permanent delete for admins only; security events `authz.denied`, `validation.failed` (aggregated per minute), `rate_limit.exceeded`, `record.owner_changed`.
- **Tests.** Vitest 114 (24 new service tests: IDOR for every entity, cross-organization, forbidden fields, reassignment rules, won-deal amount, audit diff, lead conversion incl. concurrent double conversion, stage moves, lost reason, order totals and numbering, status transitions, payment cap, deal-to-order idempotency under concurrency, task assignment and link visibility, archive/restore/delete, rate limiter, validation aggregation; plus a PGlite test for `next_order_number()` under RLS). Playwright 9 (4 new: create company and contact, create deal, move it to Won by dragging, create the order and check it exists exactly once; script tags render as text; a rep gets 404 on another rep's deal URL; global search).

### Verified in this session

| Command | Result |
| --- | --- |
| `npm run lint` | pass, 0 problems |
| `npm run typecheck` | pass |
| `npm test` | 114 passed (7 files) |
| `npm run build` | pass, no warnings |
| `npm run test:e2e` | 9 passed (production build, demo mode, fresh data file per run) |
| Browser check (dev server) | companies list and detail, deals list and drawer, pipeline board, tasks month view |

### Remaining (later phases)

- Phase 3 subscribes the automation engine and the security log to `eventBus` (`src/server/services/context.ts`) and moves security events from `audit_logs` to `security_events`.
- Phase 3 metrics should reuse `summarizeStages` / `stageDurations` (`src/domain/rules/pipeline.ts`) and the derived payment status.

### Known issues

- The Supabase adapter writes multi-step operations (lead conversion, order with items) as separate statements, not one database transaction. Invariants that matter (one order per deal, one conversion per lead, unique order numbers) are enforced by unique constraints, but a failure halfway can leave a partial record (for example a company created during a conversion that then fails). Moving these into SQL functions is a candidate for phase 4 hardening. Not run against a live Supabase project in this session.
- In Supabase mode, a guessed id returns 404 as required but cannot be told apart from a missing record, so `authz.denied` (`not_visible`) is only recorded in demo mode.
- Rate limits, validation aggregation and the demo store are per process (documented).
- Managers can see unassigned leads through RLS, but the TypeScript matrix still has no "unassigned" scope, so in the app unassigned leads are visible to admins only. Lead routing in phase 3 should add it to `visibleOwnerIds`.
- Global search scans visible records in application code; fine for this data volume, a database search index would be needed at scale.
- The deal drawer's "Create order" button does not know whether an order already exists; clicking it is safe (the server returns the existing order and says so).

### Decisions

- **Services over repositories for CRM.** Phase 1 settings keep the `Repositories` interface; CRM features use services on the `Tx` primitive so business rules live once and run identically on both adapters.
- **URL-driven, server-rendered lists.** Search, filters, sort and page live in query params and are applied on the server after visibility filtering; lists are shareable and work without client JavaScript.
- **Plain text everywhere.** Notes, comments and descriptions are stored and rendered as plain text, which removes the need for an HTML sanitizer.
- **Security events through the domain bus**, using the names agreed for phase 3 and VIGIL. They are queued during a unit of work and written afterwards, because a nested write inside the demo store's queue would deadlock.
- **Order numbers from the database** in Supabase mode (`next_order_number()`), with a retry on collision, because RLS hides other users' orders from the app.

---

## Phase 1: Foundation (2026-10-19)

### Done

- **Project setup.** Next.js 16 (App Router, Turbopack), React 19, TypeScript strict, Tailwind CSS 4, shadcn/ui (Radix, restyled), Lucide, Recharts, React Hook Form + Zod 4, dnd-kit, Supabase JS/SSR, Vitest, Playwright. Scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:e2e`, `demo:seed`, `demo:reset`, plus `supabase:seed` and `tokens:build`. `.gitignore`, `.env.example` (every variable commented), MIT `LICENSE`, README skeleton.
- **Design system.** `tokens/tokens.json` is the single source of truth (neutral scale, indigo accent, success/warning/danger/info, typography, spacing, radius, borders, shadows, motion, light and dark semantic colors). `npm run tokens:build` generates `src/styles/tokens.css`; `globals.css` maps those variables into Tailwind and shadcn. A test fails if the CSS drifts from the JSON.
  Components: Button (+ `danger` variant) and IconButton (tooltip, required label), Input, Textarea, Select, Combobox, Checkbox, DatePicker (date-only strings), StatusBadge (one tone per status word), Tabs, Tooltip, DropdownMenu, Dialog, ConfirmDialog (async, stays open while working), Sheet, Toast (sonner), DataTable (search, sorting, pagination, row click and keyboard activation, column visibility, responsive column collapse, controllable state for URL sync), EmptyState, Skeleton, ErrorState (reference id, no stack traces), PageHeader, KpiCard (deltas, drill-down link, "Illustrative" label), ChartContainer (+ token-styled axis, grid, tooltip, accessible summary), FormField, SettingsCard.
- **App shell.** Collapsible sidebar (state remembered in a cookie so the server renders it correctly), active states, mobile drawer, skip link. Top bar: breadcrumbs, Ctrl/Cmd+K command palette (page and settings navigation, theme), quick-create (only actions that exist and the role may use; today: pipeline stage for admins), notifications bell reading the notifications table with mark-as-read, help menu (guide page and keyboard shortcuts), theme toggle, user menu with the demo user switcher. Every sidebar route exists with a header and an honest empty state listing what the section will hold and how many records already exist for the role.
- **Data model.** 22 tables in `supabase/migrations/20261019000001_core_schema.sql` with composite `(id, organization_id)` foreign keys for tenant integrity, indexes, `created_at`/`updated_at` (trigger), `archived_at`, `orders.source_deal_id` unique, `notifications (organization_id, dedupe_key)` unique, `automation_executions (organization_id, idempotency_key)` unique, `payments.is_simulated` forced true, hashed API keys. TypeScript types and Zod schemas per entity in `src/domain/entities.ts`, shared by both adapters. `docs/data-model.md` with a Mermaid ER diagram.
- **Row-level security** in `20261019000002_row_level_security.sql`, mirroring the TypeScript matrix: org scoping, own/team/all visibility by role, column grants (profiles: only name/title; notifications: only `read_at`; secrets hidden), append-only audit log, no anon access. Admin functions in `20261019000003_admin_functions.sql`: `change_profile_role` (refuses to remove the last admin), `create/update/reorder_pipeline_stage(s)` (exactly one won and one lost stage). Documented in `docs/security.md`.
- **Seed data.** `src/domain/seed/generate.ts`: deterministic and fictional (`.example` domains, 555 phone numbers). 1 organization, 5 users (1 admin, 1 manager with 2 reps, 1 rep reporting to the admin), 25 companies in 21 countries, 78 contacts, 40 leads (8 converted into deals), 60 deals across all 7 stages with 214 stage-history rows over 12 months, 20 products, 40 orders across all statuses with 99 items and simulated payments (some overdue), 80 tasks (23 overdue), 311 activities, 20 comments, 17 notifications (34 simulated payments). All dates are offsets from "now".
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
