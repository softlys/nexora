import { z } from "zod";
import { diffFields } from "@/domain/diff";
import type { DealItem } from "@/domain/entities";
import { computeLineTotals, computeOrderTotals, type OrderTotals } from "@/domain/orders/totals";
import type { Tx } from "@/server/db/types";
import { DomainError } from "@/server/repositories/types";
import { emit, newId, nowOf, requireCan, type ServiceContext } from "./context";
import { getOwned } from "./records";

/**
 * Products in deals (товары в сделке). Lines are edited as a whole list; with lines the deal amount
 * is their total, so the pipeline, forecasts and the order made from the won deal agree with them.
 */

export const dealLineInput = z
  .object({
    product_id: z.uuid().nullable().optional(),
    description: z.string().trim().min(1, "Required").max(255),
    quantity: z.coerce.number().positive("Must be more than 0").max(1_000_000),
    unit_price: z.coerce.number().min(0, "Cannot be negative").max(1_000_000_000),
    discount_pct: z.coerce.number().min(0).max(100).default(0),
    tax_rate: z.coerce.number().min(0).max(100).default(0),
  })
  .strict();

export const dealItemsInput = z.object({ deal_id: z.uuid(), items: z.array(dealLineInput).max(100) }).strict();

export async function dealItemsOf(tx: Tx, dealId: string): Promise<DealItem[]> {
  return (await tx.find("deal_items", { deal_id: dealId })).sort((a, b) => a.position - b.position);
}

export function dealItemTotals(items: readonly DealItem[]): OrderTotals {
  return computeOrderTotals(items.map((i) => ({ quantity: Number(i.quantity), unit_price: Number(i.unit_price), discount_pct: Number(i.discount_pct), tax_rate: Number(i.tax_rate) })));
}

/** Replaces the deal's lines and sets its amount to their total (an empty list keeps the amount). */
export async function setDealItems(ctx: ServiceContext, input: z.output<typeof dealItemsInput>): Promise<{ items: DealItem[]; totals: OrderTotals }> {
  return ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const deal = await getOwned(tx, ctx, "deals", input.deal_id);
    requireCan(ctx, "update", "deal", deal.owner_id, deal.id);
    if (deal.closed_at && ctx.actor.role === "sales_rep") throw new DomainError("Products of a closed deal can only be changed by a manager or an admin.", "conflict");
    for (const line of input.items) {
      if (line.product_id && !(await tx.get("products", line.product_id))) throw new DomainError("Product not found.", "not_found");
    }
    const at = nowOf(ctx).toISOString();
    for (const old of await tx.find("deal_items", { deal_id: deal.id })) await tx.remove("deal_items", old.id);
    const items: DealItem[] = [];
    for (const [position, line] of input.items.entries()) {
      const item: DealItem = {
        id: newId(),
        organization_id: ctx.actor.organization_id,
        deal_id: deal.id,
        product_id: line.product_id ?? null,
        description: line.description,
        quantity: line.quantity,
        unit_price: line.unit_price,
        discount_pct: line.discount_pct,
        tax_rate: line.tax_rate,
        line_total: computeLineTotals(line).total,
        position,
        created_at: at,
        updated_at: at,
      };
      await tx.insert("deal_items", item);
      items.push(item);
    }
    const totals = dealItemTotals(items);
    const patch = items.length ? { amount: totals.total } : {};
    const changes = { ...diffFields(deal as unknown as Record<string, unknown>, patch), products: { before: null, after: `${items.length}` } };
    if (items.length && totals.total !== deal.amount) await tx.update("deals", deal.id, { amount: totals.total, updated_at: at });
    await emit(tx, ctx, { type: "record.updated", payload: { entity: "deal", id: deal.id, changes } });
    return { items, totals };
  });
}
