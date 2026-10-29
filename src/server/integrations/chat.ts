import "server-only";
import type { ChatChannel, ChatMessage, Contact, Conversation } from "@/domain/entities";
import { leadInput } from "@/domain/inputs";
import { getDataMode } from "@/server/env";
import type { Tx } from "@/server/db/types";
import { emit, newId, type ServiceContext } from "@/server/services/context";
import { fileStore } from "@/server/files";
import { storeAttachment, type NewFile } from "@/server/services/attachments";
import { insertLead } from "@/server/services/leads";
import { claimExternal, findParty, linkExternal, openDealOf, recordActivity } from "./inbound";
import { avitoConfig, avitoSend, instagramConfig, instagramSend } from "./marketplaces";
import { whatsappSender } from "./messaging";

/**
 * Unified inbox channels. Incoming customer messages from Telegram, WhatsApp, VK and the website
 * chat land in one conversation per chat (src/server/services/inbox.ts shows them); replies go back
 * through the same channel. Tokens come from the environment, never from the database.
 */

export const CHANNEL_NAMES: Record<ChatChannel, string> = { telegram: "Telegram", whatsapp: "WhatsApp", vk: "VK", avito: "Avito", instagram: "Instagram", site: "Website chat" };

export type ChannelSender = {
  readonly configured: boolean;
  send(chat: string, text: string): Promise<{ id: string | null }>;
  /** Channels that can deliver a file (with an optional caption). */
  sendFile?(chat: string, file: NewFile, caption: string): Promise<{ id: string | null }>;
};
export type ChannelSenders = Record<ChatChannel, ChannelSender>;

const timeout = () => AbortSignal.timeout(8000);

/** Customer chats with the Telegram bot (the same bot as team notifications). */
export function telegramChatConfig(env: NodeJS.ProcessEnv = process.env) {
  return { token: env.TELEGRAM_BOT_TOKEN?.trim() || null, webhookSecret: env.TELEGRAM_WEBHOOK_SECRET?.trim() || null, teamChat: env.TELEGRAM_CHAT_ID?.trim() || null };
}

/** VK community messages (Callback API). */
export function vkConfig(env: NodeJS.ProcessEnv = process.env) {
  return { token: env.VK_GROUP_TOKEN?.trim() || null, confirmation: env.VK_CONFIRMATION_CODE?.trim() || null, secret: env.VK_SECRET?.trim() || null };
}

/** The website chat widget is on with NEXORA_SITE_CHAT=on, and always in demo mode. */
export function siteChatEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NEXORA_SITE_CHAT?.trim().toLowerCase() === "on" || getDataMode() === "demo";
}

export function channelSenders(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): ChannelSenders {
  const tg = telegramChatConfig(env);
  const vk = vkConfig(env);
  const wa = whatsappSender(env, fetchImpl);
  return {
    telegram: {
      configured: Boolean(tg.token),
      async send(chat, text) {
        const res = await fetchImpl(`https://api.telegram.org/bot${tg.token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chat, text: text.slice(0, 4096), disable_web_page_preview: true }),
          signal: timeout(),
        });
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: { message_id?: number } };
        if (!res.ok || !body.ok) throw new Error(`Telegram refused the message: ${body.description ?? `HTTP ${res.status}`}`);
        return { id: body.result?.message_id ? String(body.result.message_id) : null };
      },
      async sendFile(chat, file, caption) {
        const photo = /^image\/(jpeg|png)$/.test(file.content_type);
        const form = new FormData();
        form.set("chat_id", chat);
        if (caption) form.set("caption", caption.slice(0, 1024));
        form.set(photo ? "photo" : "document", new Blob([file.bytes as BlobPart], { type: file.content_type }), file.file_name);
        const res = await fetchImpl(`https://api.telegram.org/bot${tg.token}/${photo ? "sendPhoto" : "sendDocument"}`, { method: "POST", body: form, signal: AbortSignal.timeout(30_000) });
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: { message_id?: number } };
        if (!res.ok || !body.ok) throw new Error(`Telegram refused the file: ${body.description ?? `HTTP ${res.status}`}`);
        return { id: body.result?.message_id ? String(body.result.message_id) : null };
      },
    },
    whatsapp: {
      configured: wa.configured,
      async send(chat, text) {
        return { id: (await wa.send({ to: chat, text })).message_id };
      },
    },
    vk: {
      configured: Boolean(vk.token),
      async send(chat, text) {
        const body = new URLSearchParams({ peer_id: chat, message: text.slice(0, 4096), random_id: String(Math.floor(Math.random() * 2 ** 31)), access_token: vk.token ?? "", v: "5.199" });
        const res = await fetchImpl("https://api.vk.com/method/messages.send", { method: "POST", body, signal: timeout() });
        const data = (await res.json().catch(() => ({}))) as { response?: number; error?: { error_msg?: string } };
        if (!res.ok || data.error || data.response === undefined) throw new Error(`VK refused the message: ${data.error?.error_msg ?? `HTTP ${res.status}`}`);
        return { id: String(data.response) };
      },
    },
    avito: {
      configured: (() => {
        const c = avitoConfig(env);
        return Boolean(c.clientId && c.clientSecret && c.userId);
      })(),
      send: (chat, text) => avitoSend(chat, text, env, fetchImpl),
    },
    instagram: { configured: Boolean(instagramConfig(env).token), send: (chat, text) => instagramSend(chat, text, env, fetchImpl) },
    // The visitor's widget fetches replies itself; storing the message is the delivery.
    site: { configured: siteChatEnabled(env), send: async () => ({ id: null }) },
  };
}

