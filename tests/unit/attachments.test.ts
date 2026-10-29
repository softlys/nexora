import { describe, expect, it } from "vitest";
import type { FileStore } from "@/server/files";
import { receiveMessage, type ChannelSenders } from "@/server/integrations/chat";
import { archiveAttachment, listAttachments, openAttachment, uploadAttachment } from "@/server/services/attachments";
import { openConversation, replyToConversation } from "@/server/services/inbox";
import { createTestDb, ctxFor, DEMO_ORG_ID, DEMO_USER_IDS } from "./helpers/services";

function memoryStore(): FileStore & { keys: () => string[] } {
  const files = new Map<string, Uint8Array>();
  return { put: async (k, b) => void files.set(k, b), get: async (k) => files.get(k) ?? null, keys: () => [...files.keys()] };
}
const pdf = (name = "КП.pdf") => ({ file_name: name, content_type: "application/pdf", bytes: new TextEncoder().encode("%PDF-1.4 test") });

describe("files", () => {
  it("adds files to records the user can see, and only the uploader or an admin removes them", async () => {
    const { db, data } = createTestDb();
    const store = memoryStore();
    const daniel = ctxFor(db, data(), DEMO_USER_IDS.repDaniel);
    const own = data().deals.find((d) => d.owner_id === DEMO_USER_IDS.repDaniel)!;
    const other = data().deals.find((d) => d.owner_id === DEMO_USER_IDS.repSofia)!;
    const a = await uploadAttachment(daniel, store, { entity: "deal", entity_id: own.id }, pdf());
    expect(store.keys()).toEqual([`${DEMO_ORG_ID}/${a.id}`]);
    await expect(uploadAttachment(daniel, store, { entity: "deal", entity_id: other.id }, pdf())).rejects.toThrow();
    await expect(uploadAttachment(daniel, store, { entity: "deal", entity_id: own.id }, pdf("run.exe"))).rejects.toThrow(/cannot be attached/);
    await expect(uploadAttachment(daniel, store, { entity: "deal", entity_id: own.id }, { ...pdf(), bytes: new Uint8Array(11 * 1024 * 1024) })).rejects.toThrow(/10 MB/);
    expect((await listAttachments(daniel, "deal", own.id)).map((x) => x.file_name)).toEqual(["КП.pdf"]);
    expect(new TextDecoder().decode((await openAttachment(daniel, store, a.id)).bytes)).toContain("%PDF");
    await expect(openAttachment(ctxFor(db, data(), DEMO_USER_IDS.repEthan), store, a.id)).rejects.toThrow();
    await expect(archiveAttachment(ctxFor(db, data(), DEMO_USER_IDS.manager), a.id)).rejects.toThrow(/added the file/);
    await archiveAttachment(ctxFor(db, data(), DEMO_USER_IDS.admin), a.id);
    expect(await listAttachments(daniel, "deal", own.id)).toEqual([]);
  });

  it("keeps photos from customers and sends files in Telegram replies", async () => {
    const { db, data } = createTestDb();
    const store = memoryStore();
    const admin = ctxFor(db, data(), DEMO_USER_IDS.admin);
    const got = await db.write(DEMO_ORG_ID, (tx) => receiveMessage(tx, admin, { channel: "telegram", chat: "777001", name: "Фото Клиент", text: "📷 Вот шильдик", messageId: "777001:1", files: [] }));
    const conversation = got!.conversation.id;
    const sentFiles: string[] = [];
    const senders = {
      telegram: { configured: true, send: async () => ({ id: "t1" }), sendFile: async (_c: string, f: { file_name: string }, caption: string) => (sentFiles.push(`${f.file_name}|${caption}`), { id: "t2" }) },
      whatsapp: { configured: true, send: async () => ({ id: null }) },
      vk: { configured: true, send: async () => ({ id: null }) },
      avito: { configured: true, send: async () => ({ id: null }) },
      instagram: { configured: true, send: async () => ({ id: null }) },
      site: { configured: true, send: async () => ({ id: null }) },
    } satisfies ChannelSenders;
    const upload = await uploadAttachment(admin, store, { entity: "conversation", entity_id: conversation }, pdf("Прайс.pdf"));
    await replyToConversation(admin, senders, { conversation_id: conversation, text: "Высылаю прайс", attachment_ids: [upload.id] }, store);
    expect(sentFiles).toEqual(["Прайс.pdf|Высылаю прайс"]);
    const view = await openConversation(admin, conversation);
    expect(view.messages.find((m) => m.direction === "out")).toMatchObject({ body: "Высылаю прайс", files: [{ id: upload.id, file_name: "Прайс.pdf" }] });
    // A file already sent cannot be sent again.
    await expect(replyToConversation(admin, senders, { conversation_id: conversation, text: "", attachment_ids: [upload.id] }, store)).rejects.toThrow(/not found/);
  });
});
