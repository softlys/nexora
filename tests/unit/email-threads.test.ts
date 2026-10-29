import { describe, expect, it } from "vitest";
import type { EmailMessage } from "@/server/automation/engine";
import { recordMessages } from "@/server/integrations/mail";
import { sendEmailInput, sendRecordEmail } from "@/server/services/email";
import { emailThreads, threadSubject } from "@/server/services/email-threads";
import { createTestDb, ctxFor, DEMO_USER_IDS } from "./helpers/services";

describe("e-mail threads on a card", () => {
  it("ignores reply and forward prefixes", () => {
    expect(threadSubject("Re: RE: Fwd: Счёт на оплату")).toBe("Счёт на оплату");
    expect(threadSubject("Ответ: Пересл: КП")).toBe("КП");
    expect(threadSubject("")).toBe("(no subject)");
  });

  it("puts synced and sent e-mails into threads and replies to the last incoming one", async () => {
    const { db, data } = createTestDb();
    const admin = ctxFor(db, data(), DEMO_USER_IDS.admin);
    const contact = data().contacts.find((c) => c.email && !c.archived_at)!;
    await recordMessages(admin, "sales@atlasford.example", [
      { messageId: "<a1@client>", folder: "INBOX", uid: 1, date: "2026-10-17T09:00:00Z", subject: "Счёт на оплату", from: contact.email, to: ["sales@atlasford.example"], text: "Пришлите счёт, пожалуйста." },
      { messageId: "<a2@client>", folder: "INBOX", uid: 2, date: "2026-10-18T09:00:00Z", subject: "Другой вопрос", from: contact.email, to: ["sales@atlasford.example"], text: "Есть вопрос по доставке." },
    ]);
    const sent: EmailMessage[] = [];
    const sender = { configured: true, send: async (m: EmailMessage) => (sent.push(m), { id: "x" }) };
    await sendRecordEmail(admin, sender, sendEmailInput.parse({ to: contact.email, subject: "Re: Счёт на оплату", body: "Счёт во вложении.", contact_id: contact.id, in_reply_to: "<a1@client>" }));
    expect(sent[0]).toMatchObject({ inReplyTo: "<a1@client>" });

    const threads = await emailThreads(admin, { contact_id: contact.id });
    const invoice = threads.find((t) => t.subject === "Счёт на оплату")!;
    expect(invoice.messages.map((m) => [m.direction, m.body])).toEqual([
      ["in", "Пришлите счёт, пожалуйста."],
      ["out", "Счёт во вложении."],
    ]);
    expect(invoice).toMatchObject({ reply_to: contact.email, in_reply_to: "<a1@client>" });
    expect(threads.find((t) => t.subject === "Другой вопрос")?.messages).toHaveLength(1);
    await expect(emailThreads(ctxFor(db, data(), DEMO_USER_IDS.repEthan), { contact_id: data().contacts.find((c) => c.owner_id === DEMO_USER_IDS.repSofia)!.id })).rejects.toThrow();
  });
});
