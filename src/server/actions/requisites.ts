"use server";

import { revalidatePath } from "next/cache";
import { serviceAction } from "@/server/service-action";
import { requisitesInput, saveRequisites } from "@/server/services/requisites";

/** Admin: legal details, stamp and signature for invoices and quotes. */
export async function saveRequisitesAction(input: unknown) {
  return serviceAction({ name: "saveRequisites", schema: requisitesInput }, input, async (ctx, data) => {
    await saveRequisites(ctx, data);
    revalidatePath("/settings/requisites");
    return undefined;
  });
}
