import { z } from "zod";
import { CHAT_CHANNELS, type ChatChannel, type ChatMessage, type Conversation, type Deal } from "@/domain/entities";
import { activityInput, dealInput } from "@/domain/inputs";
import type { Tx } from "@/server/db/types";
import type { ChannelSenders } from "@/server/integrations/chat";
import { DomainError } from "@/server/repositories/types";
import { emit, findVisible, newId, nowOf, requireCan, type ServiceContext } from "./context";
import { createDeal } from "./deals";
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

export type InboxFilters = { channel?: ChatChannel; status?: "open" | "closed"; /** Only chats assigned to the current user. */ mine?: boolean };
export type InboxRow = Conversation & { record_href: string | null; assignee_name: string | null };

const recordHref = (c: Conversation) => (c.contact_id ? `/contacts/${c.contact_id}` : c.lead_id ? `/leads/${c.lead_id}` : null);

export async function listConversations(ctx: ServiceContext, filters: InboxFilters = {}): Promise<{ rows: InboxRow[]; unread: number }> {
  requireCan(ctx, "view", "activity");
  return ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const all = await visibleConversations(tx, ctx);
    const names = new Map((await tx.find("profiles")).map((p) => [p.id, p.full_name]));
    const rows = all
      .filter((c) => (!filters.channel || c.channel === filters.channel) && c.status === (filters.status ?? "open") && (!filters.mine || c.assignee_id === ctx.actor.id))
      .sort((a, b) => b.last_message_at.localeCompare(a.last_message_at))
      .map((c) => ({ ...c, record_href: recordHref(c), assignee_name: c.assignee_id ? (names.get(c.assignee_id) ?? null) : null }));
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
    return { conversation: { ...conversation, record_href: recordHref(conversation), assignee_name: conversation.assignee_id ? (names.get(conversation.assignee_id) ?? null) : null }, messages, record };
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

export const assignConversationInput = z.object({ id: z.uuid(), assignee_id: z.uuid().nullable() }).strict();

/**
 * Hands a chat to a manager. Anyone who sees the chat can take it; only admins and managers can give
 * it to someone else.
 */
export async function assignConversation(ctx: ServiceContext, input: z.output<typeof assignConversationInput>): Promise<void> {
  requireCan(ctx, "create", "activity");
  if (input.assignee_id && input.assignee_id !== ctx.actor.id && ctx.actor.role === "sales_rep") throw new DomainError("Only admins and managers can assign chats to others.");
  await ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const current = await visibleConversation(tx, ctx, input.id);
    if (current.assignee_id === input.assignee_id) return;
    if (input.assignee_id) {
      const profile = await tx.get("profiles", input.assignee_id);
      if (!profile || !profile.is_active) throw new DomainError("Choose an active user.");
    }
    await tx.update("conversations", input.id, { assignee_id: input.assignee_id, updated_at: nowOf(ctx).toISOString() });
    await emit(tx, ctx, { type: "record.updated", payload: { entity: "conversation", id: input.id, changes: { assignee_id: { before: current.assignee_id, after: input.assignee_id } } } });
  });
}

/** Ready answers for chat replies, shared by the organization. */
export async function getQuickReplies(ctx: ServiceContext): Promise<string[]> {
  const org = await ctx.db.read(ctx.actor.organization_id, (tx) => tx.get("organizations", ctx.actor.organization_id));
  return org?.settings.quick_replies ?? [];
}

export const quickRepliesInput = z.object({ replies: z.array(z.string().trim().min(1).max(1000)).max(30) }).strict();

/** Admins and managers: replaces the list of quick replies. */
export async function saveQuickReplies(ctx: ServiceContext, input: z.output<typeof quickRepliesInput>): Promise<void> {
  if (ctx.actor.role === "sales_rep") throw new DomainError("Only admins and managers can change quick replies.");
  await ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const org = await tx.get("organizations", ctx.actor.organization_id);
    if (!org) throw new DomainError("Organization not found.", "not_found");
    await tx.update("organizations", org.id, { settings: { ...org.settings, quick_replies: input.replies }, updated_at: nowOf(ctx).toISOString() });
  });
}

export const dealFromConversationInput = z.object({ id: z.uuid() }).strict();

/** Opens a deal for the chat's contact at their company, owned by the user, in the first stage. */
export async function dealFromConversation(ctx: ServiceContext, input: z.output<typeof dealFromConversationInput>): Promise<Deal> {
  const { conversation, contact, currency } = await ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const conversation = await visibleConversation(tx, ctx, input.id);
    const contact = conversation.contact_id ? await tx.get("contacts", conversation.contact_id) : null;
    const org = await tx.get("organizations", ctx.actor.organization_id);
    return { conversation, contact, currency: org?.currency ?? "RUB" };
  });
  if (!contact) throw new DomainError(conversation.lead_id ? "This chat is with a lead: convert the lead to get a deal." : "Link the chat to a contact first.");
  if (!contact.company_id) throw new DomainError("The contact has no company. Add the company on the contact card first.");
  return createDeal(
    ctx,
    dealInput.parse({
      name: `${contact.first_name} ${contact.last_name} · ${CHANNEL_LABELS[conversation.channel]}`.slice(0, 160),
      company_id: contact.company_id,
      primary_contact_id: contact.id,
      amount: 0,
      currency,
      expected_close_date: null,
      source: "website",
      next_activity: `Reply in ${CHANNEL_LABELS[conversation.channel]}`,
      notes: `From the chat: ${conversation.last_message_preview}`.slice(0, 5000),
    }),
  );
}

export const inboxFilterChannels = CHAT_CHANNELS;
