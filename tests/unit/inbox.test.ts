import { beforeEach, describe, expect, it } from "vitest";
import type { Dataset } from "@/domain/entities";
import type { Db } from "@/server/db/types";
import { channelSenders, receiveMessage, type ChannelSenders } from "@/server/integrations/chat";
import { assignConversation, dealFromConversation, getQuickReplies, listConversations, openConversation, replyToConversation, saveQuickReplies, setConversationStatus } from "@/server/services/inbox";
import { createTestDb, ctxFor, DEMO_USER_IDS } from "./helpers/services";

function fakeSenders(configured = true) {
  const sent: Array<{ channel: string; chat: string; text: string }> = [];
  const make = (channel: string) => ({ configured, send: async (chat: string, text: string) => (sent.push({ channel, chat, text }), { id: `m-${sent.length}` }) });
  const senders: ChannelSenders = { telegram: make("telegram"), whatsapp: make("whatsapp"), vk: make("vk"), site: make("site") };
  return { senders, sent };
}

describe("unified inbox", () => {
  let db: Db;
  let data: () => Dataset;
  beforeEach(() => {
    ({ db, data } = createTestDb());
  });
  const admin = () => ctxFor(db, data(), DEMO_USER_IDS.admin);
  const rep = () => ctxFor(db, data(), DEMO_USER_IDS.repDaniel);
  const org = () => data().organizations[0]!.id;
  const receive = (msg: Parameters<typeof receiveMessage>[2]) => db.write(org(), (tx) => receiveMessage(tx, admin(), msg));

  it("seeds demo chats in several channels", () => {
    expect(new Set(data().conversations.map((c) => c.channel))).toEqual(new Set(["telegram", "whatsapp", "site"]));
    expect(data().chat_messages.length).toBeGreaterThan(3);
  });

  it("files a message from a known Telegram user under the contact, once", async () => {
    const contact = data().contacts.find((c) => c.owner_id === DEMO_USER_IDS.repDaniel && c.messengers?.telegram && !c.archived_at)!;
    const first = await receive({ channel: "telegram", chat: "555001", name: "Someone", text: "Привет", messageId: "555001:1", handle: `@${contact.messengers!.telegram}` });
    expect(first?.conversation).toMatchObject({ contact_id: contact.id, lead_id: null, unread: true, last_message_preview: "Привет" });
    expect(await receive({ channel: "telegram", chat: "555001", name: "Someone", text: "Привет", messageId: "555001:1" })).toBeNull();
    await receive({ channel: "telegram", chat: "555001", name: "Someone", text: "Ещё вопрос", messageId: "555001:2" });
    expect(data().chat_messages.filter((m) => m.conversation_id === first!.conversation.id)).toHaveLength(2);
    expect(data().activities.filter((a) => a.contact_id === contact.id && a.subject.startsWith("Telegram from"))).toHaveLength(2);
  });

  it("turns an unknown website visitor into a lead", async () => {
    const r = await receive({ channel: "site", chat: "8c1e3f8a-1111-4222-8333-444455556666", name: "Пётр", text: "Нужна консультация", email: "petr@example.com" });
    const lead = data().leads.find((l) => l.id === r!.conversation.lead_id)!;
    expect(lead).toMatchObject({ title: "Website chat: Пётр", email: "petr@example.com", source: "website" });
  });

  it("shows conversations by visibility and replies through the channel", async () => {
    const mine = data().contacts.find((c) => c.owner_id === DEMO_USER_IDS.repDaniel && c.phone && !c.archived_at)!;
    const other = data().contacts.find((c) => c.owner_id === DEMO_USER_IDS.repSofia && c.phone && !c.archived_at)!;
    const a = await receive({ channel: "whatsapp", chat: "79990000001", name: "A", text: "hi", messageId: "w1", phone: mine.phone });
    const b = await receive({ channel: "whatsapp", chat: "79990000002", name: "B", text: "hi", messageId: "w2", phone: other.phone });
    const repList = (await listConversations(rep())).rows.map((c) => c.id);
    expect(repList).toContain(a!.conversation.id);
    expect(repList).not.toContain(b!.conversation.id);
    await expect(openConversation(rep(), b!.conversation.id)).rejects.toThrow(/not found/);

    const view = await openConversation(rep(), a!.conversation.id);
    expect(view.conversation.unread).toBe(false);
    const { senders, sent } = fakeSenders();
    await replyToConversation(rep(), senders, { conversation_id: a!.conversation.id, text: "Добрый день!" });
    expect(sent).toEqual([{ channel: "whatsapp", chat: "79990000001", text: "Добрый день!" }]);
    expect(data().chat_messages.find((m) => m.direction === "out" && m.body === "Добрый день!")).toMatchObject({ author_id: DEMO_USER_IDS.repDaniel, external_id: "m-1" });
    expect(data().activities.some((a2) => a2.subject === "Reply in WhatsApp: Добрый день!" && a2.actor_id === DEMO_USER_IDS.repDaniel)).toBe(true);
    await expect(replyToConversation(rep(), senders, { conversation_id: b!.conversation.id, text: "x" })).rejects.toThrow();
  });

  it("does not reply through a channel that is not connected, and closes conversations", async () => {
    const r = await receive({ channel: "vk", chat: "2000000001", name: "VK id1", text: "hello", messageId: "vk1", handle: "1" });
    const off = fakeSenders(false);
    await expect(replyToConversation(admin(), off.senders, { conversation_id: r!.conversation.id, text: "x" })).rejects.toThrow(/not connected/);
    expect(off.sent).toEqual([]);
    await setConversationStatus(admin(), { id: r!.conversation.id, status: "closed" });
    expect((await listConversations(admin(), { status: "closed" })).rows.map((c) => c.id)).toContain(r!.conversation.id);
    // A new message reopens it.
    await receive({ channel: "vk", chat: "2000000001", name: "VK id1", text: "again", messageId: "vk2" });
    expect(data().conversations.find((c) => c.id === r!.conversation.id)?.status).toBe("open");
  });

  it("knows which channels can send", () => {
    const senders = channelSenders({ TELEGRAM_BOT_TOKEN: "1:abc", VK_GROUP_TOKEN: "" } as unknown as NodeJS.ProcessEnv);
    expect(senders.telegram.configured).toBe(true);
    expect(senders.vk.configured).toBe(false);
    expect(senders.whatsapp.configured).toBe(false);
  });

  it("assigns chats to the record owner, and lets reps only take them", async () => {
    const chat = data().conversations.find((c) => c.contact_id)!;
    const owner = data().contacts.find((c) => c.id === chat.contact_id)!.owner_id;
    expect(chat.assignee_id).toBe(owner);
    await assignConversation(admin(), { id: chat.id, assignee_id: DEMO_USER_IDS.manager });
    expect(data().conversations.find((c) => c.id === chat.id)?.assignee_id).toBe(DEMO_USER_IDS.manager);
    const mine = await listConversations(ctxFor(db, data(), DEMO_USER_IDS.manager), { mine: true });
    expect(mine.rows.map((r) => r.id)).toContain(chat.id);
    expect(mine.rows.every((r) => r.assignee_id === DEMO_USER_IDS.manager)).toBe(true);
    await expect(assignConversation(rep(), { id: chat.id, assignee_id: DEMO_USER_IDS.repSofia })).rejects.toThrow(/admins and managers/);
  });

  it("keeps the organization's quick replies (admins and managers)", async () => {
    expect(await getQuickReplies(admin())).toEqual([]);
    await saveQuickReplies(admin(), { replies: ["Здравствуйте!", "Спасибо за заказ"] });
    expect(await getQuickReplies(rep())).toEqual(["Здравствуйте!", "Спасибо за заказ"]);
    await expect(saveQuickReplies(rep(), { replies: [] })).rejects.toThrow();
  });

  it("opens a deal for the chat's contact", async () => {
    const chat = data().conversations.find((c) => c.contact_id && data().contacts.find((x) => x.id === c.contact_id)?.company_id)!;
    const contact = data().contacts.find((x) => x.id === chat.contact_id)!;
    const deal = await dealFromConversation(admin(), { id: chat.id });
    expect(deal).toMatchObject({ primary_contact_id: contact.id, company_id: contact.company_id, owner_id: DEMO_USER_IDS.admin });
    const leadChat = data().conversations.find((c) => c.lead_id)!;
    await expect(dealFromConversation(admin(), { id: leadChat.id })).rejects.toThrow(/convert the lead/);
  });
});
