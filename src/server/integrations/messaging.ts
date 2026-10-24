import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Outbound messaging used by workflow steps: WhatsApp Business (Meta Cloud API), Slack (incoming
 * webhook) and Notion (a page in a database). All are configured with server environment variables;
 * a step whose service is not configured is recorded as skipped, never as sent.
 */

const timeout = () => AbortSignal.timeout(10_000);

// --- WhatsApp Business Cloud API ---------------------------------------------------

export function whatsappConfig(env: NodeJS.ProcessEnv = process.env) {
  const token = env.WHATSAPP_TOKEN?.trim() || null;
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim() || null;
  return {
    token,
    phoneNumberId,
    appSecret: env.WHATSAPP_APP_SECRET?.trim() || null,
    verifyToken: env.WHATSAPP_VERIFY_TOKEN?.trim() || null,
    graphVersion: env.WHATSAPP_GRAPH_VERSION?.trim() || "v21.0",
    configured: Boolean(token && phoneNumberId),
  };
}

/** WhatsApp ids are international numbers without "+" or spaces. */
export function waNumber(phone: string | null | undefined): string | null {
  let digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) digits = `7${digits.slice(1)}`; // Russian 8XXXXXXXXXX
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

export type WhatsAppSender = {
  readonly configured: boolean;
  send(input: { to: string; text: string; template?: { name: string; language: string } | null }): Promise<{ message_id: string }>;
};

export function whatsappSender(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): WhatsAppSender {
  const c = whatsappConfig(env);
  return {
    configured: c.configured,
    async send({ to, text, template }) {
      if (!c.configured) throw new Error("WhatsApp is not configured.");
      // Outside the 24-hour customer service window only approved templates may be sent; the text fills {{1}}.
      const message = template
        ? { type: "template", template: { name: template.name, language: { code: template.language }, components: [{ type: "body", parameters: [{ type: "text", text: text.slice(0, 1000) }] }] } }
        : { type: "text", text: { body: text.slice(0, 4096), preview_url: false } };
      const response = await fetchImpl(`https://graph.facebook.com/${c.graphVersion}/${c.phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, ...message }),
        signal: timeout(),
      });
      const body = (await response.json().catch(() => ({}))) as { messages?: Array<{ id: string }>; error?: { message?: string; code?: number } };
      if (!response.ok || !body.messages?.[0]) throw new Error(`WhatsApp refused the message: ${body.error?.message ?? `HTTP ${response.status}`}`);
      return { message_id: body.messages[0].id };
    },
  };
}

/** X-Hub-Signature-256: "sha256=" + hex HMAC of the raw body with the app secret. */
export function metaSignatureValid(appSecret: string, rawBody: string, header: string | null): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", appSecret).update(rawBody).digest("hex"));
  const given = Buffer.from(header.slice(7));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// --- Slack -------------------------------------------------------------------------

export type SlackSender = { readonly configured: boolean; send(text: string): Promise<void> };

export function slackSender(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): SlackSender {
  const url = env.SLACK_WEBHOOK_URL?.trim() || null;
  const valid = Boolean(url && /^https:\/\/hooks\.slack\.com\/services\//.test(url));
  return {
    configured: valid,
    async send(text) {
      if (!valid) throw new Error("Slack is not configured (SLACK_WEBHOOK_URL).");
      const response = await fetchImpl(url!, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: text.slice(0, 3000) }), signal: timeout() });
      if (!response.ok) throw new Error(`Slack refused the message: HTTP ${response.status} ${(await response.text().catch(() => "")).slice(0, 100)}`);
    },
  };
}

// --- Notion ------------------------------------------------------------------------

export type NotionWriter = { readonly configured: boolean; createPage(input: { title: string; body: string; url?: string }): Promise<{ id: string; url: string }> };

export function notionWriter(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): NotionWriter {
  const token = env.NOTION_TOKEN?.trim() || null;
  const database = env.NOTION_DATABASE_ID?.trim().replace(/-/g, "") || null;
  const titleProperty = env.NOTION_TITLE_PROPERTY?.trim() || "Name";
  return {
    configured: Boolean(token && database),
    async createPage({ title, body, url }) {
      if (!token || !database) throw new Error("Notion is not configured (NOTION_TOKEN, NOTION_DATABASE_ID).");
      const paragraphs = body
        .split(/\n{2,}/)
        .filter(Boolean)
        .slice(0, 50)
        .map((p) => ({ object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: p.slice(0, 2000) } }] } }));
      if (url) paragraphs.push({ object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: "Open in NEXORA", link: { url } } as never }] } });
      const response = await fetchImpl("https://api.notion.com/v1/pages", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" },
        body: JSON.stringify({ parent: { database_id: database }, properties: { [titleProperty]: { title: [{ text: { content: title.slice(0, 200) } }] } }, children: paragraphs }),
        signal: timeout(),
      });
      const result = (await response.json().catch(() => ({}))) as { id?: string; url?: string; message?: string };
      if (!response.ok || !result.id) throw new Error(`Notion refused the page: ${result.message ?? `HTTP ${response.status}`}`);
      return { id: result.id, url: result.url ?? "" };
    },
  };
}
