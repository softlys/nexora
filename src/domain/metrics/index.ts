/**
 * NEXORA metrics. Pure functions over records the caller is allowed to see.
 * Every metric has a written definition in docs/metrics.md; keep them in sync.
 *
 * Money metrics are deliberately distinct and never interchangeable:
 *   won deal value      - what sales closed
 *   order value         - what customers ordered (non-cancelled orders)
 *   collected           - simulated payments received
 *   outstanding         - order value not yet collected on confirmed+ orders
 *   open pipeline       - amount of deals still open
 *   weighted pipeline   - open amount × probability
 */
import type { Deal, Order, Payment, PipelineStage, Task } from "../entities";

export type Period = { from: string; to: string }; // inclusive YYYY-MM-DD

export type MetricsInput = {
  deals: Deal[];
  stages: PipelineStage[];
  orders: Order[];
  payments: Payment[];
  tasks: Task[];
};

const DAY = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Start of the first day and end of the last day of a period, as ISO timestamps. */
export function periodBounds(p: Period): { start: string; end: string } {
  return { start: `${p.from}T00:00:00.000Z`, end: `${p.to}T23:59:59.999Z` };
}

export function inPeriod(iso: string | null | undefined, p: Period): boolean {
  if (!iso) return false;
  const { start, end } = periodBounds(p);
  const value = iso.length === 10 ? `${iso}T12:00:00.000Z` : iso;
  return value >= start && value <= end;
}

export function periodDays(p: Period): number {
  return Math.round((Date.parse(`${p.to}T00:00:00Z`) - Date.parse(`${p.from}T00:00:00Z`)) / DAY) + 1;
}

/** The period of the same length that ends the day before `p` starts. */
export function previousPeriod(p: Period): Period {
  const days = periodDays(p);
  const to = new Date(Date.parse(`${p.from}T00:00:00Z`) - DAY);
  const from = new Date(to.getTime() - (days - 1) * DAY);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

/** Relative change from previous to current; null when there is no meaningful base. */
export function change(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / Math.abs(previous);
}

function stageFlags(stages: PipelineStage[]) {
  const map = new Map(stages.map((s) => [s.id, s]));
  return {
    isWon: (d: Deal) => map.get(d.stage_id)?.is_won ?? false,
    isLost: (d: Deal) => map.get(d.stage_id)?.is_lost ?? false,
  };
}

const live = <T extends { archived_at: string | null }>(rows: T[]) => rows.filter((r) => !r.archived_at);

// ---------------------------------------------------------------------------
// Deals
// ---------------------------------------------------------------------------

/** Deals in a won stage whose close date falls in the period. */
export function wonDeals(input: MetricsInput, p: Period): Deal[] {
  const { isWon } = stageFlags(input.stages);
  return live(input.deals).filter((d) => isWon(d) && inPeriod(d.closed_at, p));
}

export function lostDeals(input: MetricsInput, p: Period): Deal[] {
  const { isLost } = stageFlags(input.stages);
  return live(input.deals).filter((d) => isLost(d) && inPeriod(d.closed_at, p));
}

/** Won deal value: sum of amounts of deals won in the period. */
export function wonDealValue(input: MetricsInput, p: Period): number {
  return round2(wonDeals(input, p).reduce((s, d) => s + d.amount, 0));
}

/** Deals that were open at instant `at`: created on or before it and not closed by then. */
export function openDealsAt(input: MetricsInput, at: string): Deal[] {
  return live(input.deals).filter((d) => d.created_at <= at && (d.closed_at === null || d.closed_at > at));
}

/** Open pipeline at the end of the period: amount of deals open at that moment. */
export function openPipeline(input: MetricsInput, p: Period): number {
  return round2(openDealsAt(input, periodBounds(p).end).reduce((s, d) => s + d.amount, 0));
}

/** Weighted pipeline at the end of the period: Σ amount × probability / 100 over open deals. */
export function weightedPipeline(input: MetricsInput, p: Period): number {
  return round2(openDealsAt(input, periodBounds(p).end).reduce((s, d) => s + (d.amount * d.probability) / 100, 0));
}

/** Active deals: number of deals open at the end of the period. */
export function activeDeals(input: MetricsInput, p: Period): number {
  return openDealsAt(input, periodBounds(p).end).length;
}

/** Conversion rate: won / (won + lost) for deals closed in the period. Null when none closed. */
export function conversionRate(input: MetricsInput, p: Period): number | null {
  const won = wonDeals(input, p).length;
  const lost = lostDeals(input, p).length;
  return won + lost === 0 ? null : won / (won + lost);
}

/** Average deal size: won deal value / number of won deals in the period. Null when none won. */
export function averageDealSize(input: MetricsInput, p: Period): number | null {
  const won = wonDeals(input, p);
  return won.length === 0 ? null : round2(won.reduce((s, d) => s + d.amount, 0) / won.length);
}

/** Sales cycle length: average days from creation to close for deals won in the period. */
export function salesCycleDays(input: MetricsInput, p: Period): number | null {
  const won = wonDeals(input, p);
  if (won.length === 0) return null;
  const days = won.map((d) => (Date.parse(d.closed_at!) - Date.parse(d.created_at)) / DAY);
  return Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10;
}

// ---------------------------------------------------------------------------
// Orders and payments
// ---------------------------------------------------------------------------

const RECEIVABLE_STATUSES = new Set<Order["status"]>(["confirmed", "processing", "shipped", "delivered"]);

/** Order value: sum of totals of non-cancelled orders dated in the period. */
export function orderValue(input: MetricsInput, p: Period): number {
  return round2(live(input.orders).filter((o) => o.status !== "cancelled" && inPeriod(o.order_date, p)).reduce((s, o) => s + o.total, 0));
}

/** Collected: sum of simulated payments received in the period. */
export function collected(input: MetricsInput, p: Period): number {
  return round2(input.payments.filter((pay) => inPeriod(pay.paid_at, p)).reduce((s, pay) => s + pay.amount, 0));
}

/** Per-order amount still owed at instant `at` for confirmed+ orders dated on or before it. */
export function receivablesAt(input: MetricsInput, at: string): Array<{ order: Order; outstanding: number }> {
  const paidByOrder = new Map<string, number>();
  for (const pay of input.payments) if (pay.paid_at <= at) paidByOrder.set(pay.order_id, (paidByOrder.get(pay.order_id) ?? 0) + pay.amount);
  return live(input.orders)
    .filter((o) => RECEIVABLE_STATUSES.has(o.status) && `${o.order_date}T00:00:00.000Z` <= at)
    .map((order) => ({ order, outstanding: round2(Math.max(0, order.total - (paidByOrder.get(order.id) ?? 0))) }))
    .filter((r) => r.outstanding > 0);
}

/** Outstanding receivables at the end of the period: order value minus collected on confirmed+ orders. */
export function outstandingReceivables(input: MetricsInput, p: Period): number {
  return round2(receivablesAt(input, periodBounds(p).end).reduce((s, r) => s + r.outstanding, 0));
}

export const AGEING_BUCKETS = ["0-30", "31-60", "61-90", "90+"] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];