export type IncomingMessage = {
  channel: ChatChannel;
  /** The chat: Telegram chat id, WhatsApp number (digits), VK peer id, website session id. */
  chat: string;
  /** The customer's display name, when known. */
  name: string;
  text: string;
  /** The channel's message id, so a repeated delivery is ignored. */
  messageId?: string | null;
  phone?: string | null;
  email?: string | null;
  /** Handle to match a contact's messengers (Telegram username, VK id). */
  handle?: string | null;
  /** UTM tags of the visit (website chat). */
  utm?: Record<string, string> | null;
  occurredAt?: string;
  /** Photos and documents that came with the message. */
  files?: NewFile[];
};

const norm = (v: string) => v.replace(/^@/, "").toLowerCase();

/** A contact whose saved messenger handle (Telegram username, VK id) matches. */
function byMessenger(contacts: Contact[], channel: "telegram" | "vk", handle: string): Contact | null {
  const h = norm(handle);
  return contacts.find((c) => {
    const saved = c.messengers?.[channel];
    if (!saved) return false;
    const s = norm(String(saved)).replace(/^https?:\/\/(www\.)?(vk\.com|t\.me)\//, "").replace(/^id/, "");
    return s === h || s === h.replace(/^id/, "");
  }) ?? null;
}

/**
 * Records an incoming customer message: finds or opens the conversation, links it to the contact or
 * lead (a new lead for an unknown sender), stores the message and logs it on the timeline.
 * Returns null for a repeated delivery.
 */
export async function receiveMessage(tx: Tx, ctx: ServiceContext, msg: IncomingMessage): Promise<{ conversation: Conversation; message: ChatMessage } | null> {
  const claim = msg.messageId ? await claimExternal(tx, ctx, `chat:${msg.channel}`, msg.messageId) : null;
  if (msg.messageId && !claim) return null;
  const at = msg.occurredAt ?? new Date().toISOString();
  const text = msg.text.trim().slice(0, 4096) || "(empty message)";
  const channelName = CHANNEL_NAMES[msg.channel];

  let conversation = (await tx.find("conversations", { channel: msg.channel, external_id: msg.chat.slice(0, 255) }))[0] ?? null;
  if (!conversation) {
    const party = await findParty(tx, { phone: msg.phone, email: msg.email });
    let contact = party.contact;
    if (!contact && !party.lead && msg.handle && (msg.channel === "telegram" || msg.channel === "vk")) contact = byMessenger(await tx.find("contacts", { archived_at: null }), msg.channel, msg.handle);
    let leadId = contact ? null : (party.lead?.id ?? null);
    if (!contact && !leadId) {
      const display = (msg.name || msg.handle || msg.phone || channelName).slice(0, 160);
      const lead = await insertLead(
        tx,
        ctx,
        leadInput.parse({
          title: `${channelName}: ${display}`.slice(0, 160),
          company_name: display,
          contact_name: display,
          email: msg.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(msg.email) ? msg.email : "",
          phone: msg.phone && /^\+?[0-9 ()-]{6,24}$/.test(msg.phone) ? msg.phone : "",
          country: "",
          source: "website",
          status: "new",
          qualification: "cold",
          next_action: `Reply in ${channelName}`,
          next_action_at: "",
          estimated_value: 0,
          owner_id: null,
          utm: msg.utm ?? null,
        }),
      );
      leadId = lead.id;
    }
    conversation = {
      id: newId(),
      organization_id: ctx.actor.organization_id,
      channel: msg.channel,
      external_id: msg.chat.slice(0, 255),
      title: (contact ? `${contact.first_name} ${contact.last_name}` : msg.name || msg.handle || msg.phone || channelName).slice(0, 160),
      contact_id: contact?.id ?? null,
      lead_id: leadId,
      assignee_id: contact?.owner_id ?? (leadId ? ((await tx.get("leads", leadId))?.owner_id ?? null) : null),
      status: "open",
      unread: true,
      last_message_at: at,
      last_message_preview: "",
      created_at: at,
      updated_at: at,
    };
    await tx.insert("conversations", conversation);
    await emit(tx, ctx, { type: "record.created", payload: { entity: "conversation", id: conversation.id, after: conversation } });
  }
  const message: ChatMessage = { id: newId(), organization_id: ctx.actor.organization_id, conversation_id: conversation.id, direction: "in", body: text, author_id: null, external_id: msg.messageId?.slice(0, 255) ?? null, created_at: at };
  await tx.insert("chat_messages", message);
  for (const file of msg.files ?? []) {
    await storeAttachment(tx, ctx, fileStore(), { entity: "conversation", entity_id: conversation.id, chat_message_id: message.id }, file, null).catch(() => undefined);
  }
  conversation = await tx.update("conversations", conversation.id, { status: "open", unread: true, last_message_at: at, last_message_preview: text.replace(/\s+/g, " ").slice(0, 200), updated_at: at });
  const activity = await recordActivity(tx, ctx, {
    type: "message",
    subject: `${channelName} from ${conversation.title}: ${text.replace(/\s+/g, " ").slice(0, 120)}`,
    body: text,
    occurred_at: at,
    contact_id: conversation.contact_id,
    lead_id: conversation.lead_id,
    deal_id: conversation.contact_id ? await openDealOf(tx, conversation.contact_id) : null,
  });
  if (claim) await linkExternal(tx, claim.id, "activity", activity.id);
  return { conversation, message };
}
