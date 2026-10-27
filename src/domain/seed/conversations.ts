import type { ChatMessage, Contact, Conversation, Lead } from "../entities";

/**
 * Demo chats for the unified inbox: a Telegram and a WhatsApp chat with contacts and a website chat
 * from a new lead, with stable ids so the demo looks the same after a reset.
 */
export function seedConversations(organizationId: string, contacts: Contact[], leads: Lead[], now: Date): { conversations: Conversation[]; chat_messages: ChatMessage[] } {
  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();
  const active = contacts.filter((c) => !c.archived_at);
  const tg = active.find((c) => c.messengers?.telegram);
  const wa = active.find((c) => c.messengers?.whatsapp && c.id !== tg?.id);
  const lead = leads.find((l) => !l.archived_at && !l.converted_deal_id && l.status === "new");
  const id = (n: number) => `00000000-0000-4000-8000-0000000006${String(n).padStart(2, "0")}`;
  const conversations: Conversation[] = [];
  const chat_messages: ChatMessage[] = [];
  const add = (n: number, conv: Omit<Conversation, "id" | "organization_id" | "created_at" | "updated_at" | "last_message_at" | "last_message_preview" | "status">, messages: Array<[direction: "in" | "out", minutesAgo: number, body: string]>) => {
    const last = messages[messages.length - 1]!;
    conversations.push({ id: id(n), organization_id: organizationId, ...conv, status: "open", last_message_at: at(last[1]), last_message_preview: last[2].slice(0, 200), created_at: at(messages[0]![1]), updated_at: at(last[1]) });
    messages.forEach(([direction, minutesAgo, body], i) =>
      chat_messages.push({ id: id(n * 10 + i + 10), organization_id: organizationId, conversation_id: id(n), direction, body, author_id: direction === "out" ? (tg?.owner_id ?? null) : null, external_id: null, created_at: at(minutesAgo) }),
    );
  };
  if (tg) {
    add(1, { channel: "telegram", external_id: `demo-tg-${tg.id.slice(0, 8)}`, title: `${tg.first_name} ${tg.last_name}`, contact_id: tg.id, lead_id: null, unread: true }, [
      ["in", 180, "Hello! Could you send the updated price list for the spare parts?"],
      ["out", 170, "Good afternoon! Sure, I will send it within the hour."],
      ["in", 12, "Thank you. Also, is delivery to our second warehouse possible next week?"],
    ]);
  }
  if (wa) {
    add(2, { channel: "whatsapp", external_id: (wa.messengers?.whatsapp ?? "").replace(/^\+/, "") || `demo-wa-${wa.id.slice(0, 8)}`, title: `${wa.first_name} ${wa.last_name}`, contact_id: wa.id, lead_id: null, unread: false }, [
      ["in", 60 * 26, "Hi, we received the invoice. Payment goes out on Friday."],
      ["out", 60 * 25, "Thank you, noted!"],
    ]);
  }
  if (lead) {
    add(3, { channel: "site", external_id: `demo-site-${lead.id.slice(0, 8)}`, title: lead.contact_name || lead.title, contact_id: null, lead_id: lead.id, unread: true }, [["in", 5, "Hello, do you install the equipment yourselves or only supply it?"]]);
  }
  return { conversations, chat_messages };
}