/**
 * Receivables ageing at the end of the period, by days past the payment due date
 * (orders not yet due count as 0-30).
 */
export function receivablesAgeing(input: MetricsInput, p: Period): Record<AgeingBucket, { amount: number; count: number }> {
  const end = periodBounds(p).end;
  const out = Object.fromEntries(AGEING_BUCKETS.map((b) => [b, { amount: 0, count: 0 }])) as Record<AgeingBucket, { amount: number; count: number }>;
  for (const r of receivablesAt(input, end)) {
    const due = r.order.payment_due_date ?? r.order.order_date;
    const late = Math.max(0, Math.floor((Date.parse(end) - Date.parse(`${due}T00:00:00Z`)) / DAY));
    const bucket: AgeingBucket = late <= 30 ? "0-30" : late <= 60 ? "31-60" : late <= 90 ? "61-90" : "90+";
    out[bucket].amount = round2(out[bucket].amount + r.outstanding);
    out[bucket].count += 1;
  }
  return out;
}

/** Number of non-archived orders per status, dated in the period. */
export function ordersByStatus(input: MetricsInput, p: Period): Record<Order["status"], number> {
  const out = { draft: 0, confirmed: 0, processing: 0, shipped: 0, delivered: 0, cancelled: 0 } as Record<Order["status"], number>;
  for (const o of live(input.orders)) if (inPeriod(o.order_date, p)) out[o.status] += 1;
  return out;
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

/**
 * Overdue tasks at the end of the period: not cancelled, due before that moment and not
 * completed by then. For the current period this equals "open and past due".
 */
export function overdueTasks(input: MetricsInput, p: Period, now: Date = new Date()): number {
  const at = periodBounds(p).end < now.toISOString() ? periodBounds(p).end : now.toISOString();
  return live(input.tasks).filter(
    (t) => t.status !== "cancelled" && t.due_at !== null && t.due_at < at && t.created_at <= at && (t.completed_at === null || t.completed_at > at),
  ).length;
}

/** Task completion rate: of tasks due in the period (not cancelled), the share completed. */
export function taskCompletionRate(input: MetricsInput, p: Period): { rate: number | null; due: number; done: number } {
  const due = live(input.tasks).filter((t) => t.status !== "cancelled" && inPeriod(t.due_at, p));
  const done = due.filter((t) => t.status === "done").length;
  return { rate: due.length === 0 ? null : done / due.length, due: due.length, done };
}

// ---------------------------------------------------------------------------
// Series and breakdowns
// ---------------------------------------------------------------------------

export type Bucket = "day" | "week" | "month";

/** Picks a readable bucket size for a period. */
export function bucketFor(p: Period): Bucket {
  const days = periodDays(p);
  return days <= 31 ? "day" : days <= 120 ? "week" : "month";
}

export function bucketKey(iso: string, bucket: Bucket): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (bucket === "day") return d.toISOString().slice(0, 10);
  if (bucket === "month") return d.toISOString().slice(0, 7);
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)));
  return monday.toISOString().slice(0, 10);
}

