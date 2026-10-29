"use server";

import { revalidatePath } from "next/cache";
import { serviceAction } from "@/server/service-action";
import { saveWebForm, webFormInput } from "@/server/services/web-forms";

/** Admin: creates or updates a website form. */
export async function saveWebFormAction(input: unknown) {
  return serviceAction({ name: "saveWebForm", schema: webFormInput }, input, async (ctx, data) => {
    const form = await saveWebForm(ctx, data);
    revalidatePath("/settings/forms");
    return { id: form.id };
  });
}
