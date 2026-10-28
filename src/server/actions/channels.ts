"use server";

import { revalidatePath } from "next/cache";
import { serviceAction } from "@/server/service-action";
import { setAdSpend, spendInput } from "@/server/services/channels";

/** Records a channel's ad spend for a month. */
export async function setAdSpendAction(input: unknown) {
  return serviceAction({ name: "setAdSpend", schema: spendInput }, input, async (ctx, data) => {
    await setAdSpend(ctx, data);
    revalidatePath("/analytics/channels");
    return undefined;
  });
}
