"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { serviceAction } from "@/server/service-action";
import { archiveCustomField, customFieldInput, saveCustomField } from "@/server/services/custom-fields";

/** Record lists and pages render the fields, so they are refreshed with the settings page. */
function refresh() {
  revalidatePath("/settings/fields");
  revalidatePath("/", "layout");
}

/** Admin: add a custom field or change its label, values and whether it is required. */
export async function saveCustomFieldAction(input: unknown) {
  return serviceAction({ name: "saveCustomField", schema: customFieldInput }, input, async (ctx, data) => {
    const field = await saveCustomField(ctx, data);
    refresh();
    return { id: field.id };
  });
}

/** Admin: hide a custom field; saved values stay on the records. */
export async function archiveCustomFieldAction(input: unknown) {
  return serviceAction({ name: "archiveCustomField", schema: z.object({ id: z.uuid() }).strict() }, input, async (ctx, { id }) => {
    await archiveCustomField(ctx, id);
    refresh();
    return undefined;
  });
}
