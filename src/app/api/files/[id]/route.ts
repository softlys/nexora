import { fileStore } from "@/server/files";
import { DomainError } from "@/server/repositories/types";
import { getServiceContext } from "@/server/service-action";
import { flushSecurityEvents } from "@/server/services/context";
import { INLINE_TYPES, openAttachment } from "@/server/services/attachments";

/** Downloads a file for a signed-in user who can see its record. Images and PDFs open in the browser. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const ctx = await getServiceContext();
  try {
    const { attachment, bytes } = await openAttachment(ctx, fileStore(), id);
    const inline = INLINE_TYPES.has(attachment.content_type);
    return new Response(new Blob([bytes as BlobPart]), {
      headers: {
        "Content-Type": inline ? attachment.content_type : "application/octet-stream",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(attachment.file_name)}`,
        // The browser's PDF viewer does not run in a sandbox; every other file does.
        ...(attachment.content_type === "application/pdf" ? {} : { "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" }),
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    if (error instanceof DomainError) return new Response("Not found", { status: 404 });
    throw error;
  } finally {
    await flushSecurityEvents(ctx);
  }
}
