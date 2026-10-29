import { z } from "zod";
import { ATTACHMENT_ENTITIES } from "@/domain/entities";
import { fileStore } from "@/server/files";
import { DomainError } from "@/server/repositories/types";
import { hitRateLimit } from "@/server/security/rate-limit";
import { supabaseCounter } from "@/server/security/shared-counter";
import { getServiceContext } from "@/server/service-action";
import { flushSecurityEvents } from "@/server/services/context";
import { MAX_FILE_BYTES, uploadAttachment } from "@/server/services/attachments";

/** Upload a file to a record card or a chat (multipart: file, entity, entity_id). Signed-in users only. */
const target = z.object({ entity: z.enum(ATTACHMENT_ENTITIES), entity_id: z.uuid() });

export async function POST(request: Request) {
  const ctx = await getServiceContext();
  try {
    const limit = await hitRateLimit(ctx.actor.id, "create", supabaseCounter());
    if (!limit.allowed) return Response.json({ error: "Too many uploads. Please wait a minute." }, { status: 429 });
    if (Number(request.headers.get("content-length") ?? 0) > MAX_FILE_BYTES + 64 * 1024) return Response.json({ error: "The file is larger than 10 MB." }, { status: 413 });
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    const parsed = target.safeParse({ entity: form?.get("entity"), entity_id: form?.get("entity_id") });
    if (!parsed.success || !(file instanceof File)) return Response.json({ error: "Choose a file." }, { status: 400 });
    const row = await uploadAttachment(ctx, fileStore(), parsed.data, { file_name: file.name, content_type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
    return Response.json({ id: row.id, file_name: row.file_name, size: row.size, content_type: row.content_type });
  } catch (error) {
    if (error instanceof DomainError) return Response.json({ error: error.message }, { status: error.code === "not_found" ? 404 : 400 });
    throw error;
  } finally {
    await flushSecurityEvents(ctx);
  }
}
