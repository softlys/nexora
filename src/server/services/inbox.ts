import { z } from "zod";
import { CHAT_CHANNELS, type ChatChannel, type ChatMessage, type Conversation } from "@/domain/entities";
import { activityInput } from "@/domain/inputs";
import type { Tx } from "@/server/db/types";
import type { ChannelSenders } from "@/server/integrations/chat";
import { DomainError } from "@/server/repositories/types";
import { emit, findVisible, newId, nowOf, requireCan, type ServiceContext } from "./context";
import { logActivity } from "./tasks";

/**
 * The unified inbox (Входящие): customer chats from every channel in one list. A user sees the
 * conversations of contacts and leads they can see (admins see all) and replies through the
 * conversation's own channel. Incoming messages are written by src/server/integrations/chat.ts.
 */

const CHANNEL_LABELS: Record<ChatChannel, string> = { telegram: "Telegram", whatsapp: "WhatsApp", vk: "VK", site: "Website chat" };

/** Conversations visible to the user: linked to a contact or lead they can see. */
async function visibleConversations(tx: Tx, ctx: ServiceContext): Promise<Conversation[]> {
  const all = await tx.find("conversations");
  if (ctx.actor.role === "admin") return all;
  const contacts = new Set((await findVisible(tx, ctx, "contacts", "contact", (r) => r.owner_id)).map((c) => c.id));
  const leads = new Set((await findVisible(tx, ctx, "leads", "lead", (r) => r.owner_id)).map((l) => l.id));
  return all.filter((c) => (c.contact_id && contacts.has(c.contact_id)) || (c.lead_id && leads.has(c.lead_id)));
}

async function visibleConversation(tx: Tx, ctx: ServiceContext, id: string): Promise<Conversation> {
  const found = (await visibleConversations(tx, ctx)).find((c) => c.id === id);
  if (!found) throw new DomainError("Conversation not found.", "not_found");
  return found;
}

export type InboxFilters = { channel?: ChatChannel; status?: "open" | "closed" };
export type InboxRow = Conversation & { record_href: string | null };

export async function listConversations(ctx: ServiceContext, filters: InboxFilters = {}): Promise<{ rows: InboxRow[]; unread: number }> {
  requireCan(ctx, "view", "activity");
  return ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const all = await visibleConversations(tx, ctx);
    const rows = all
      .filter((c) => (!filters.channel || c.channel === filters.channel) && (c.status === (filters.status ?? "open")))
      .sort((a, b) => b.last_message_at.localeCompare(a.last_message_at))
      .map((c) => ({ ...c, record_href: c.contact_id ? `/contacts/${c.contact_id}` : c.lead_id ? `/leads/${c.lead_id}` : null }));
    return { rows, unread: all.filter((c) => c.unread && c.status === "open").length };
  });
}

export type ConversationView = { conversation: InboxRow; messages: Array<ChatMessage & { author_name: string | null }>; record: { label: string; detail: string } | null };

/** One conversation with its messages; opening it marks it read. */
export async function openConversation(ctx: ServiceContext, id: string): Promise<ConversationView> {
  requireCan(ctx, "view", "activity");
  return ctx.db.write(ctx.actor.organization_id, async (tx) => {
    let conversation = await visibleConversation(tx, ctx, id);
    if (conversation.unread) conversation = await tx.update("conversations", id, { unread: false });
    const names = new Map((await tx.find("profiles")).map((p) => [p.id, p.full_name]));
    const messages = (await tx.find("chat_messages", { conversation_id: id })).sort((a, b) => a.created_at.localeCompare(b.created_at)).map((m) => ({ ...m, author_name: m.author_id ? (names.get(m.author_id) ?? null) : null }));
    let record: ConversationView["record"] = null;
    if (conversation.contact_id) {
      const c = await tx.get("contacts", conversation.contact_id);
      const company = c?.company_id ? await tx.get("companies", c.company_id) : null;
      if (c) record = { label: `${c.first_name} ${c.last_name}`, detail: [company?.name, c.email, c.phone].filter(Boolean).join(" · ") };
    } else if (conversation.lead_id) {
      const l = await tx.get("leads", conversation.lead_id);
      if (l) record = { label: l.title, detail: [l.company_name, l.email, l.phone].filter(Boolean).join(" · ") };
    }
    return { conversation: { ...conversation, record_href: conversation.contact_id ? `/contacts/${conversation.contact_id}` : conversation.lead_id ? `/leads/${conversation.lead_id}` : null }, messages, record };
  });
}

export const replyInput = z.object({ conversation_id: z.uuid(), text: z.string().trim().min(1, "Required").max(4096) }).strict();

/** Sends a reply through the conversation's channel, then stores it and logs it on the timeline. */
export async function replyToConversation(ctx: ServiceContext, senders: ChannelSenders, input: z.output<typeof replyInput>): Promise<ChatMessage> {
  requireCan(ctx, "create", "activity");
  const conversation = await ctx.db.read(ctx.actor.organization_id, (tx) => visibleConversation(tx, ctx, input.conversation_id));
  const sender = senders[conversation.channel];
  if (!sender.configured) throw new DomainError(`${CHANNEL_LABELS[conversation.channel]} is not connected, so replies cannot be sent. An admin can connect it in Integrations.`);
  let sent: { id: string | null };
  try {
    sent = await sender.send(conversation.external_id, input.text);
  } catch (error) {
    throw new DomainError(`The reply was not delivered: ${error instanceof Error ? error.message : String(error)}`);
  }
  const at = nowOf(ctx).toISOString();
  const message: ChatMessage = { id: newId(), organization_id: ctx.actor.organization_id, conversation_id: conversation.id, direction: "out", body: input.text, author_id: ctx.actor.id, external_id: sent.id, created_at: at };
  await ctx.db.write(ctx.actor.organization_id, async (tx) => {
    await tx.insert("chat_messages", message);
    await tx.update("conversations", conversation.id, { unread: false, status: "open", last_message_at: at, last_message_preview: input.text.replace(/\s+/g, " ").slice(0, 200), updated_at: at });
  });
  if (conversation.contact_id || conversation.lead_id) {
    await logActivity(
      ctx,
      activityInput.parse({ type: "message", subject: `Reply in ${CHANNEL_LABELS[conversation.channel]}: ${input.text.replace(/\s+/g, " ").slice(0, 120)}`, body: input.text.slice(0, 5000), contact_id: conversation.contact_id, lead_id: conversation.lead_id, company_id: null, deal_id: null, order_id: null, occurred_at: null }),
    );
  }
  return message;
}

export const conversationStatusInput = z.object({ id: z.uuid(), status: z.enum(["open", "closed"]) }).strict();

export async function setConversationStatus(ctx: ServiceContext, input: z.output<typeof conversationStatusInput>): Promise<void> {
  requireCan(ctx, "create", "activity");
  await ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const current = await visibleConversation(tx, ctx, input.id);
    if (current.status === input.status) return;
    await tx.update("conversations", input.id, { status: input.status, unread: false, updated_at: nowOf(ctx).toISOString() });
    await emit(tx, ctx, { type: "record.updated", payload: { entity: "conversation", id: input.id, changes: { status: { before: current.status, after: input.status } } } });
  });
}

export const inboxFilterChannels = CHAT_CHANNELS;
