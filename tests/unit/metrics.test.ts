import { describe, expect, it } from "vitest";
import type { Deal, Order, Payment, PipelineStage, Task } from "@/domain/entities";
import {
  activeDeals,
  averageDealSize,
  bucketKeys,
  change,
  collected,
  conversionFunnel,
  conversionRate,
  dealsByStage,
  openPipeline,
  orderValue,
  ordersByStatus,
  outstandingReceivables,
  overdueTasks,
  pipelineDistribution,
  previousPeriod,
  receivablesAgeing,
  revenueSeries,
  salesByOwner,
  salesBySource,
  salesCycleDays,
  taskCompletionRate,
  weightedPipeline,
  wonDealValue,
  type MetricsInput,
  type Period,
} from "@/domain/metrics";

/*
 * Fixed fixture. Period under test: October 2026 (2026-10-01 .. 2026-10-31).
 *
 * Deals (amount, stage, created, closed):
 *   d1 10 000  Won   created Sep 01  closed Oct 05  owner A source referral
 *   d2 30 000  Won   created Oct 02  closed Oct 12  owner B source website
 *   d3  5 000  Lost  created Sep 20  closed Oct 15  owner A
 *   d4 20 000  Prop  created Oct 10  open (50%)     owner A
 *   d5  8 000  Qual  created Aug 01  open (20%)     owner B
 *   d6 99 000  Won   created Jun 01  closed Sep 10  (previous period)
 *   d7  1 000  Qual  archived                        (ignored everywhere)
 */
const ORG = "org";
const ts = "2026-01-01T00:00:00.000Z";
const stage = (id: string, name: string, position: number, probability: number, is_won = false, is_lost = false): PipelineStage => ({
  id, organization_id: ORG, name, position, probability, is_won, is_lost, created_at: ts, updated_at: ts,
});
const stages = [stage("qual", "Qualification", 0, 20), stage("prop", "Proposal", 1, 50), stage("won", "Won", 2, 100, true), stage("lost", "Lost", 3, 0, false, true)];

const deal = (id: string, amount: number, stage_id: string, created: string, closed: string | null, owner = "A", source: Deal["source"] = "website", archived = false): Deal => ({
  id, organization_id: ORG, name: id, company_id: "c", primary_contact_id: null, amount, currency: "USD", stage_id,
  probability: stages.find((s) => s.id === stage_id)!.probability, expected_close_date: null, owner_id: owner, source,
  next_activity: "", notes: "", lost_reason: null, stage_entered_at: created, closed_at: closed, lead_id: null,
  created_at: created, updated_at: created, archived_at: archived ? ts : null,
});

const deals: Deal[] = [
  deal("d1", 10_000, "won", "2026-09-01T10:00:00.000Z", "2026-10-05T10:00:00.000Z", "A", "referral"),
  deal("d2", 30_000, "won", "2026-10-02T10:00:00.000Z", "2026-10-12T10:00:00.000Z", "B", "website"),
  deal("d3", 5_000, "lost", "2026-09-20T10:00:00.000Z", "2026-10-15T10:00:00.000Z"),
  deal("d4", 20_000, "prop", "2026-10-10T10:00:00.000Z", null),
  deal("d5", 8_000, "qual", "2026-08-01T10:00:00.000Z", null, "B"),
  deal("d6", 99_000, "won", "2026-06-01T10:00:00.000Z", "2026-09-10T10:00:00.000Z"),
  deal("d7", 1_000, "qual", "2026-10-03T10:00:00.000Z", null, "A", "website", true),
];

