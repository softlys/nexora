# Connectors

Beyond outbound webhooks (Make, n8n), the public API, email and Telegram, NEXORA connects to the services below. Each one:
- is configured with server environment variables, so secrets never reach the browser or the database;
- shows its status, setup steps and the addresses to paste on **Integrations → (connector)**;
- reports itself as not configured instead of pretending to work. Workflow steps whose service is missing are logged as *skipped*.

Services marked **RU** work from Russia.

| Connector | What it does | Variables |
| --- | --- | --- |
| Obsidian (RU) | Download companies, contacts and deals as linked Markdown notes (`/export/obsidian`) | none; `YANDEX_DISK_TOKEN` for hourly sync |
| Calendar (RU) | A personal iCalendar link per user for Google Calendar, Yandex Calendar, Outlook and Apple Calendar: tasks with a due time, expected close dates | optional `NEXORA_FEED_SECRET` |
| Website forms (RU) | Tilda, Yandex Forms or any site → leads, with every field and UTM tags in a note | `NEXORA_HOOK_SECRET` |
| Mango Office (RU), Zadarma (RU), Twilio | Calls on timelines, missed calls → Call back tasks, new numbers → leads | `MANGO_API_KEY` + `MANGO_API_SALT`; `ZADARMA_API_SECRET`; `TWILIO_AUTH_TOKEN` + `NEXORA_PUBLIC_URL` |
| Mail over IMAP (RU) | Yandex 360, Gmail, Mail.ru: emails with contacts and leads on their timelines | `MAIL_IMAP_USER`, `MAIL_IMAP_PASSWORD` (app password), optional `MAIL_IMAP_PROVIDER`, `MAIL_IMAP_HOST`, `MAIL_IMAP_FOLDERS` |
| WhatsApp Business | Incoming messages on timelines (new numbers → leads); Send WhatsApp message step | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` |
| AI assistant (RU with YandexGPT) | Deal summary with next steps, or an email draft, in Russian or English | `YANDEX_GPT_API_KEY` + `YANDEX_FOLDER_ID`, or `ANTHROPIC_API_KEY`; optional `AI_PROVIDER`, `ANTHROPIC_MODEL`, `YANDEX_GPT_MODEL` |
| Invoices and quotes (RU) | Printable счёт / КП / invoice / quote per order (`/print/orders/<id>`), saved as PDF from the browser | optional `NEXORA_SELLER_DETAILS` |
| ЮKassa (RU), Stripe | Payment links for an order's outstanding amount; confirmed payments are recorded on the order | `YOOKASSA_SHOP_ID` + `YOOKASSA_SECRET_KEY`; `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` |
| Yandex Disk (RU) | Obsidian notes kept in `NEXORA/Obsidian` on Disk, hourly, changed notes only | `YANDEX_DISK_TOKEN`, optional `YANDEX_DISK_FOLDER` |
| Yandex Telemost (RU) | Create a video meeting link from a deal | `YANDEX_TELEMOST_TOKEN` |
| МойСклад (RU) and 1C | Products and prices every hour, matched by article/code; 1C through MoySklad's own exchange | `MOYSKLAD_TOKEN` |
| Slack, Notion | Send to Slack and Create Notion page workflow steps | `SLACK_WEBHOOK_URL`; `NOTION_TOKEN` + `NOTION_DATABASE_ID` |

## Inbound webhooks

Services that push data call `POST /api/hooks/<provider>`:
- `forms/<NEXORA_HOOK_SECRET>`
- `mango` (Mango appends `/events/…`)
- `zadarma` (it also sends a `GET` with `zd_echo`)
- `twilio`
- `whatsapp` (plus the `GET` verification)
- `yookassa`
- `stripe`

Every request is authenticated:

| Provider | How |
| --- | --- |
| Web forms | The secret in the path |
| Mango | `sign` = SHA-256 of key + JSON + salt |
| Zadarma | `Signature` header |
| Twilio | `X-Twilio-Signature` over the public URL; set `NEXORA_PUBLIC_URL` |
| WhatsApp | `X-Hub-Signature-256` |
| Stripe | `Stripe-Signature`, 5-minute tolerance |
| YooKassa | The payment is read back from the YooKassa API with the shop's credentials |

**Who creates the records.** Records are created in `NEXORA_INBOUND_ORG_ID` (default: the only organization) as `NEXORA_INBOUND_USER_EMAIL` (default: its first active admin). They go through the normal services, so validation, the audit log, events and automations all apply. Activities written by integrations have no NEXORA author.

**Exactly once.** Each provider's own id is claimed in `integration_records` (migration `20261025000001`) in the same transaction that creates the record:
- the Tilda `tranid` or a hash of the form body;
- Mango `entry_id`, Zadarma `pbx_call_id`, Twilio `CallSid`;
- WhatsApp message id, email `Message-ID`, payment id.

Retries and repeated notifications are therefore no-ops. Errors return 5xx so the service retries; configuration problems return 503 and are logged.

## Scheduled jobs

`/api/cron/scheduler` (every 5 minutes) also runs the connector jobs and reports them under `integrations` in its response:
- mail: every 5 minutes; the first run reads the last 7 days;
- Yandex Disk: hourly;
- MoySklad: hourly.

Each job's last run (time, result or error) is shown on its connector page.

## Data that leaves NEXORA

| Connector | What is sent |
| --- | --- |
| AI assistant | The deal's own fields, its last 20 activities, open tasks and last 10 comments go to the chosen provider |
| Calendar link | Task titles and deal names, to whoever holds the link; Reset link revokes it |
| Yandex Disk | The same notes as the Obsidian export, written with the admin's view of the data |
| Payment links | Order number and amount |

Answers from the AI assistant are shown to the user and never saved automatically.

## Known limits

- **Not tested against the real services.** Every connector is covered by unit tests against the providers' documented formats: signatures (Twilio's published example), payload shapes, de-duplication. None has been tried against a live account in this repository. Verify each one with your own account before you rely on it.
- **WhatsApp.** Starting a conversation needs an approved template (WhatsApp's 24-hour rule). Access from Russia depends on your Meta business account.
- **Mail.** Only messages whose other party is a known contact or open lead are recorded. Attachments are not imported.
- **Documents.** They are browser-printable pages, not server-generated PDFs.
- **MoySklad.** Sync is one-way, products only. Orders are not pushed to MoySklad.
- **mailparser.** It depends on a `nodemailer` version with moderate advisories in its address parser. NEXORA takes addresses from the IMAP server's ENVELOPE, not from that parser, and uses the library only for message text.