export function bucketKeys(p: Period, bucket: Bucket): string[] {
  const keys: string[] = [];
  for (let t = Date.parse(`${p.from}T00:00:00Z`); t <= Date.parse(`${p.to}T00:00:00Z`); t += DAY) {
    const k = bucketKey(new Date(t).toISOString(), bucket);
    if (keys[keys.length - 1] !== k) keys.push(k);
  }
  return keys;
}

/** Won deal value and collected payments per bucket. */
export function revenueSeries(input: MetricsInput, p: Period, bucket: Bucket = bucketFor(p)) {
  const rows = new Map(bucketKeys(p, bucket).map((k) => [k, { bucket: k, won: 0, collected: 0 }]));
  for (const d of wonDeals(input, p)) {
    const r = rows.get(bucketKey(d.closed_at!, bucket));
    if (r) r.won = round2(r.won + d.amount);
  }
  for (const pay of input.payments) {
    if (!inPeriod(pay.paid_at, p)) continue;
    const r = rows.get(bucketKey(pay.paid_at, bucket));
    if (r) r.collected = round2(r.collected + pay.amount);
  }
  return [...rows.values()];
}

/** Deals created in the period, grouped by their current stage. */
export function dealsByStage(input: MetricsInput, p: Period) {
  const created = live(input.deals).filter((d) => inPeriod(d.created_at, p));
  return [...input.stages]
    .sort((a, b) => a.position - b.position)
    .map((s) => {
      const list = created.filter((d) => d.stage_id === s.id);
      return { stage_id: s.id, stage: s.name, is_won: s.is_won, is_lost: s.is_lost, count: list.length, amount: round2(list.reduce((sum, d) => sum + d.amount, 0)) };
    });
}

/**
 * Conversion funnel: of deals created in the period, how many reached each open stage
 * or beyond (based on stage history), and how many were won.
 */
export function conversionFunnel(input: MetricsInput, history: Array<{ deal_id: string; to_stage_id: string }>, p: Period) {
  const ordered = [...input.stages].sort((a, b) => a.position - b.position);
  const open = ordered.filter((s) => !s.is_won && !s.is_lost);
  const won = ordered.find((s) => s.is_won);
  const position = new Map(open.map((s, i) => [s.id, i]));
  const created = live(input.deals).filter((d) => inPeriod(d.created_at, p));
  const reachedIndex = new Map<string, number>();
  for (const d of created) reachedIndex.set(d.id, won && d.stage_id === won.id ? open.length : (position.get(d.stage_id) ?? -1));
  for (const h of history) {
    if (!reachedIndex.has(h.deal_id)) continue;
    const idx = won && h.to_stage_id === won.id ? open.length : (position.get(h.to_stage_id) ?? -1);
    if (idx > reachedIndex.get(h.deal_id)!) reachedIndex.set(h.deal_id, idx);
  }
  const stagesOut = open.map((s, i) => ({ stage_id: s.id, stage: s.name, count: [...reachedIndex.values()].filter((v) => v >= i).length }));
  if (won) stagesOut.push({ stage_id: won.id, stage: won.name, count: [...reachedIndex.values()].filter((v) => v >= open.length).length });
  return stagesOut;
}

/** Won value and count per owner for deals won in the period. */
export function salesByOwner(input: MetricsInput, p: Period) {
  const out = new Map<string, { owner_id: string; won: number; count: number }>();
  for (const d of wonDeals(input, p)) {
    const r = out.get(d.owner_id) ?? { owner_id: d.owner_id, won: 0, count: 0 };
    r.won = round2(r.won + d.amount);
    r.count += 1;
    out.set(d.owner_id, r);
  }
  return [...out.values()].sort((a, b) => b.won - a.won);
}

/** Won value and count per deal source for deals won in the period. */
export function salesBySource(input: MetricsInput, p: Period) {
  const out = new Map<string, { source: string; won: number; count: number }>();
  for (const d of wonDeals(input, p)) {
    const r = out.get(d.source) ?? { source: d.source, won: 0, count: 0 };
    r.won = round2(r.won + d.amount);
    r.count += 1;
    out.set(d.source, r);
  }
  return [...out.values()].sort((a, b) => b.won - a.won);
}

/** Open deals at the end of the period by current stage: count, amount and weighted amount. */
export function pipelineDistribution(input: MetricsInput, p: Period) {
  const open = openDealsAt(input, periodBounds(p).end);
  return [...input.stages]
    .filter((s) => !s.is_won && !s.is_lost)
    .sort((a, b) => a.position - b.position)
    .map((s) => {
      const list = open.filter((d) => d.stage_id === s.id);
      return {
        stage_id: s.id,
        stage: s.name,
        count: list.length,
        amount: round2(list.reduce((sum, d) => sum + d.amount, 0)),
        weighted: round2(list.reduce((sum, d) => sum + (d.amount * d.probability) / 100, 0)),
      };
    });
}