const order = (id: string, total: number, status: Order["status"], order_date: string, payment_due_date: string | null): Order => ({
  id, organization_id: ORG, order_number: `NX-2026-${id}`, company_id: "c", source_deal_id: null, status, payment_status: "unpaid",
  fulfillment_status: "unfulfilled", currency: "USD", subtotal: total, discount_total: 0, tax_total: 0, total, order_date,
  payment_due_date, expected_delivery_date: null, delivered_at: null, owner_id: "A", notes: "", created_at: ts, updated_at: ts, archived_at: null,
});
const orders: Order[] = [
  order("0001", 1_000, "delivered", "2026-07-01", "2026-07-31"), // 92 days late at Oct 31 → 90+
  order("0002", 2_000, "confirmed", "2026-10-05", "2026-11-04"), // not due → 0-30
  order("0003", 4_000, "cancelled", "2026-10-06", "2026-11-05"), // excluded
  order("0004", 3_000, "draft", "2026-10-20", null), // draft: in order value, not a receivable
];
const payment = (id: string, order_id: string, amount: number, paid_at: string): Payment => ({
  id, organization_id: ORG, order_id, amount, currency: "USD", paid_at, method: "bank_transfer", reference: "", is_simulated: true, recorded_by: null, created_at: ts, updated_at: ts,
});
const payments: Payment[] = [
  payment("p1", "0001", 400, "2026-08-15T12:00:00.000Z"),
  payment("p2", "0002", 500, "2026-10-10T12:00:00.000Z"),
  payment("p3", "0002", 300, "2026-11-02T12:00:00.000Z"), // after the period
];
const task = (id: string, status: Task["status"], due_at: string | null, completed_at: string | null, created = "2026-09-01T00:00:00.000Z"): Task => ({
  id, organization_id: ORG, title: id, description: "", type: "todo", assignee_id: "A", created_by: null, due_at, priority: "medium", status, completed_at,
  company_id: null, contact_id: null, deal_id: null, order_id: null, created_at: created, updated_at: created, archived_at: null,
});
const tasks: Task[] = [
  task("t1", "done", "2026-10-03T09:00:00.000Z", "2026-10-02T09:00:00.000Z"),
  task("t2", "todo", "2026-10-20T09:00:00.000Z", null), // overdue at end of October
  task("t3", "done", "2026-10-25T09:00:00.000Z", "2026-11-03T09:00:00.000Z"), // overdue at Oct 31, completed later
  task("t4", "cancelled", "2026-10-10T09:00:00.000Z", null),
  task("t5", "todo", "2026-11-10T09:00:00.000Z", null),
];

const input: MetricsInput = { deals, stages, orders, payments, tasks };
const OCT: Period = { from: "2026-10-01", to: "2026-10-31" };
const NOW = new Date("2026-12-01T00:00:00Z");

describe("periods", () => {
  it("computes the previous period of equal length", () => {
    expect(previousPeriod(OCT)).toEqual({ from: "2026-08-31", to: "2026-09-30" });
    expect(previousPeriod({ from: "2026-10-10", to: "2026-10-16" })).toEqual({ from: "2026-10-03", to: "2026-10-09" });
  });
  it("computes relative change", () => {
    expect(change(150, 100)).toBe(0.5);
    expect(change(0, 0)).toBe(0);
    expect(change(10, 0)).toBeNull();
  });
});

