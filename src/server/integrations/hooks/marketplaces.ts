import "server-only";
import { receiveMessage } from "../chat";
import { finishInbound, inboundContext, inboundMeta, secretMatches } from "../inbound";
import { avitoChatInfo, avitoConfig, instagramConfig, instagramName } from "../marketplaces";
import { metaSignatureValid } from "../messaging";
import { HookError, text, type HookHandler } from "./common";

type AvitoEvent = { id?: string; payload?: { type?: string; value?: { id?: string; chat_id?: string; user_id?: number; author_id?: number; created?: number; type?: string; content?: { text?: string } } } };

/**
 * Avito Messenger webhook: https://<host>/api/hooks/avito?secret=<AVITO_WEBHOOK_SECRET>, registered
 * with POST https://api.avito.ru/messenger/v3/webhook. Avito does not sign events, so the secret in
 * the address is the check. Our own messages (author = the account) are ignored.
 */
export const avitoHook: HookHandler = {
  async POST({ request, rawBody }) {
    const c = avitoConfig();
    if (!c.clientId || !c.userId || !c.webhookSecret) throw new HookError(503, "Avito is not configured");
    if (!secretMatches(new URL(request.url).searchParams.get("secret"), c.webhookSecret)) throw new HookError(401, "Bad secret");
    const v = (JSON.parse(rawBody) as AvitoEvent).payload?.value;
    if (!v?.chat_id || !v.id || !v.author_id || String(v.author_id) === c.userId) return text("ok");
    const info = await avitoChatInfo(v.chat_id, String(v.author_id));
    const body = v.type === "text" ? (v.content?.text ?? "") : `[${v.type ?? "message"}]`;
    const ctx = await inboundContext(inboundMeta(request));
    await ctx.db.write(ctx.actor.organization_id, (tx) =>
      receiveMessage(tx, ctx, {
        channel: "avito",
        chat: v.chat_id!,
        name: info.name || "Avito",
        text: info.item ? `${body}\n\n(${info.item})` : body,
        messageId: v.id,
        occurredAt: v.created ? new Date(v.created * 1000).toISOString() : undefined,
      }),
    );
    await finishInbound(ctx);
    return text("ok");
  },
};

type IgPayload = { object?: string; entry?: Array<{ messaging?: Array<{ sender?: { id?: string }; timestamp?: number; message?: { mid?: string; text?: string; is_echo?: boolean; attachments?: Array<{ type?: string }> } }> }> };

/**
 * Instagram Direct webhook: https://<host>/api/hooks/instagram (Meta app → Webhooks → Instagram,
 * field "messages", verify token INSTAGRAM_VERIFY_TOKEN). Signed with the app secret.
 */
export const instagramHook: HookHandler = {
  async GET({ request }) {
    const q = new URL(request.url).searchParams;
    if (q.get("hub.mode") === "subscribe" && secretMatches(q.get("hub.verify_token"), instagramConfig().verifyToken)) return text(q.get("hub.challenge") ?? "");
    throw new HookError(403, "Forbidden");
  },
  async POST({ request, rawBody }) {
    const c = instagramConfig();
    if (!c.appSecret || !c.token) throw new HookError(503, "Instagram is not configured");
    if (!metaSignatureValid(c.appSecret, rawBody, request.headers.get("x-hub-signature-256"))) throw new HookError(401, "Bad signature");
    const events = ((JSON.parse(rawBody) as IgPayload).entry ?? []).flatMap((e) => e.messaging ?? []).filter((m) => m.sender?.id && m.message?.mid && !m.message.is_echo);
    if (events.length === 0) return text("ok");
    const ctx = await inboundContext(inboundMeta(request));
    for (const m of events.slice(0, 50)) {
      const who = await instagramName(m.sender!.id!);
      const body = m.message!.text ?? (m.message!.attachments?.length ? `[${m.message!.attachments[0]!.type ?? "attachment"}]` : "");
      await ctx.db.write(ctx.actor.organization_id, (tx) =>
        receiveMessage(tx, ctx, { channel: "instagram", chat: m.sender!.id!, name: who.name || (who.username ? `@${who.username}` : "Instagram"), handle: who.username || null, text: body, messageId: m.message!.mid, occurredAt: m.timestamp ? new Date(m.timestamp).toISOString() : undefined }),
      );
    }
    await finishInbound(ctx);
    return text("ok");
  },
};
