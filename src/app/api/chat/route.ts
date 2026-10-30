import { z } from "zod";
import { receiveMessage, siteChatEnabled } from "@/server/integrations/chat";
import { finishInbound, inboundContext, InboundConfigError } from "@/server/integrations/inbound";
import { hasDemoAccess } from "@/server/auth";
import { getServiceDb } from "@/server/db";
import { clientIp } from "@/server/security/client-ip";
import { hitRateLimit } from "@/server/security/rate-limit";
import { supabaseCounter } from "@/server/security/shared-counter";

/**
 * Website chat widget (public/chat-widget.js). Visitors send messages with POST and fetch replies
 * with GET. The visitor's random session id is the only key to the conversation, so it is a UUID
 * that only their browser knows. Any website may embed the widget (CORS *); requests are rate
 * limited per IP. Enabled with NEXORA_SITE_CHAT=on (always in demo mode).
 */

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Cache-Control": "no-store" };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });

const sendInput = z
  .object({
    session: z.uuid(),
    text: z.string().trim().min(1).max(2000),
    name: z.string().trim().max(80).optional(),
    contact: z.string().trim().max(120).optional(),
    utm: z.partialRecord(z.enum(["source", "medium", "campaign", "content", "term"]), z.string().trim().max(200)).optional(),
  })
  .strict();

async function guard(request: Request): Promise<Response | null> {
  if (!siteChatEnabled() || !(await hasDemoAccess())) return reply({ error: "The chat is not enabled." }, 404);
  const ip = clientIp(request.headers.get("x-forwarded-for"), request.headers.get("x-real-ip")) ?? "unknown";
  const limit = await hitRateLimit(`ip:${ip}`, "site_chat", supabaseCounter());
  return limit.allowed ? null : reply({ error: "Too many messages. Please wait a minute." }, 429);
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(request: Request) {
  const blocked = await guard(request);
  if (blocked) return blocked;
  const parsed = sendInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return reply({ error: "Invalid message." }, 400);
  const { session, text, name, contact, utm } = parsed.data;
  try {
    const ctx = await inboundContext({ ip: null, user_agent: request.headers.get("user-agent")?.slice(0, 512) ?? null, request_id: crypto.randomUUID() });
    const result = await ctx.db.write(ctx.actor.organization_id, (tx) =>
      receiveMessage(tx, ctx, {
        channel: "site",
        chat: session,
        name: name || "Website visitor",
        text,
        email: contact?.includes("@") ? contact : null,
        phone: contact && !contact.includes("@") ? contact : null,
        utm: utm as Record<string, string> | undefined,
      }),
    );
    await finishInbound(ctx);
    return reply({ ok: true, id: result?.message.id ?? null });
  } catch (error) {
    if (error instanceof InboundConfigError) return reply({ error: "The chat is not available." }, 503);
    throw error;
  }
}

export async function GET(request: Request) {
  const blocked = await guard(request);
  if (blocked) return blocked;
  const url = new URL(request.url);
  const session = z.uuid().safeParse(url.searchParams.get("session"));
  if (!session.success) return reply({ error: "Invalid session." }, 400);
  const after = url.searchParams.get("after") ?? "";
  try {
    const ctx = await inboundContext({ ip: null, user_agent: null, request_id: crypto.randomUUID() });
    const messages = await getServiceDb().read(ctx.actor.organization_id, async (tx) => {
      const conversation = (await tx.find("conversations", { channel: "site", external_id: session.data }))[0];
      if (!conversation) return [];
      return (await tx.find("chat_messages", { conversation_id: conversation.id }))
        .filter((m) => m.created_at > after)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((m) => ({ id: m.id, direction: m.direction, body: m.body, created_at: m.created_at }));
    });
    return reply({ messages });
  } catch (error) {
    if (error instanceof InboundConfigError) return reply({ error: "The chat is not available." }, 503);
    throw error;
  }
}
