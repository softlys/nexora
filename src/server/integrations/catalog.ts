import "server-only";
import { aiConfig } from "./ai";
import { hookSecret } from "./inbound";
import { mailConfig } from "./mail";
import { notionWriter, slackSender, whatsappConfig } from "./messaging";
import { moyskladConfigured } from "./moysklad";
import { paymentsConfig } from "./payments";
import { telephonyConfig } from "./telephony";
import { yandexConfig } from "./yandex";

/**
 * Every connector NEXORA offers beyond webhooks: what it does, whether it is configured, which
 * environment variables it needs and how to set it up. Secrets live in the server environment only;
 * this catalog reports whether they are set, never their values.
 */
export type ConnectorState = "configured" | "not_configured" | "error" | "available";
export type Connector = {
  id: string;
  name: string;
  group: "Data and notes" | "Leads and calls" | "Messengers and mail" | "Sales tools" | "Payments" | "Team and warehouse";
  russia: boolean;
  summary: string;
  state: ConnectorState;
  detail: string;
  env: Array<{ name: string; hint: string; required?: boolean }>;
  steps: string[];
  /** Inbound URLs to paste into the service; `secret` URLs are shown in full to admins only. */
  endpoints?: Array<{ label: string; path: string; secret?: boolean }>;
  job?: string;
};

const set = (name: string) => Boolean(process.env[name]?.trim());

