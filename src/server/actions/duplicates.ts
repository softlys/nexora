"use server";

import { revalidatePath } from "next/cache";
import { serviceAction } from "@/server/service-action";
import { duplicateProbeInput, findDuplicates, mergeInput, mergeRecords } from "@/server/services/duplicates";

/** Possible duplicates of a record being entered, for the warning in create forms. */
export async function findDuplicatesAction(input: unknown) {
  return serviceAction({ name: "findDuplicates", schema: duplicateProbeInput, readOnly: true }, input, (ctx, data) => findDuplicates(ctx, data));
}

/** Admin: merge companies or contacts into one. */
export async function mergeDuplicatesAction(input: unknown) {
  return serviceAction({ name: "mergeDuplicates", schema: mergeInput }, input, async (ctx, data) => {
    const result = await mergeRecords(ctx, data);
    revalidatePath("/duplicates");
    revalidatePath(data.entity === "company" ? "/companies" : "/contacts", "layout");
    return result;
  });
}
