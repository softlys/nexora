"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCan } from "@/domain/permissions";
import { getRepoContext } from "@/server/auth";
import { runAction } from "@/server/action-result";
import { getRepositories } from "@/server/repositories";

const markReadInput = z.object({ ids: z.union([z.literal("all"), z.array(z.uuid()).min(1).max(50)]) }).strict();

export async function markNotificationsReadAction(input: unknown) {
  return runAction(async () => {
    const { ctx } = await getRepoContext();
    assertCan(ctx.actor, "update", "notification");
    const { ids } = markReadInput.parse(input);
    await getRepositories().notifications.markRead(ctx, ids);
    revalidatePath("/", "layout");
    return undefined;
  });
}
