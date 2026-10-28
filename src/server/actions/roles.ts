"use server";

import { revalidatePath } from "next/cache";
import { serviceAction } from "@/server/service-action";
import { roleRestrictionInput, saveRoleRestrictions } from "@/server/services/roles";

/** Admin: what managers or sales reps may see and do, per record type. */
export async function saveRoleRestrictionsAction(input: unknown) {
  return serviceAction({ name: "saveRoleRestrictions", schema: roleRestrictionInput }, input, async (ctx, data) => {
    await saveRoleRestrictions(ctx, data);
    revalidatePath("/", "layout");
    return undefined;
  });
}
