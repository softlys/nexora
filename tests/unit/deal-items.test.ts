import { beforeEach, describe, expect, it } from "vitest";
import type { Dataset } from "@/domain/entities";
import { dealUpdateInput } from "@/domain/inputs";
import type { Db } from "@/server/db/types";
import { dealItemsInput, setDealItems } from "@/server/services/deal-items";
import { getDeal, moveDealStage, updateDeal } from "@/server/services/deals";
import { convertDealToOrder } from "@/server/services/orders";
import { createTestDb, ctxFor, DEMO_USER_IDS } from "./helpers/services";

describe("products in deals", () => {
  let db: Db;
  let data: () => Dataset;
  beforeEach(() => {
    ({ db, data } = createTestDb());
  });
  const admin = () => ctxFor(db, data(), DEMO_USER_IDS.admin);
  const rep = () => ctxFor(db, data(), DEMO_USER_IDS.repDaniel);
  const openDeal = () => data().deals.find((d) => d.owner_id === DEMO_USER_IDS.repDaniel && !d.closed_at && !d.archived_at)!;
  const product = () => data().products.find((p) => p.is_active && !p.archived_at)!;

  it("sets the deal amount to the total of its lines", async () => {
    const deal = openDeal();
    const p = product();
    const { totals } = await setDealItems(
      rep(),
      dealItemsInput.parse({
        deal_id: deal.id,
        items: [
          { product_id: p.id, description: p.name, quantity: 2, unit_price: 1000, discount_pct: 10, tax_rate: 20 },
          { description: "Монтаж", quantity: 1, unit_price: 500 },
        ],
      }),
    );
    // 2 × 1000 − 10% = 1800, + 20% tax = 2160; plus 500.
    expect(totals.total).toBe(2660);
    expect(data().deals.find((d) => d.id === deal.id)?.amount).toBe(2660);
    const view = await getDeal(rep(), deal.id);
    expect(view.items.map((i) => i.description)).toEqual([p.name, "Монтаж"]);
    expect(view.itemTotals).toMatchObject({ subtotal: 2500, discount_total: 200, tax_total: 360, total: 2660 });
  });

  it("keeps the amount from the lines when the deal form is saved", async () => {
    const deal = openDeal();
    await setDealItems(rep(), dealItemsInput.parse({ deal_id: deal.id, items: [{ description: "Насос", quantity: 3, unit_price: 100 }] }));
    const current = data().deals.find((d) => d.id === deal.id)!;
    const updated = await updateDeal(
      rep(),
      dealUpdateInput.parse({ id: deal.id, name: "Новое имя", company_id: current.company_id, primary_contact_id: current.primary_contact_id, amount: 1, currency: current.currency, expected_close_date: current.expected_close_date, source: current.source, next_activity: "", notes: "" }),
    );
    expect(updated).toMatchObject({ name: "Новое имя", amount: 300 });
  });

  it("copies the lines into the order made from the won deal", async () => {
    const deal = openDeal();
    await setDealItems(admin(), dealItemsInput.parse({ deal_id: deal.id, items: [{ description: "Компрессор", quantity: 2, unit_price: 700, tax_rate: 20 }, { description: "Доставка", quantity: 1, unit_price: 100 }] }));
    const won = data().pipeline_stages.find((s) => s.is_won && data().pipeline_stages.find((x) => x.id === deal.stage_id)?.pipeline_id === s.pipeline_id)!;
    await moveDealStage(admin(), { deal_id: deal.id, stage_id: won.id } as never);
    const { order } = await convertDealToOrder(admin(), deal.id);
    const lines = data().order_items.filter((i) => i.order_id === order.id).sort((a, b) => a.position - b.position);
    expect(lines.map((l) => [l.description, l.quantity, l.unit_price])).toEqual([
      ["Компрессор", 2, 700],
      ["Доставка", 1, 100],
    ]);
    expect(order.total).toBe(1780);
  });

  it("rejects lines on deals the user cannot see and reps editing closed deals", async () => {
    const other = data().deals.find((d) => d.owner_id === DEMO_USER_IDS.repSofia && !d.archived_at)!;
    await expect(setDealItems(rep(), dealItemsInput.parse({ deal_id: other.id, items: [] }))).rejects.toThrow();
    const closed = data().deals.find((d) => d.owner_id === DEMO_USER_IDS.repDaniel && d.closed_at && !d.archived_at);
    if (closed) await expect(setDealItems(rep(), dealItemsInput.parse({ deal_id: closed.id, items: [] }))).rejects.toThrow(/closed deal/);
    expect(dealItemsInput.safeParse({ deal_id: other.id, items: [{ description: "x", quantity: 0, unit_price: 1 }] }).success).toBe(false);
  });
});
