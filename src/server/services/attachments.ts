import type { Attachment, AttachmentEntity } from "@/domain/entities";
import type { Tx } from "@/server/db/types";
import type { FileStore } from "@/server/files";
import { DomainError } from "@/server/repositories/types";
import { newId, nowOf, requireCan, type ServiceContext } from "./context";
import { visibleConversation } from "./inbox";
import { assertLinksVisible } from "./records";

/**
 * Files on record cards (companies, contacts, leads, deals, orders) and in chats. A file can be seen
 * by whoever can see its record; the uploader or an admin can remove it (archived, never deleted).
 */

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Shown in the browser; everything else is downloaded, so an uploaded page or script never runs. */
export const INLINE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"]);
const BLOCKED = /\.(exe|bat|cmd|com|msi|scr|js|vbs|ps1|sh|html?|svg)$/i;

const LINK_KEY: Record<Exclude<AttachmentEntity, "conversation">, "company_id" | "contact_id" | "lead_id" | "deal_id" | "order_id"> = { company: "company_id", contact: "contact_id", lead: "lead_id", deal: "deal_id", order: "order_id" };

/** Throws unless the user can see the record (or chat) the file belongs to. */
export async function assertTargetVisible(tx: Tx, ctx: ServiceContext, entity: AttachmentEntity, id: string): Promise<void> {
  if (entity === "conversation") await visibleConversation(tx, ctx, id);
  else await assertLinksVisible(tx, ctx, { [LINK_KEY[entity]]: id });
}

export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f"<>|*?:]/g, "_").trim();
  return (base || "file").slice(0, 255);
}

export type NewFile = { file_name: string; content_type: string; bytes: Uint8Array };

/** Stores the bytes, then the attachment row (inside the caller's transaction). */
export async function storeAttachment(tx: Tx, ctx: ServiceContext, store: FileStore, target: { entity: AttachmentEntity; entity_id: string; chat_message_id?: string | null }, file: NewFile, uploadedBy: string | null): Promise<Attachment> {
  const fileName = cleanFileName(file.file_name);
  if (file.bytes.byteLength === 0) throw new DomainError("The file is empty.");
  if (file.bytes.byteLength > MAX_FILE_BYTES) throw new DomainError("The file is larger than 10 MB.");
  if (BLOCKED.test(fileName)) throw new DomainError("This type of file cannot be attached.");
  const id = newId();
  const key = `${ctx.actor.organization_id}/${id}`;
  const contentType = /^[\w.+-]+\/[\w.+-]+$/.test(file.content_type) ? file.content_type.slice(0, 127) : "application/octet-stream";
  await store.put(key, file.bytes, contentType);
  const row: Attachment = { id, organization_id: ctx.actor.organization_id, entity: target.entity, entity_id: target.entity_id, chat_message_id: target.chat_message_id ?? null, file_name: fileName, content_type: contentType, size: file.bytes.byteLength, storage_key: key, uploaded_by: uploadedBy, archived_at: null, created_at: nowOf(ctx).toISOString() };
  await tx.insert("attachments", row);
  return row;
}

export async function listAttachments(ctx: ServiceContext, entity: AttachmentEntity, entityId: string): Promise<Array<Attachment & { uploader: string | null }>> {
  return ctx.db.read(ctx.actor.organization_id, async (tx) => {
    await assertTargetVisible(tx, ctx, entity, entityId);
    const names = new Map((await tx.find("profiles")).map((p) => [p.id, p.full_name]));
    return (await tx.find("attachments", { entity, entity_id: entityId, archived_at: null })).sort((a, b) => b.created_at.localeCompare(a.created_at)).map((a) => ({ ...a, uploader: a.uploaded_by ? (names.get(a.uploaded_by) ?? null) : null }));
  });
}

/** A user adds a file to a record card or a chat. */
export async function uploadAttachment(ctx: ServiceContext, store: FileStore, target: { entity: AttachmentEntity; entity_id: string }, file: NewFile): Promise<Attachment> {
  requireCan(ctx, "create", "activity");
  return ctx.db.write(ctx.actor.organization_id, async (tx) => {
    await assertTargetVisible(tx, ctx, target.entity, target.entity_id);
    return storeAttachment(tx, ctx, store, target, file, ctx.actor.id);
  });
}

/** The file and its bytes, for a user who can see its record. */
export async function openAttachment(ctx: ServiceContext, store: FileStore, id: string): Promise<{ attachment: Attachment; bytes: Uint8Array }> {
  const attachment = await ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const a = await tx.get("attachments", id);
    if (!a || a.archived_at) throw new DomainError("File not found.", "not_found");
    await assertTargetVisible(tx, ctx, a.entity, a.entity_id);
    return a;
  });
  const bytes = await store.get(attachment.storage_key);
  if (!bytes) throw new DomainError("File not found.", "not_found");
  return { attachment, bytes };
}

export async function archiveAttachment(ctx: ServiceContext, id: string): Promise<void> {
  await ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const a = await tx.get("attachments", id);
    if (!a || a.archived_at) throw new DomainError("File not found.", "not_found");
    await assertTargetVisible(tx, ctx, a.entity, a.entity_id);
    if (a.uploaded_by !== ctx.actor.id && ctx.actor.role !== "admin") throw new DomainError("Only the person who added the file or an admin can remove it.");
    await tx.update("attachments", id, { archived_at: nowOf(ctx).toISOString() });
  });
}
