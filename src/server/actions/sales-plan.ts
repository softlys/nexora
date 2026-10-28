"use server";

import { revalidatePath } from "next/cache";
import { serviceAction } from "@/server/service-action";
import { setTarget, targetInput } from "@/server/services/sales-plan";

/** Sets a person's monthly sales target. */
export async function setTargetAction(input: unknown) {
  return serviceAction({ name: "setSalesTarget", schema: targetInput }, input, async (ctx, data) => {
    await setTarget(ctx, data);
    revalidatePath("/plan");
    return undefined;
  });
}
