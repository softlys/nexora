import type { AttachmentEntity } from "@/domain/entities";
import { loadPage } from "@/server/page-data";
import { listAttachments } from "@/server/services/attachments";
import { AttachmentList, type AttachmentItem } from "./attachments-client";

/** The "Files" panel of a record card: upload, open, remove. */
export async function Attachments({ entity, id, canUpload }: { entity: AttachmentEntity; id: string; canUpload: boolean }) {
  const { rows, me, admin } = await loadPage(async (ctx) => ({ rows: await listAttachments(ctx, entity, id), me: ctx.actor.id, admin: ctx.actor.role === "admin" }));
  const items: AttachmentItem[] = rows.map((a) => ({ id: a.id, file_name: a.file_name, size: a.size, content_type: a.content_type, created_at: a.created_at, uploader: a.uploader, canRemove: a.uploaded_by === me || admin }));
  return <AttachmentList entity={entity} entityId={id} items={items} canUpload={canUpload} />;
}