describe("deal metrics", () => {
  it("won deal value counts deals closed won in the period only", () => {
    expect(wonDealValue(input, OCT)).toBe(40_000);
    expect(wonDealValue(input, previousPeriod(OCT))).toBe(99_000);
  });
  it("open pipeline, weighted pipeline and active deals are measured at the end of the period", () => {
    expect(openPipeline(input, OCT)).toBe(28_000);
    expect(weightedPipeline(input, OCT)).toBe(20_000 * 0.5 + 8_000 * 0.2);
    expect(activeDeals(input, OCT)).toBe(2);
    // End of September: d1 (created Sep 1, closed Oct 5), d3 (Sep 20 → Oct 15) and d5 were open.
    expect(openPipeline(input, previousPeriod(OCT))).toBe(10_000 + 5_000 + 8_000);
  });
  it("conversion rate is won / (won + lost) for deals closed in the period", () => {
    expect(conversionRate(input, OCT)).toBeCloseTo(2 / 3);
    expect(conversionRate(input, { from: "2026-01-01", to: "2026-01-31" })).toBeNull();
  });
  it("average deal size and sales cycle use won deals in the period", () => {
    expect(averageDealSize(input, OCT)).toBe(20_000);
    expect(salesCycleDays(input, OCT)).toBe(Math.round(((34 + 10) / 2) * 10) / 10);
  });
  it("breaks down won value by owner and source", () => {
    expect(salesByOwner(input, OCT)).toEqual([
      { owner_id: "B", won: 30_000, count: 1 },
      { owner_id: "A", won: 10_000, count: 1 },
    ]);
    expect(salesBySource(input, OCT).map((s) => s.source)).toEqual(["website", "referral"]);
  });
  it("groups deals created in the period by stage and ignores archived deals", () => {
    const byStage = dealsByStage(input, OCT);
    expect(byStage.find((s) => s.stage_id === "won")).toMatchObject({ count: 1, amount: 30_000 });
    expect(byStage.find((s) => s.stage_id === "prop")).toMatchObject({ count: 1, amount: 20_000 });
    expect(byStage.find((s) => s.stage_id === "qual")!.count).toBe(0);
  });
  it("builds a funnel from stage history", () => {
    const history = [
      { deal_id: "d2", to_stage_id: "qual" },
      { deal_id: "d2", to_stage_id: "prop" },
      { deal_id: "d2", to_stage_id: "won" },
      { deal_id: "d4", to_stage_id: "qual" },
      { deal_id: "d4", to_stage_id: "prop" },
    ];
    expect(conversionFunnel(input, history, OCT).map((s) => s.count)).toEqual([2, 2, 1]);
  });
  it("distributes the open pipeline by stage", () => {
    expect(pipelineDistribution(input, OCT)).toEqual([
      { stage_id: "qual", stage: "Qualification", count: 1, amount: 8_000, weighted: 1_600 },
      { stage_id: "prop", stage: "Proposal", count: 1, amount: 20_000, weighted: 10_000 },
    ]);
  });
});

describe("order and payment metrics", () => {
  it("order value excludes cancelled orders", () => {
    expect(orderValue(input, OCT)).toBe(2_000 + 3_000);
  });
  it("collected counts payments received in the period", () => {
    expect(collected(input, OCT)).toBe(500);
  });
  it("outstanding receivables are confirmed+ order totals minus payments up to the end of the period", () => {
    // 0001: 1000 - 400 = 600; 0002: 2000 - 500 = 1500 (the November payment does not count yet)
    expect(outstandingReceivables(input, OCT)).toBe(2_100);
  });
  it("ages receivables by days past due", () => {
    const ageing = receivablesAgeing(input, OCT);
    expect(ageing["0-30"]).toEqual({ amount: 1_500, count: 1 });
    expect(ageing["90+"]).toEqual({ amount: 600, count: 1 });
    expect(ageing["31-60"].count + ageing["61-90"].count).toBe(0);
  });
  it("counts orders by status", () => {
    expect(ordersByStatus(input, OCT)).toMatchObject({ confirmed: 1, cancelled: 1, draft: 1, delivered: 0 });
  });
  it("keeps the money metrics distinct", () => {
    const values = [wonDealValue(input, OCT), orderValue(input, OCT), collected(input, OCT), outstandingReceivables(input, OCT), openPipeline(input, OCT), weightedPipeline(input, OCT)];
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("task metrics", () => {
  it("counts tasks overdue at the end of the period, including ones completed later", () => {
    expect(overdueTasks(input, OCT, NOW)).toBe(2);
  });
  it("completion rate covers tasks due in the period, excluding cancelled", () => {
    expect(taskCompletionRate(input, OCT)).toEqual({ rate: 2 / 3, due: 3, done: 2 });
  });
});

describe("series", () => {
  it("buckets won value and collected payments", () => {
    const series = revenueSeries(input, OCT, "week");
    expect(series.reduce((s, r) => s + r.won, 0)).toBe(40_000);
    expect(series.reduce((s, r) => s + r.collected, 0)).toBe(500);
    expect(bucketKeys(OCT, "month")).toEqual(["2026-10"]);
  });
});