export function connectorCatalog(): Connector[] {
  const secret = hookSecret();
  const mail = mailConfig();
  const tel = telephonyConfig();
  const wa = whatsappConfig();
  const ai = aiConfig();
  const pay = paymentsConfig();
  const ya = yandexConfig();
  const needSecret = "Set NEXORA_HOOK_SECRET (24+ random characters) to enable the inbound URL.";
  return [
    {
      id: "obsidian",
      name: "Obsidian",
      group: "Data and notes",
      russia: true,
      summary: "Companies, contacts and deals as linked Markdown notes: Obsidian's graph shows who belongs to which company and deal.",
      state: "available",
      detail: ya.diskToken ? "Download any time; synced to Yandex Disk every hour." : "Download the vault any time. Connect Yandex Disk to keep it updated automatically.",
      env: [{ name: "YANDEX_DISK_TOKEN", hint: "Optional: hourly sync of the notes to Yandex Disk (see Yandex Disk)." }],
      steps: [
        "Download the vault below and unzip it into a folder.",
        "In Obsidian: Open folder as vault, choose that folder. Notes are in NEXORA/; open the graph view to see the links.",
        "Write your own notes in separate files and link them to NEXORA notes with [[Company name]]: an export overwrites the NEXORA folder only.",
        "For automatic updates, connect Yandex Disk: the notes then appear in Yandex Disk/NEXORA/Obsidian, which the Yandex Disk app keeps in sync on your computer. Open that folder as the vault.",
      ],
    },
    {
      id: "calendar",
      name: "Calendar: Google, Outlook, Yandex, Apple",
      group: "Data and notes",
      russia: true,
      summary: "Your tasks with a due time (calls, meetings, follow-ups) and your deals' expected close dates in your own calendar.",
      state: "available",
      detail: "Each user subscribes to a personal, secret link. Read-only; the calendar app refreshes it on its own schedule.",
      env: [{ name: "NEXORA_FEED_SECRET", hint: "Optional: key for signing calendar links (defaults to NEXORA_ENCRYPTION_KEY or NEXORA_SESSION_SECRET)." }],
      steps: [
        "Copy your personal link below.",
        "Google Calendar: Other calendars → + → From URL → paste. Updates every few hours.",
        "Yandex Calendar: + New calendar → Subscribe (Подписаться на календарь) → paste the link.",
        "Outlook: Add calendar → Subscribe from web → paste. Apple Calendar: File → New Calendar Subscription.",
        "If the link leaks, press Reset link: the old one stops working at once.",
      ],
    },
    {
      id: "forms",
      name: "Website forms: Tilda, Yandex Forms, any site",
      group: "Leads and calls",
      russia: true,
      summary: "Every form submission becomes a lead (source: website) with all fields and UTM tags in a note; the New lead automation assigns an owner.",
      state: secret ? "configured" : "not_configured",
      detail: secret ? "The inbound URL is active." : needSecret,
      env: [
        { name: "NEXORA_HOOK_SECRET", hint: "24+ random characters; part of the URL (openssl rand -hex 24).", required: true },
        { name: "NEXORA_INBOUND_USER_EMAIL", hint: "Optional: the user leads are created as (default: the first admin)." },
      ],
      endpoints: [{ label: "Form webhook URL", path: `/api/hooks/forms/${secret ?? "<NEXORA_HOOK_SECRET>"}`, secret: true }],
      steps: [
        "Tilda: Site settings → Forms → Webhook → paste the URL; then in each form's settings tick the Webhook service. Tilda sends a test request first.",
        "Yandex Forms: form → Integrations → HTTP request → POST to the URL, JSON body with fields such as name, phone, email, company, message (use the answer variables).",
        "Any site: POST the form (form-encoded or JSON) to the URL. Field names are matched loosely: name/имя, phone/телефон, email/почта, company/компания, message/комментарий, utm_*.",
        "Submissions are de-duplicated (Tilda's tranid or the body hash), so retries never create two leads.",
      ],
    },
    {
      id: "mango",
      name: "Mango Office",
      group: "Leads and calls",
      russia: true,
      summary: "Calls on the contact's timeline, missed calls as Call back tasks, calls from new numbers as leads.",
      state: tel.mango ? "configured" : "not_configured",
      detail: tel.mango ? "Signatures are checked with your API key and salt." : "Set MANGO_API_KEY and MANGO_API_SALT.",
      env: [
        { name: "MANGO_API_KEY", hint: "Unique code of your VPBX (Integrations → API).", required: true },
        { name: "MANGO_API_SALT", hint: "Signature key from the same page.", required: true },
      ],
      endpoints: [{ label: "External system address", path: "/api/hooks/mango" }],
      steps: ["Mango Office → Integrations → API connection: paste the address; Mango adds /events/… itself.", "Turn on call events and call summaries (events/summary).", "Make a test call: it appears on the contact with that number, or as a new lead."],
    },
    {
      id: "zadarma",
      name: "Zadarma",
      group: "Leads and calls",
      russia: true,
      summary: "The same call logging for Zadarma's cloud PBX.",
      state: tel.zadarma ? "configured" : "not_configured",
      detail: tel.zadarma ? "Signatures are checked with your API secret." : "Set ZADARMA_API_SECRET.",
      env: [{ name: "ZADARMA_API_SECRET", hint: "Settings → Integrations and API → keys.", required: true }],
      endpoints: [{ label: "Notifications URL", path: "/api/hooks/zadarma" }],
      steps: ["Zadarma → Settings → Integrations and API → notifications: paste the URL (Zadarma verifies it with zd_echo).", "Enable NOTIFY_END and NOTIFY_OUT_END."],
    },
    {
      id: "twilio",
      name: "Twilio",
      group: "Leads and calls",
      russia: false,
      summary: "Call logging for Twilio numbers outside Russia.",
      state: tel.twilio ? "configured" : "not_configured",
      detail: tel.twilio ? "Request signatures are checked with your auth token." : "Set TWILIO_AUTH_TOKEN.",
      env: [
        { name: "TWILIO_AUTH_TOKEN", hint: "Console → Account info.", required: true },
        { name: "NEXORA_PUBLIC_URL", hint: "The public https address; Twilio signs the exact URL.", required: true },
      ],
      endpoints: [{ label: "Call status callback URL", path: "/api/hooks/twilio" }],
      steps: ["On the phone number or TwiML app, set the Status Callback URL (event: completed) to the URL above."],
    },
    {
      id: "whatsapp",
      name: "WhatsApp Business",
      group: "Messengers and mail",
      russia: false,
      summary: "Customer messages on the contact's timeline (new numbers become leads) and a Send WhatsApp message workflow step.",
      state: wa.configured && wa.appSecret && wa.verifyToken ? "configured" : wa.configured || wa.appSecret ? "error" : "not_configured",
      detail: wa.configured && wa.appSecret && wa.verifyToken ? "Sending and receiving are configured." : "Needs all four WHATSAPP_* variables from Meta's WhatsApp Cloud API.",
      env: [
        { name: "WHATSAPP_TOKEN", hint: "Permanent system-user access token.", required: true },
        { name: "WHATSAPP_PHONE_NUMBER_ID", hint: "WhatsApp → API setup → Phone number ID.", required: true },
        { name: "WHATSAPP_APP_SECRET", hint: "App settings → Basic → App secret (checks webhook signatures).", required: true },
        { name: "WHATSAPP_VERIFY_TOKEN", hint: "Any random string; the same in Meta's webhook settings.", required: true },
      ],
      endpoints: [{ label: "Callback URL", path: "/api/hooks/whatsapp" }],
      steps: [
        "Meta for Developers → your app → WhatsApp → Configuration: Callback URL above, Verify token = WHATSAPP_VERIFY_TOKEN; subscribe to messages.",
        "Add a Send WhatsApp message step to a workflow. To write first, create and approve a template in WhatsApp Manager and put its name in the step.",
        "In Russia WhatsApp Business API access depends on your Meta business account; Telegram (Integrations → Telegram) works without it.",
      ],
    },
    {
      id: "mail",
      name: "Mail: Yandex 360, Gmail, Mail.ru (IMAP)",
      group: "Messengers and mail",
      russia: true,
      summary: "Emails with your contacts and leads appear on their timelines, read every 5 minutes. Other mail is ignored.",
      state: mail.config ? "configured" : mail.problem ? "error" : "not_configured",
      detail: mail.config ? `${mail.config.user} on ${mail.config.host}, folders: ${mail.config.folders.join(", ")}` : (mail.problem ?? "Set MAIL_IMAP_USER and MAIL_IMAP_PASSWORD."),
      env: [
        { name: "MAIL_IMAP_USER", hint: "The mailbox, e.g. sales@company.ru.", required: true },
        { name: "MAIL_IMAP_PASSWORD", hint: "An app password, not the account password.", required: true },
        { name: "MAIL_IMAP_PROVIDER", hint: "yandex, gmail or mailru (detected from the address); custom with MAIL_IMAP_HOST." },
        { name: "MAIL_IMAP_FOLDERS", hint: "Optional, comma-separated (default: inbox and sent)." },
      ],
      job: "mail",
      steps: [
        "Yandex 360: Yandex ID → Security → App passwords → Mail (IMAP); in Mail settings → Mail programs, allow IMAP.",
        "Gmail: turn on 2-step verification, then Google Account → App passwords. Mail.ru: Settings → Security → Passwords for external apps.",
        "Set the variables and restart. The first run reads the last 7 days; then only new mail.",
      ],
    },
    {
      id: "ai",
      name: "AI assistant: YandexGPT or Claude",
      group: "Sales tools",
      russia: true,
      summary: "On a deal: a summary with risks and next steps, or a draft email to the customer, in Russian or English.",
      state: ai.provider ? "configured" : ai.problem ? "error" : "not_configured",
      detail: ai.provider ? `${ai.label} is used.` : (ai.problem ?? "Set YandexGPT or Claude keys."),
      env: [
        { name: "YANDEX_GPT_API_KEY", hint: "Yandex Cloud → service account with ai.languageModels.user → API key." },
        { name: "YANDEX_FOLDER_ID", hint: "The Yandex Cloud folder id." },
        { name: "ANTHROPIC_API_KEY", hint: "Claude (not available for accounts in Russia)." },
        { name: "AI_PROVIDER", hint: "Optional: yandex or anthropic when both are set." },
      ],
      steps: ["YandexGPT: create a service account in Yandex Cloud with the ai.languageModels.user role, create an API key and copy the folder id.", "Open any deal → AI assistant. Only that deal's data is sent; nothing is saved without you."],
    },
    {
      id: "documents",
      name: "Invoices and quotes",
      group: "Sales tools",
      russia: true,
      summary: "A printable invoice (счёт) or quote (КП) for any order, in Russian or English; save it as PDF from the browser.",
      state: "available",
      detail: set("NEXORA_SELLER_DETAILS") ? "Seller details are set." : "Add your legal details in NEXORA_SELLER_DETAILS.",
      env: [{ name: "NEXORA_SELLER_DETAILS", hint: "Your legal name, tax id (ИНН/КПП), address and bank details, one per line (\\n)." }],
      steps: ["Open an order → Documents and online payment → choose the document. Print or Save as PDF."],
    },
    {
      id: "yookassa",
      name: "ЮKassa (YooKassa)",
      group: "Payments",
      russia: true,
      summary: "Payment links for orders by card, SBP and more; paid amounts are recorded on the order automatically.",
      state: pay.yookassa ? "configured" : "not_configured",
      detail: pay.yookassa ? "Payment links are available on orders." : "Set YOOKASSA_SHOP_ID and YOOKASSA_SECRET_KEY.",
      env: [
        { name: "YOOKASSA_SHOP_ID", hint: "Shop id (shopId).", required: true },
        { name: "YOOKASSA_SECRET_KEY", hint: "Secret key from Integration → API keys.", required: true },
      ],
      endpoints: [{ label: "HTTP notifications URL", path: "/api/hooks/yookassa" }],
      steps: ["YooKassa → Integration → HTTP notifications: paste the URL, event payment.succeeded.", "Open an order → Payment link · ЮKassa → send the link to the customer. Each notification is checked against the YooKassa API."],
    },
    {
      id: "stripe",
      name: "Stripe",
      group: "Payments",
      russia: false,
      summary: "Stripe Checkout payment links for customers outside Russia.",
      state: pay.stripe?.webhookSecret ? "configured" : pay.stripe ? "error" : "not_configured",
      detail: pay.stripe?.webhookSecret ? "Payment links and webhooks are configured." : pay.stripe ? "Set STRIPE_WEBHOOK_SECRET so payments are recorded." : "Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.",
      env: [
        { name: "STRIPE_SECRET_KEY", hint: "Developers → API keys (sk_live_… or sk_test_…).", required: true },
        { name: "STRIPE_WEBHOOK_SECRET", hint: "whsec_… of the endpoint below.", required: true },
      ],
      endpoints: [{ label: "Webhook endpoint", path: "/api/hooks/stripe" }],
      steps: ["Stripe → Developers → Webhooks → Add endpoint with the URL above, event checkout.session.completed; copy its signing secret."],
    },
    {
      id: "yandex_disk",
      name: "Yandex Disk",
      group: "Team and warehouse",
      russia: true,
      summary: "Keeps the Obsidian notes in Yandex Disk/NEXORA/Obsidian, updated every hour (only changed notes are uploaded).",
      state: ya.diskToken ? "configured" : "not_configured",
      detail: ya.diskToken ? `Folder: ${ya.diskFolder}/Obsidian` : "Set YANDEX_DISK_TOKEN.",
      env: [
        { name: "YANDEX_DISK_TOKEN", hint: "OAuth token with cloud_api:disk.write and cloud_api:disk.read.", required: true },
        { name: "YANDEX_DISK_FOLDER", hint: "Optional, default NEXORA." },
      ],
      job: "yandex_disk",
      steps: ["oauth.yandex.ru → Create app → Web services, permissions: Yandex Disk REST API (read and write) → get a token for your account.", "Set YANDEX_DISK_TOKEN and restart. Install the Yandex Disk app to get the folder on your computer."],
    },
    {
      id: "telemost",
      name: "Yandex Telemost",
      group: "Team and warehouse",
      russia: true,
      summary: "Create a video meeting link from a deal; it is logged on the deal's timeline.",
      state: ya.telemostConfigured ? "configured" : "not_configured",
      detail: ya.telemostConfigured ? "The Create Telemost meeting button is on deals." : "Set YANDEX_TELEMOST_TOKEN (Yandex 360 for business).",
      env: [{ name: "YANDEX_TELEMOST_TOKEN", hint: "OAuth token with telemost-api:conferences.create.", required: true }],
      steps: ["oauth.yandex.ru → Create app → permission Telemost API: create conferences → get a token for an organization user."],
    },
    {
      id: "moysklad",
      name: "МойСклад (MoySklad) and 1C",
      group: "Team and warehouse",
      russia: true,
      summary: "Products and sale prices from MoySklad every hour, so order lines use the warehouse catalogue. MoySklad syncs with 1C itself.",
      state: moyskladConfigured() ? "configured" : "not_configured",
      detail: moyskladConfigured() ? "Products are synced hourly." : "Set MOYSKLAD_TOKEN.",
      env: [{ name: "MOYSKLAD_TOKEN", hint: "MoySklad → Settings → Users → access token (read access to products is enough).", required: true }],
      job: "moysklad",
      steps: ["Create the token, set MOYSKLAD_TOKEN and restart. Products are matched by article or code (the SKU).", "1C: use MoySklad's own 1C exchange; NEXORA reads the result."],
    },
    {
      id: "slack",
      name: "Slack",
      group: "Team and warehouse",
      russia: false,
      summary: "A Send to Slack workflow step for team notifications.",
      state: slackSender().configured ? "configured" : "not_configured",
      detail: slackSender().configured ? "The step posts to your channel." : "Set SLACK_WEBHOOK_URL.",
      env: [{ name: "SLACK_WEBHOOK_URL", hint: "Slack app → Incoming Webhooks → https://hooks.slack.com/services/…", required: true }],
      steps: ["Create an incoming webhook for the channel, set the variable, then add a Send to Slack step to a workflow."],
    },
    {
      id: "notion",
      name: "Notion",
      group: "Team and warehouse",
      russia: false,
      summary: "A Create Notion page workflow step: deal briefs or meeting notes in a Notion database, linked back to NEXORA.",
      state: notionWriter().configured ? "configured" : "not_configured",
      detail: notionWriter().configured ? "Pages go to your database." : "Set NOTION_TOKEN and NOTION_DATABASE_ID.",
      env: [
        { name: "NOTION_TOKEN", hint: "notion.so/my-integrations → internal integration secret.", required: true },
        { name: "NOTION_DATABASE_ID", hint: "The database id from its URL; share the database with the integration.", required: true },
        { name: "NOTION_TITLE_PROPERTY", hint: "Optional: the title column (default Name)." },
      ],
      steps: ["Create the integration, share the database with it, set the variables, then add a Create Notion page step."],
    },
  ];
}
