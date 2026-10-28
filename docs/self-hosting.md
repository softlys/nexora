# Self-hosting

NEXORA ships as a Docker image (`Dockerfile`, Next.js standalone output, non-root user, health check) with a compose file for a single server. Data lives in Supabase: the hosted service at supabase.com or a self-hosted Supabase. For Vercel instead of your own server, see [deployment.md](deployment.md); everything about Supabase, environment variables and the scheduler there applies here too.

## What you need

- A Linux server with Docker and the compose plugin (1 vCPU and 1 GB of RAM are enough for a small team).
- A domain name pointing at the server, for TLS.
- A Supabase project.
- `psql`/`pg_dump` 15+ on the machine that runs backups (only for `scripts/backup.sh`).

## First install

1. **Supabase.** Create a project, then from a checkout of this repository:

   ```bash
   supabase link --project-ref <ref>
   supabase db push
   ```

   This applies every migration in `supabase/migrations`. Then, in **Authentication → Providers → Email**, keep sign-ups disabled: members join by invitation from **Settings → Team**.

2. **First organization and admin.** Run `npm run supabase:seed` from your machine with `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `DEMO_USER_PASSWORD` in `.env.local`. It creates the organization and its users; sign in as the admin and change the password, then invite your team and deactivate the accounts you do not need.

3. **Configuration.**

   ```bash
   cp deploy/.env.example deploy/.env
   ```

   Fill it in. Generate the secrets with `openssl rand -base64 48` (`NEXORA_ENCRYPTION_KEY`) and `openssl rand -hex 24` (`CRON_SECRET`). `deploy/.env` is ignored by git; keep a copy in your password manager. Losing `NEXORA_ENCRYPTION_KEY` makes the stored integration secrets unreadable.

4. **Start.**

   ```bash
   docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
   ```

   This starts two containers:
   - `nexora` listens on port 3000 (`NEXORA_PORT` changes the host port).
   - `scheduler` calls `/api/cron/scheduler` every 5 minutes, once `nexora` reports healthy.

5. **TLS.** Put a reverse proxy in front of the container and do not expose port 3000 to the internet. With Caddy, which obtains certificates on its own:

   ```
   crm.example.com {
     reverse_proxy 127.0.0.1:3000
   }
   ```

   One proxy appends one `X-Forwarded-For` entry, which matches the default `NEXORA_TRUSTED_PROXY_HOPS=1`. Add 1 for each further proxy, such as a CDN in front of Caddy.

6. **Supabase Auth URLs.** In **Authentication → URL Configuration**, set the site URL to `https://crm.example.com` so invitation and password-reset links point at your server.

7. **Verify**, as in [deployment.md](deployment.md#verifying-a-deployment):
   - `curl https://crm.example.com/api/health` returns `{"status":"ok",…}`;
   - sign in;
   - check the security log chain;
   - `docker compose logs scheduler` shows `scheduler 200` every 5 minutes.

## Health checks

| Endpoint | Meaning |
| --- | --- |
| `GET /api/health` | Readiness: the data mode is configured and the database answers. `503` otherwise. Used by the image's `HEALTHCHECK` and the scheduler's start condition. Returns the release (`APP_RELEASE`) |
| `GET /api/v1/health` | Public API liveness, for integrations |

Point your uptime monitor at `/api/health`.

## Backups

Supabase takes daily backups (and point-in-time recovery on paid plans). For a copy you control, run `scripts/backup.sh` from cron on any machine with `pg_dump`:

```bash
# Supabase → Project Settings → Database → Connection string
SUPABASE_DB_URL='postgres://…' BACKUP_KEEP=14 scripts/backup.sh /var/backups/nexora
```

It writes a compressed dump of the `public` schema and keeps the newest `BACKUP_KEEP` files. Copy them off the server.

**Restore** into a project whose migrations are applied:

```bash
SUPABASE_DB_URL='postgres://…' scripts/restore.sh /var/backups/nexora/nexora-20261023T020000Z.dump
```

- It loads data only: the schema, RLS policies and functions come from the migrations.
- Sign-in accounts (`auth.users`) are not in the dump. Restore into the same project, or re-invite members.
- Test a restore into a spare project at least once. CI does this for VIGIL; NEXORA's dump format is the same.

## Upgrades

```bash
git pull
supabase db push                      # new migrations, if any; they are additive
APP_RELEASE=$(git rev-parse --short HEAD) docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
curl -fsS https://crm.example.com/api/health   # shows the new release
```

- Read `PROGRESS.md` for the release before upgrading.
- Back up first when a release includes migrations.
- Each image is tagged `nexora:<APP_RELEASE>`, so the previous one stays available for a rollback.

## Rollback

1. Start the previous image:

   ```bash
   APP_RELEASE=<previous> docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --no-build
   ```

   Or check out the previous commit and rebuild.
2. Migrations add tables and columns and are not rolled back. The previous release ignores what it does not know.
3. Only if a migration damaged data, restore the backup taken before the upgrade.

## Demo mode on a server

`NEXORA_DATA_MODE=demo` with `NEXORA_SESSION_SECRET` runs a self-contained showcase:
- data in the `nexora-data` volume;
- set `NEXORA_DEMO_ACCESS_CODE` (8+ characters), and visitors must enter it before the demo opens;
- share the code only with the people you show the demo to, and change it afterwards to lock everyone out again.

Inside the demo, anyone with the code can act as any user and reset the data. It is for showing the product, never for real data: use Supabase mode for that.

## Connecting VIGIL

1. In NEXORA, create two API keys under **Settings → API keys**: one with `security:read` and one with `security:respond`.
2. Set them in VIGIL's `deploy/.env`.
3. Keep the scheduler running: VIGIL raises an integrity alert after 15 minutes without a `system.heartbeat`.

See VIGIL's `docs/deployment.md`.

## Personal data in Russia (152-FZ)

Federal law 152-FZ requires that personal data of Russian citizens is first recorded, stored and updated in databases located in Russia (article 18, part 5). For NEXORA this means:

- **Run the database in Russia.** Use Supabase mode with a self-hosted Supabase (Docker) or PostgreSQL on a Russian provider (Yandex Cloud, Selectel, VK Cloud, Timeweb Cloud), and run the NEXORA container there too (see "First install"). Do not use Supabase Cloud or Vercel for production data of Russian customers. Demo mode is for fictional data only.
- **Integrations that send personal data abroad.** In Integrations, connectors marked as not for Russia send data to foreign services: Twilio, WhatsApp Business (Meta), Stripe, Slack, Notion, e-mail through Resend, and the Claude AI provider. Use the Russian alternatives that NEXORA supports: Mango Office or Zadarma for calls, Telegram/VK/website chat for messages, YooKassa for payments, YandexGPT for AI, Yandex 360 for mail and documents, MoySklad and 1C for the catalogue.
- **Consent.** The website chat widget shows a consent line; set `NEXORA_PRIVACY_URL` to your personal data processing policy so it links there. Forms connected through Tilda or Yandex Forms must collect consent on their side.
- **Operator duties.** Notify Roskomnadzor that you process personal data, appoint a person responsible for it, and keep the policy published. NEXORA helps with access control (roles, RLS), two-factor sign-in, the audit log and the tamper-evident security log, and archiving instead of deletion; it does not file anything for you.
- **Access from abroad and backups.** Keep backups in Russia as well (the backup script writes to the server's disk or a Russian object storage).
