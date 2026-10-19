# NEXORA

**B2B operations platform for an equipment supplier: CRM, sales pipeline, orders and workflow automation.**

NEXORA is a portfolio project built to production standards: one permission model enforced on the server and in the database, deterministic demo data, and tests for the rules that matter. All company and person data is fictional.

> Status: under active development. Phases 1 (foundation) and 2 (CRM core) are complete; see [PROGRESS.md](PROGRESS.md) for what works today and what is next.

## What works today

- App shell with a collapsible sidebar, breadcrumbs, a Ctrl/Cmd+K command palette, notifications, light and dark themes, and a mobile drawer.
- Design system: tokens in [`tokens/tokens.json`](tokens/tokens.json) generate the CSS variables used by every component.
- Complete data model: 22 tables in [`supabase/migrations`](supabase/migrations) with composite tenant foreign keys and row-level security.
- Demo mode with no setup: deterministic seed data stored server-side, and a user switcher for Admin, Manager and Sales Rep.
- Roles enforced on the server: navigation and direct URLs follow the same permission matrix.
- Settings: organization, profile, team roles, pipeline stage editor and demo data reset.
- CRM: companies, contacts and leads with URL-based search and filters, record pages with timelines, comments and activity logging.
- Lead conversion into company, contact and deal (once only), deals with full change history and a detail drawer.
- Sales pipeline kanban with drag and drop (also keyboard), optimistic moves with rollback, lost reasons, quick edit and a weighted forecast.
- Orders with a line-item editor, enforced status transitions, simulated payments and derived payment status; won deals convert into exactly one order.
- Tasks with list, month and week calendar, one-click complete; an activity feed; global record search in the command palette.
- Server-side security: tenant isolation, 404 on guessed ids, strict input schemas, Origin checks, rate limits, audit log with field-level diffs and security events.

## Quick start (demo mode)

```bash
npm install
npm run dev
```

Open http://localhost:3000. No environment variables are needed. Use the user menu in the top right to act as a different role.

## Tech stack

Next.js (App Router) · React · TypeScript (strict) · Tailwind CSS · shadcn/ui · Lucide · Recharts · React Hook Form + Zod · dnd-kit · Supabase (PostgreSQL, Auth, RLS) · Vitest · Playwright · PGlite (migration tests)

## Architecture

```mermaid
flowchart LR
  UI[Pages and client components] -->|server actions| Actions[Server actions<br/>Zod + can()]
  Pages[Server components] --> Repos
  Actions --> Repos[Repository layer<br/>src/server/repositories]
  Repos -->|NEXORA_DATA_MODE=demo| Demo[(Demo store<br/>.data/demo.json)]
  Repos -->|NEXORA_DATA_MODE=supabase| SB[(Supabase PostgreSQL<br/>RLS)]
  Domain[src/domain<br/>permissions, seed, totals] --- Actions
  Domain --- Repos
```

- `src/domain`: pure, tested business logic (permission matrix, entities, seed, order math).
- `src/server`: session, repositories (demo and Supabase adapters behind one interface), server actions.
- `src/components`: UI primitives (shadcn/ui restyled to the tokens), patterns and the app shell.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` / `npm start` | Production build and server |
| `npm run lint` | ESLint |
| `npm run typecheck` | Generate route types and run `tsc --noEmit` |
| `npm test` | Vitest unit tests, including migrations and RLS on PGlite |
| `npm run test:e2e` | Playwright end-to-end tests (run `npx playwright install chromium` once) |
| `npm run demo:seed` | Create the demo dataset if it does not exist |
| `npm run demo:reset` | Replace the demo dataset with a fresh seed |
| `npm run supabase:seed` | Load the demo dataset and demo users into Supabase |
| `npm run tokens:build` | Regenerate CSS variables from `tokens/tokens.json` |

## Supabase mode

1. Create a Supabase project and apply the migrations: `supabase link` then `supabase db push`.
2. Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `DEMO_USER_PASSWORD`.
3. Load the demo data and users: `npm run supabase:seed` (reads `.env.local`).
4. Set `NEXORA_DATA_MODE=supabase`, run `npm run dev`, and sign in as one of the printed demo accounts.

The service-role key is used only by the seed script on your machine. The app itself uses the anon key and the signed-in user's session, so every query is subject to RLS.

## Documentation

- [docs/data-model.md](docs/data-model.md): tables, relationships, ER diagram
- [docs/security.md](docs/security.md): roles, permission matrix, RLS, demo-mode limits
- [PROGRESS.md](PROGRESS.md): build log, known issues, decisions

## Screenshots

Screenshots will be added once the main screens are complete.

## Known limitations

- Demo mode stores data in a local file. On serverless hosts it does not persist between cold starts.
- In demo mode anyone can switch to any demo user. Never put real data in a demo instance.
- The Supabase adapter and RLS are tested against PostgreSQL via PGlite with a stubbed `auth` schema; they have not yet been run against a live Supabase project in this repository's CI.

## License

[MIT](LICENSE)
