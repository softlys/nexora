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

## Requisites, invoices with stamp, quotes from deals (2026-10-28)

- **Settings → Requisites** (admins): legal name, ИНН, КПП, ОГРН, legal address, VAT note, bank (name, БИК, р/с, к/с), director and chief accountant, the director's signature and the stamp (PNG/JPEG, resized in the browser, stored in `organizations.settings.requisites`).
- **Invoice in the Russian format** (order or deal, `?doc=invoice`): the bank block (банк получателя, БИК, счета, ИНН/КПП, получатель), supplier and buyer lines with ИНН/КПП (buyer's from company custom fields `inn`/`kpp`), lines table, VAT or the VAT note, "Всего наименований N, на сумму…", the amount in words for rubles (`src/domain/amount-in-words.ts`), signatures with the signature image and the stamp. Print or "Save as PDF" in the browser.
- **Quote (КП) from a deal**: the Products panel has a "КП" button (`/print/deals/<id>`), built from the deal's lines (or the deal amount); `?doc=invoice` gives an invoice before any order exists.
- **Not done: EDO (Диадок, СБИС).** Sending through EDO needs a qualified electronic signature (КЭП) that the user applies with CryptoPro on their own computer; it needs a Kontur/Tensor test account to build against.
- **Tests.** Amount in words, requisites validation and admin-only saving (unit); e2e: requisites shown on an invoice from a deal.

## 1C exchange (2026-10-28)

- **Standard 1C site exchange** ("Обмен с сайтом", CommerceML 2.08) at `/api/1c/exchange`, the same protocol 1C uses with 1C-Bitrix. Works with 1С:Управление торговлей, Бухгалтерия, КА and УНФ. Login and password: `ONEC_LOGIN`, `ONEC_PASSWORD` (Basic auth on checkauth, then a day-scoped session cookie).
- **Catalog from 1C:** `import.xml` creates or updates products (name, group, VAT; SKU from the артикул, transliterated, or from the 1C id), `offers.xml` sets prices. 1C ids are remembered, so later exchanges update the same products.
- **Orders to 1C:** confirmed (non-draft) orders changed since the last confirmed export, with counterparty (ИНН/КПП from company custom fields `inn`/`kpp`), lines, discounts and totals. The export point moves only when 1C answers `success`.
- **Documents from 1C:** a posted document confirms a draft order; "Дата оплаты по 1С" records the outstanding amount as a bank-transfer payment, once.
- Integrations → 1C shows the address and setup steps. XML parsing uses `fast-xml-parser` 5.11.2 (pinned).
- **Tests.** Parsing real-shaped CommerceML, product create/update and prices, order export with ИНН and the export cursor, posting and payment from 1C, endpoint auth (unit).

## Roles and rights (2026-10-28)

- **Settings → Roles** (admins): for managers and sales reps, per record type (companies, contacts, leads, deals, orders, tasks, products, analytics, automation) and action (view, create, edit, archive), choose All / Team / Own only / No access.
- **Restrictions only narrow** the built-in matrix, never widen it, so database RLS (which mirrors the matrix) stays the outer limit. Admins cannot be restricted.
- Stored in `organizations.settings.role_restrictions`; applied to the session actor (`Actor.restriction`), to API keys acting as their creator, and through `can()`, `ownerInScope()` and `visibleOwnerIds()` everywhere (lists, records, navigation, buttons). Changes raise a `settings.changed` security event.
- **Tests.** Narrowing rules, saving, a manager limited to own deals in lists, a rep without create rights, admin-only (unit).

## Move from Bitrix24 and amoCRM (2026-10-27)

- **Settings → Move from another CRM** (admins). Bitrix24 through an incoming webhook URL (REST), amoCRM through the account subdomain and a long-lived token (API v4). The address and token are used for the request only, never stored.
- **Check first:** counts of pipelines, companies, contacts and deals, what is new and what was moved before. **Then move.**
- **What moves:** pipelines (matched by name, or created with the source stages: open stages in order plus one won and one lost stage; extra failure stages such as Bitrix24's "Analyse the reason" map to the lost stage), companies (phone, website, address), contacts linked to their company, deals with amount, currency, contact, company and stage. Deals without a company get one named after the deal.
- Every record is remembered by its id in the source CRM (`integration_records`, `import:bitrix24` / `import:amocrm`), so a second run only adds new records. Imported records use the normal services (validation, audit, events) but do not run automations. Up to 5 000 records of each kind per run.
- Outbound requests use the SSRF-guarded transport (now also for GET).
- **Tests.** Reading both APIs with paging and the won/lost mapping, the move with a dry run and a repeated run, admin-only (unit).

## Robots on pipeline stages (2026-10-27)

- **Robots** (`/pipeline/robots`, "Robots" on the pipeline page): columns per stage of the chosen pipeline; each robot runs when a deal enters that stage, as in Bitrix24.
  - Actions: create a task for the deal owner (type, due in N business days), notify the owner/managers/admins, e-mail the owner, WhatsApp to the customer, message the team in Telegram, set the probability. Texts take `{{deal.*}}` variables; defaults are in the interface language.
  - Switch on/off and remove per robot; runs and failures are shown on the card, and the name opens the workflow in Automation Studio.
- **Engine.** The `deal.stage_changed` trigger takes `to: "stage"` with a `stage_id`; Automation Studio offers "A particular stage" with a stage picker. Robots are ordinary workflows (admins and managers).
- **Tests.** Trigger matching per stage, a robot creating a task on a stage move, permissions (unit); e2e: add a robot from the pipeline.

## Products in deals (2026-10-27)

- **Products panel** on the deal page: lines from the catalog or custom, with quantity, price, discount and tax, line totals and a live total.
- **The deal amount is the total of its lines** once it has any; the deal form shows that the amount is calculated, and the services ignore an amount typed there. Without lines the amount is entered by hand, as before.
- **Order from a won deal** copies the lines (before: one line for the deal amount).
- Sales reps cannot change the lines of a closed deal (like its amount).
- **Data.** Table `deal_items` (migration `20261027000001_deal_items.sql`), RLS like the deal.
- **Tests.** Totals and amount, deal form keeps the calculated amount, lines copied into the order, permissions (unit); RLS (PGlite); e2e: add a line, amount updates.

## Unified inbox (2026-10-27)

- **Inbox** (`/inbox`, in the sidebar): customer chats from Telegram, WhatsApp, VK and the website chat in one list, filtered by channel and open/closed, with unread marks. The page refreshes every 5 seconds.
  - A conversation shows the thread, a link to the contact or lead, and a reply box. The reply goes back through the same channel and is logged as a `message` activity on the timeline.
  - Close/reopen; a new customer message reopens a conversation.
  - Visibility follows the linked contact or lead (admins see all), in the services and in RLS.
- **Channels** (`src/server/integrations/chat.ts`):
  - Telegram: the bot's private chats via `/api/hooks/telegram` (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`); the team chat is ignored. Contacts are matched by their saved Telegram username.
  - WhatsApp: the existing webhook now files messages into the inbox too; replies use the Cloud API.
  - VK: community Callback API at `/api/hooks/vk` (`VK_GROUP_TOKEN`, `VK_CONFIRMATION_CODE`, `VK_SECRET`); replies via `messages.send`.
  - Website chat: `<script src="https://<host>/api/chat/widget" async>` adds a chat button to any site; `/api/chat` takes visitor messages and returns replies (session UUID, CORS, rate limit per IP). `NEXORA_SITE_CHAT=on` (always on in demo). Sample page: `/api/chat/demo`.
  - Unknown senders become leads; repeated deliveries are ignored.
- **Demo.** Three seeded chats (Telegram, WhatsApp, website).
- **Data.** Tables `conversations` and `chat_messages` with RLS (`private.can_see_conversation`), migration `20261026000005_inbox.sql`.
- **Tests.** Matching, dedupe, leads from unknown senders, visibility, replies per channel, closed/reopened (unit); RLS (PGlite); e2e: visitor message → reply in the inbox → visitor receives it.

## Click-to-call and caller card (2026-10-26)

- **Internal number.** Each user sets their extension on the office PBX in Settings → Profile (`profiles.phone_extension`, digits only).
- **Call button** on contacts, leads and companies with a phone number.
  - With Mango Office or Zadarma connected (Zadarma also needs `ZADARMA_API_KEY`) and an extension set, NEXORA asks the PBX for a callback: the user's phone rings first, then the customer's number. The call is logged by the PBX's usual call notification.
  - Otherwise the button is a `tel:` link that opens the device's phone app.
  - The record must be visible to the user; the number is taken from the record on the server.
- **Caller card.** While a customer's call rings (Mango `events/call` "Appeared", Zadarma `NOTIFY_START`/`NOTIFY_INTERNAL`, Twilio `ringing`), the people it concerns get a pop-up: name, company, open deal or lead, number, and "Open card". It goes to the user whose extension rings, otherwise the record's owner, otherwise everyone. Unknown numbers are announced too; the lead is created when the call ends, as before.
  - The pop-up checks every 5 seconds while the tab is visible (own rate-limit bucket `poll`), only when a telephony provider is connected or in demo mode.
  - Demo mode: "Simulate an incoming call" on the Mango Office, Zadarma and Twilio pages.
- **Data.** Migration `20261026000004_telephony.sql` (`phone_extension` with a column grant so users can set their own).
- **Tests.** Signed Mango and Zadarma callback requests, preconditions and visibility, card routing and dedupe, simulation (unit); extension check constraint and grant (PGlite); e2e: simulated call, pop-up, open card, `tel:` link.

## E-mail from record pages (2026-10-26)

- **Write e-mail** on contacts, deals, leads and companies (companies: when a contact has an address).
  - Recipient from the record's contacts (free input allowed), a template, subject and text; the text stays editable.
  - Template variables: `contact.*`, `company.*`, `deal.name`, `deal.amount`, `lead.title`, `me.name`, `me.title`, `me.email` (`src/domain/email-templates.ts`); unknown variables are rejected when a template is saved.
  - With the e-mail provider configured (Resend, `RESEND_API_KEY` + `NEXORA_EMAIL_FROM`), NEXORA sends it with the user's address as reply-to and logs an `email` activity on the deal, contact, company and lead timelines. Access to the linked records is checked before sending.
  - Without a provider, "Open in mail app" opens the filled e-mail (mailto) in the user's mail program; nothing is logged as sent.
- **Settings → E-mail templates** (admins): add, edit, remove. Three default templates (Introduction, Follow-up, Commercial offer) for new and existing organizations.
- **Data.** Table `email_templates` (members read, admins manage), migration `20261026000003_email_templates.sql` (also adds the defaults to existing organizations). Demo stores get the defaults on upgrade.
- **Tests.** Rendering and unknown variables, composer data, sending with reply-to and logging, no send without a provider or for hidden records, admin-only templates (unit); RLS (PGlite); e2e: template filled from a deal, mailto link.

## Duplicates (2026-10-26)

- **Match keys.** Records are compared by the company name without legal forms and quotes ("ООО «Ромашка»" = "Ромашка, LLC"), the website host, the last 10 digits of a phone number and the e-mail. A contact's name only matches within the same company (`src/domain/duplicates.ts`).
- **Warning while creating.** The new company, contact and lead forms list look-alike records with the reason and a link, half a second after typing stops. Saving stays possible. New leads are compared with leads and contacts (e-mail, phone) and companies (company name).
- **Duplicates page** (`/duplicates`, linked from the company and contact lists): groups of possible duplicate companies or contacts.
- **Merge** (admins only, like a permanent delete, because links owned by other users move too):
  - Choose the record to keep (the oldest by default) and the ones to merge.
  - Contacts, leads, deals, orders, tasks, activities, comments and integration links move to the kept record; for contacts also deals' primary contact.
  - Empty fields are filled from the merged records; notes are combined; tags, messengers and custom values are joined (the kept record wins).
  - The merged records are archived, not deleted. A "Duplicates merged" activity and the usual record events record what happened.
- **Tests.** Keys and grouping, warnings, company and contact merges with links, permissions (unit); e2e: warning, create, merge.

## Custom fields (2026-10-26)

- **Settings → Fields.** Admins add their own fields to companies, contacts, leads and deals, for example ИНН, customer type or a contract date.
  - Types: text, number, date, list of values, yes/no, link. A field can be required.
  - Label, values and the required flag can be changed later; the type cannot.
  - Removing a field archives it: it leaves forms and pages, and filled-in values stay on the records.
- **Records.**
  - The four record forms show the fields; record pages list the values under Details.
  - Values are validated on the server against the definitions (numbers, dates, list values, http(s) links, required); errors appear next to the field.
  - An update without `custom` keeps the stored values.
- **CSV and API.** Export adds a column per field, headed by its label. Company and contact import reads these columns by label or key (Cyrillic headers work) and reports bad values by row. API v1 lists return `custom`.
- **Data.** Table `custom_fields` (members read, admins manage) and `custom jsonb` on companies, contacts, leads and deals (migration `20261026000002_custom_fields.sql`). Demo stores are upgraded in place.
- **Also fixed.** The settings menu and the breadcrumbs were still in English in the Russian interface.
- **Tests.** Value normalization and keys, admin-only definitions, validation on create and update, archived values kept, deals, CSV import (unit); RLS and the jsonb check on PGlite; e2e: add a field and fill it on a company.

## Several pipelines (2026-10-26)

- **Pipelines (воронки).** Each organization can have several, for example wholesale, retail or tenders.
  - Each pipeline has its own stages with exactly one won and one lost stage.
  - The first pipeline is the default for new deals.
- **Board and lists.**
  - The board has pipeline tabs (`?pipeline=`).
  - The deal list has tabs with "All pipelines" and labels stages "Pipeline · Stage".
  - The new-deal form asks for the pipeline.
  - A deal's stage menu lists every pipeline's stages, so a deal can move between pipelines (history and events as for any stage move).
- **Settings → Pipelines.**
  - Create a pipeline; it starts with default stages in the interface language.
  - Rename a pipeline, and edit and reorder its stages.
  - Delete a pipeline only when it has no deals; the last pipeline cannot be deleted.
- **Analytics.** The funnel, the distribution and "Deals by stage" are per pipeline, with tabs. Totals stay organization-wide.
- **Data.**
  - New `pipelines` table; `pipeline_stages.pipeline_id`. Stage positions and names are unique per pipeline.
  - Migration `20261026000001_pipelines.sql` moves existing stages into a default "Sales" pipeline.
  - The admin SQL functions now take the pipeline: `create_pipeline`, `rename_pipeline`, `delete_pipeline`, and per-pipeline `create_pipeline_stage` and `reorder_pipeline_stages`.
  - Demo stores are upgraded in place. The demo has an empty "Tenders" pipeline.
- **Tests.**
  - SQL functions on PGlite: per-pipeline ordering, won and lost rules, create, rename and delete, permissions.
  - Services: deal start stage, board, filters, cross-pipeline moves, per-pipeline analytics.
  - e2e: tabs and a cross-pipeline move.

## Russian interface (2026-10-26)

- **Whole interface in Russian.** Set with `NEXORA_LOCALE`: `ru` by default, `en` for English.
  - Covered: every page, form, menu, table, toast, empty state and status label; server and validation messages, including Zod's own messages (`z.locales.ru()`); dates, numbers and money; country names (Россия); Russian plural forms.
- **How it works.**
  - `tr("English text")` uses the English text as the key. A missing translation falls back to English, so nothing breaks.
  - The dictionary is `src/lib/i18n/ru.ts` (about 1,670 phrases).
  - `tr` is synchronous and works in server components, client components and helpers. On the server the language comes from the environment, in the browser from `<html lang>`.
- **Kept as they are:**
  - demo data (company names, deal titles), translated only where they are the default pipeline stage names;
  - CSV export headers, so files round-trip; import accepts country names in both languages.
- **Tests.**
  - The unit and e2e suites run in English (`NEXORA_LOCALE=en`).
  - `tests/unit/i18n.test.ts` fails when any interface text in the code has no Russian translation, and checks plural forms and Russian dates, money and countries.

## Connectors (2026-10-24)

Seventeen connectors, all configured on the server and listed on Integrations with status, setup steps and the addresses to paste (docs/integrations.md):

| Area | Connectors |
| --- | --- |
| Data and notes | Obsidian vault export; personal iCalendar feeds for Google, Yandex, Outlook and Apple, with reset |
| Leads and calls | Web forms (Tilda, Yandex Forms, any site) → leads; Mango Office, Zadarma and Twilio calls → timeline, Call back task or lead |
| Messengers and mail | IMAP mail (Yandex 360, Gmail, Mail.ru) on timelines; WhatsApp Business, inbound and as a workflow step |
| Sales tools | AI deal assistant (YandexGPT or Claude); printable invoices and quotes |
| Payments | ЮKassa and Stripe payment links, with real payments recorded |
| Team and warehouse | Yandex Disk sync of the vault; Yandex Telemost meeting links; МойСклад products; Slack and Notion workflow steps |

- **Shared plumbing.**
  - `src/server/integrations/inbound.ts` decides the organization and acting user, matches contacts by phone or email, and claims each provider's id in the new `integration_records` table so retries are no-ops.
  - `/api/hooks/<provider>` checks each provider's signature.
  - Connector jobs run from the 5-minute scheduler.
- **Schema.**
  - `message` activity type.
  - `payments.is_simulated` can be false: online payments are real.
  - Migration `20261025000001_integration_records.sql`.
- **Verified.**
  - Unit tests: provider signatures (including Twilio's published example), form parsing in English and Russian, call, mail and payment de-duplication, missed-call tasks, MoySklad SKUs, vault and calendar formats, the AI prompt, and the new workflow steps.
  - Live checks: Tilda and Yandex Forms payloads create a lead once, the calendar feed serves events and a reset link stops working, the vault downloads, and the Russian invoice prints.
  - None of the connectors was tried against a real external account.

## Demo access code (2026-10-23)

- **`NEXORA_DEMO_ACCESS_CODE`** (optional, 8+ characters) protects a demo installation.
  - Pages, server actions and CSV exports redirect to `/login`, where the visitor enters the code once.
  - The cookie is signed and lasts 30 days. Its value depends on the code, so changing the code locks out every earlier visitor.
  - Attempts are limited to 10 per IP per 10 minutes, and the comparison is constant-time.
- Supabase mode is unchanged: real accounts, roles and RLS. Demo mode stays unsuitable for real data, since inside it anyone can act as any user; the docs say so.
- Unit test for the setting; checked live: without the code `/` and `/export/companies` redirect to `/login`, a wrong code is refused, the right one opens the demo.
- CSV e2e test (`tests/e2e/csv.spec.ts`):
  - export: file name, BOM and header row;
  - import: a file with an error row is refused with "Row 3", and the fixed file imports a Cyrillic company that then appears in the list.

## Hosting readiness (2026-10-23)

- **Docker.**
  - `Dockerfile`: Next.js standalone output, node 24-alpine, non-root user `nexora`, `HEALTHCHECK`, `APP_RELEASE` label.
  - `deploy/docker-compose.yml`: the app plus a scheduler container that calls `/api/cron/scheduler` every 5 minutes.
  - `NEXT_PUBLIC_SUPABASE_*` are read at run time, so one image serves any Supabase project.
- **Readiness.** `GET /api/health` checks that the data mode is configured and the database answers (503 otherwise), and returns the release.
- **Scheduler for cloud hosts.** `.github/workflows/scheduler.yml` calls the scheduler every 5 minutes once the `NEXORA_URL` and `CRON_SECRET` secrets are set (Vercel Hobby only allows daily cron).
- **Backups.** `scripts/backup.sh` / `restore.sh`: a `pg_dump` of the public schema from Supabase, kept for `BACKUP_KEEP` days; restore loads data only, into migrated schema.
- **Durable webhooks (NX-008).** Outbound events are written to the outbox as pending in the same request that made the change. The delivery right after the response completes them. The scheduler sends the ones a crash or cold start left behind, after 2 minutes. Before, a crash between commit and send lost the event.
- **CSV export and import (NX-009).**
  - Export: companies, contacts, leads and deals, with the page's search, filters and sort, scoped to what the user may see. UTF-8 with BOM, so Excel opens Cyrillic. Cells that would run as formulas are neutralized. Rate-limited and logged like any list read.
  - Import: companies and contacts. A dry run first lists errors by row; nothing is imported while there are errors. Rows go through the normal create path (validation, permissions, audit, automations). Headers match the export.
- **CI.** A `docker` job builds the image, runs it and checks pages, the API, the cron, the non-root user and the 503 without a data mode.
- **Docs.** `docs/self-hosting.md`: install, TLS, health, backups, upgrades, rollback.

Verified: 262 unit tests, lint and typecheck pass; e2e and CI below.

## Countries, messengers and Telegram (2026-10-24)

- **All countries.** Country pickers offer all 249 ISO 3166-1 countries (Russia, Kazakhstan, the UAE and so on; before, 34). Validation everywhere — forms, lead conversion, the public API, automation country maps and the entities — accepts only real codes ("XX" is rejected).
- **Messengers on contacts.** Telegram, WhatsApp, Viber, Instagram, Facebook/Messenger, VK, LinkedIn and WeChat fields:
  - validated and normalized (handles, profile links or international phone numbers);
  - stored as `contacts.messengers` (migration `20261024000001_contact_messengers.sql`);
  - shown on the contact as "Write" links (t.me, wa.me, viber://, …) and as marks in the contacts list;
  - searchable, and included in `GET /api/v1/contacts`.
  Existing demo stores are upgraded in place (`upgradeDataset`), without a reset.
- **Telegram bot.**
  - Integrations → Telegram explains the setup with @BotFather; the bot token and chat id are server environment variables, never in the browser or the database.
  - A test message button for admins.
  - A new **Send to Telegram** workflow step: plain text with placeholders; skipped, never "sent", without a bot.
- **Messengers and social** page: what works natively (contact links, the Telegram bot) and how to automate WhatsApp, Instagram, Facebook, Viber, VK and WeChat through Make/n8n with each platform's official API. Nothing is claimed as connected.
- Demo data shifted into the future by an older release is repaired on load.

Verified: 252 unit tests, 26 e2e tests, lint and typecheck pass.

## Full testing pass (2026-10-22)

Automated, black-box (46 probes) and manual testing of both apps; report in the companion audit folder (TEST_REPORT.md). Fixed here, with tests:
- the daily demo date shift no longer moves things that already happened into the future (it showed "last used in 9 hours");
- the Create API key dialog starts from the default scopes every time (it kept the previous key's scopes);
- global search also finds leads and open tasks, within the actor's scope;
- deployment docs: run behind a reverse proxy (without one, clients can choose their own X-Forwarded-For).

Verified: 241 unit tests, 23 e2e tests, lint and typecheck pass; CI green.

## Redesign from reference mockups (2026-10-22)

- **Tokens** (`tokens/tokens.json` → `npm run tokens:build`): violet primary (#6a45f5 / #7c5cff), dark navy sidebar in both themes (`--nx-sidebar-*`), soft gray page background with white cards, radii 8/12/16 px.
- **Shell**: dark sidebar with a filled violet active item, taller header, wider content area.
- **KPI cards**: colored icon tile, optional sparkline (trend of the same metric), larger value. Used on the overview.
- **Pipeline cards**: bold amount, owner avatar (initials, stable color per person), footer with close date and days in stage.
- **Recent activity**: avatars with initials.
- **Security log**: "Chain integrity" checklist (schema, sequence, link, hash, tamper) with PASS/FAIL/NOT REACHED from the server verification, and "Chain links" showing the newest entries with their hashes.
- **Automation Studio**: a read-only workflow map (trigger → steps, condition branches) next to the editor, with a nodes library.

**Bug found while building the integrity view:** the demo store re-anchors dates every new day, and it also shifted `security_events.occurred_at`, which broke every hash in the chain (VIGIL then reported rewritten history). The security log is now excluded from the shift (`UNSHIFTED_TABLES` in `src/domain/seed/shift.ts`), with a regression test.

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
