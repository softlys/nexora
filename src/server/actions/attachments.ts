"use server";

import { z } from "zod";
import { serviceAction } from "@/server/service-action";
import { archiveAttachment } from "@/server/services/attachments";

/** Removes a file from a card or chat (archived; the uploader or an admin). */
export async function archiveAttachmentAction(input: unknown) {
  return serviceAction({ name: "archiveAttachment", schema: z.object({ id: z.uuid() }).strict() }, input, async (ctx, data) => {
    await archiveAttachment(ctx, data.id);
    return undefined;
  });
}
