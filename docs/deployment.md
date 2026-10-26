# Deployment

NEXORA runs anywhere Next.js 16 runs. The recommended setup is **Vercel** (app and cron) plus **Supabase** (PostgreSQL, Auth and row-level security). To run it on your own server with Docker, see [self-hosting.md](self-hosting.md).

## Demo mode vs Supabase mode

| | Demo mode | Supabase mode |
| --- | --- | --- |
| Data | `.data/demo.json` on the server's disk | PostgreSQL with RLS |
| Sign-in | Optional shared access code (`NEXORA_DEMO_ACCESS_CODE`); inside, a user switcher acts as any demo user | Supabase Auth |
| Use for | Local development, a private showcase | Anything with real users |

**Demo-mode file storage does not persist on serverless hosts** such as Vercel: the filesystem is ephemeral, so changes disappear on a cold start or a new deployment. A long-running Node server with a persistent disk keeps them. Never put real data in demo mode: anyone can switch to any user.

## Supabase

1. Create a Supabase project.
2. Apply the migrations from `supabase/migrations` in order (`supabase link`, then `supabase db push`). They create:
   - all tables, with composite tenant keys
   - RLS policies that mirror the TypeScript permission matrix
   - the admin functions
   - the security log
   - the integration and API key tables
3. Load the demo organization and users once from your machine: `npm run supabase:seed`. This needs `SUPABASE_SERVICE_ROLE_KEY` and `DEMO_USER_PASSWORD` in `.env.local`.

## Vercel

1. Import the repository into Vercel. The framework preset is Next.js; build with `npm run build`.
2. Set the environment variables below for Production (and Preview if used).
3. Deploy, then sign in with a seeded account.

### Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `NEXORA_DATA_MODE` | yes on servers | `supabase` for real deployments. Required when `NODE_ENV=production`: without it NEXORA refuses to serve, instead of falling back to the demo |
| `NEXORA_TRUSTED_PROXY_HOPS` | optional | Proxies that append to `X-Forwarded-For` (default 1). The client IP for rate limits and the security log is taken that many entries from the right |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase mode | Public; access is limited by RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase mode | Server only. Used for automation runs, the security log, invites, API key lookup and webhook deliveries |
| `NEXORA_ENCRYPTION_KEY` | Supabase mode | At least 32 characters. Encrypts integration signing secrets (AES-256-GCM). Rotating it makes stored secrets unreadable; rotate the integration secrets after changing it |
| `NEXORA_SESSION_SECRET` | demo mode on servers | At least 32 characters; signs the demo-user cookie |
| `NEXORA_DEMO_ACCESS_CODE` | recommended for a demo on a server | At least 8 characters. Visitors enter it once (kept for 30 days) before the demo opens; changing it locks out everyone who used the old one. Attempts are limited to 10 per IP per 10 minutes |
| `CRON_SECRET` | for the scheduler | At least 16 characters. Without it `/api/cron/scheduler` returns 503 |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | optional | Team notifications from the Send to Telegram workflow step. Without them the step is logged as skipped |
| `RESEND_API_KEY`, `NEXORA_EMAIL_FROM` | optional | Email for the Send email step. Without them, email steps are logged as skipped |
| `NEXORA_ALLOWED_ORIGINS` | optional | Extra origins allowed to call server actions (comma-separated hosts) |
| `NEXORA_BULK_READ_THRESHOLD` | optional | Records per user per 5 minutes before `data.bulk_read` (default 300) |
| `NEXORA_LOCALE` | optional | Interface language: `ru` (default) or `en`. Dates, numbers, money, country names and validation messages follow it |
| `NEXORA_PUBLIC_URL` | recommended | The public https address (for links in calendar feeds, Notion pages and payment return URLs, and Twilio signatures) |
| Connector variables | optional | Forms, telephony, mail, WhatsApp, AI, payments, Yandex Disk/Telemost, MoySklad, Slack, Notion: see [integrations.md](integrations.md) |
| `NEXORA_WEBHOOK_ALLOW_PRIVATE` | development only | `1` lets webhooks reach private and loopback addresses, for example a local n8n. Ignored when `NODE_ENV=production` |

Secrets never reach the browser: only `NEXT_PUBLIC_*` variables are exposed, and those are public by design.

## Cron (scheduler)

The scheduler does the time-based work:
- runs due-date triggers, such as overdue follow-ups and `task.overdue` webhooks
- resumes delayed workflow runs
- retries failed webhook deliveries
- writes the `system.heartbeat` security event

Call it every 5 minutes:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<your-host>/api/cron/scheduler
```

- **Vercel Cron (Pro):** add a `vercel.json` with the cron below. Vercel sends `GET` with `Authorization: Bearer $CRON_SECRET` when the project has `CRON_SECRET`.

  ```json
  { "crons": [{ "path": "/api/cron/scheduler", "schedule": "*/5 * * * *" }] }
  ```

- **Vercel Hobby** only allows daily cron jobs. Use an external scheduler instead with the `curl` call above. The repository includes one: `.github/workflows/scheduler.yml` runs every 5 minutes once the `NEXORA_URL` and `CRON_SECRET` repository secrets are set. cron-job.org or a server crontab work too.
- **Docker / own server:** the compose file starts a scheduler container; see [self-hosting.md](self-hosting.md).

Without a cron, nothing time-based happens on its own, and the companion SIEM sees no heartbeat. Admins can still run the scheduler by hand from Automation Studio.

## Production notes

- **Run behind a reverse proxy or a platform that sets the client address** (Vercel, nginx, Caddy, a load balancer). Next.js does not see the TCP peer address, so client IPs come from `X-Forwarded-For` as far as `NEXORA_TRUSTED_PROXY_HOPS` proxies vouch for them. Exposed directly, any client can choose its own IP: per-IP limits can be bypassed and the security log records whatever IP the client sent. Per-key and per-user limits are not affected.

- **Rate limits and the bulk-read detector are shared** in Supabase mode: counters live in PostgreSQL (`public.hit_counter`), so every serverless instance sees the same totals. Demo mode keeps them in memory.
- **Multi-step writes** in Supabase mode run with an undo journal: if a later step fails, earlier inserts, updates and deletes of the same operation are reverted. Security events are kept, since they record the attempt.
- **Webhooks** go through an outbox: each event is written as a pending delivery when the change happens, sent right after the response (Next.js `after`), and retried by the scheduler. A delivery that a crash or a cold start interrupted is picked up by the next scheduler run (after a 2-minute grace period), so no event is lost; a receiver may see one twice and should de-duplicate on the event id.
- **Outbound webhook URLs** must be https in production and resolve to public addresses. Private, loopback, link-local and cloud metadata ranges are refused at configuration time and again at connection time.
- **Security headers** (`nosniff`, `DENY` framing, strict referrer, permissions policy) are set in `next.config.ts`.
- **Backups:** use Supabase point-in-time recovery, plus `scripts/backup.sh` for a copy you control (see [self-hosting.md](self-hosting.md#backups)). The `security_events` chain lets you detect tampering, not prevent data loss.

## Verifying a deployment

1. `GET /api/health` returns `{"status":"ok","release":…}` (readiness: the data mode is set and the database answers), and `GET /api/v1/health` returns `{"data":{"status":"ok",…}}`.
2. Sign in, open **Settings → Security log**, click **Verify now**, and confirm the chain is intact.
3. Run the scheduler once by hand. A `system.heartbeat` appears in the security log.
4. On an integration page, send a test event to a request bin and check the delivery log.
