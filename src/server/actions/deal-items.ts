"use server";

import { revalidatePath } from "next/cache";
import { serviceAction } from "@/server/service-action";
import { dealItemsInput, setDealItems } from "@/server/services/deal-items";

/** Saves the product lines of a deal; the deal amount becomes their total. */
export async function setDealItemsAction(input: unknown) {
  return serviceAction({ name: "setDealItems", schema: dealItemsInput }, input, async (ctx, data) => {
    const result = await setDealItems(ctx, data);
    revalidatePath(`/deals/${data.deal_id}`);
    revalidatePath("/pipeline");
    return { total: result.totals.total, count: result.items.length };
  });
}
