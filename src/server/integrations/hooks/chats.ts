import "server-only";
import { receiveMessage, telegramChatConfig, vkConfig } from "../chat";
import { linkPersonalChat } from "../personal-telegram-link";
import { telegramChatSender } from "../personal-telegram";
import { finishInbound, inboundContext, inboundMeta, secretMatches } from "../inbound";
import { HookError, json, text, type HookHandler } from "./common";

type TgUpdate = {
  update_id?: number;
  message?: {
    message_id: number;
    date?: number;
    chat: { id: number; type: string };
    from?: { id: number; username?: string; first_name?: string; last_name?: string; is_bot?: boolean };
    text?: string;
    caption?: string;
    contact?: { phone_number?: string };
  };
};

/**
 * Telegram bot updates: https://<host>/api/hooks/telegram, registered with setWebhook and
 * secret_token = TELEGRAM_WEBHOOK_SECRET (checked on every update). Private chats with customers go to
 * the inbox; the team notification chat and group chats are ignored.
 */
export const telegramHook: HookHandler = {
  async POST({ request, rawBody }) {
    const c = telegramChatConfig();
    if (!c.token || !c.webhookSecret) throw new HookError(503, "Telegram chats are not configured");
    if (!secretMatches(request.headers.get("x-telegram-bot-api-secret-token"), c.webhookSecret)) throw new HookError(401, "Bad secret");
    const m = (JSON.parse(rawBody) as TgUpdate).message;
    if (!m || m.chat.type !== "private" || m.from?.is_bot || String(m.chat.id) === c.teamChat) return json({ ok: true });
    // A team member linking (/start <token> from Settings → Profile) or unlinking (/stop) their notifications.
    const command = /^\/(start|stop)(?:\s+(\S+))?$/.exec(m.text?.trim() ?? "");
    if (command && (command[1] === "stop" || command[2])) {
      const reply = await linkPersonalChat(String(m.chat.id), command[1] === "stop" ? null : command[2]!);
      if (reply) {
        await telegramChatSender(c.token)(String(m.chat.id), reply).catch(() => undefined);
        return json({ ok: true });
      }
    }
    const body = m.text ?? (m.contact?.phone_number ? `Shared phone number: ${m.contact.phone_number}` : m.caption ? `[attachment] ${m.caption}` : "[attachment]");
    const name = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ");
    const ctx = await inboundContext(inboundMeta(request));
    await ctx.db.write(ctx.actor.organization_id, (tx) =>
      receiveMessage(tx, ctx, {
        channel: "telegram",
        chat: String(m.chat.id),
        name,
        text: body,
        messageId: `${m.chat.id}:${m.message_id}`,
        handle: m.from?.username ?? null,
        phone: m.contact?.phone_number ? `+${m.contact.phone_number.replace(/^\+/, "")}` : null,
        occurredAt: m.date ? new Date(m.date * 1000).toISOString() : undefined,
      }),
    );
    await finishInbound(ctx);
    return json({ ok: true });
  },
};

type VkEvent = { type?: string; secret?: string; event_id?: string; object?: { message?: { id?: number; conversation_message_id?: number; from_id?: number; peer_id?: number; text?: string; date?: number } } };

/**
 * VK community Callback API: https://<host>/api/hooks/vk. Answers the "confirmation" request with
 * VK_CONFIRMATION_CODE, checks VK_SECRET, and takes "message_new" events into the inbox.
 * VK expects the plain text "ok" for every event.
 */
export const vkHook: HookHandler = {
  async POST({ request, rawBody }) {
    const c = vkConfig();
    if (!c.confirmation || !c.secret) throw new HookError(503, "VK is not configured");
    const e = JSON.parse(rawBody) as VkEvent;
    if (e.type === "confirmation") return text(c.confirmation);
    if (!secretMatches(e.secret ?? null, c.secret)) throw new HookError(401, "Bad secret");
    const m = e.object?.message;
    if (e.type !== "message_new" || !m?.peer_id || !m.from_id || m.from_id < 0) return text("ok");
    const ctx = await inboundContext(inboundMeta(request));
    await ctx.db.write(ctx.actor.organization_id, (tx) =>
      receiveMessage(tx, ctx, {
        channel: "vk",
        chat: String(m.peer_id),
        name: `VK id${m.from_id}`,
        text: m.text || "[attachment]",
        messageId: e.event_id ?? `${m.peer_id}:${m.conversation_message_id ?? m.id}`,
        handle: String(m.from_id),
        occurredAt: m.date ? new Date(m.date * 1000).toISOString() : undefined,
      }),
    );
    await finishInbound(ctx);
    return text("ok");
  },
};
