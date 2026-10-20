/**
 * Data for the Overview dashboard and the Analytics page. Every number comes from the
 * pure metric functions in src/domain/metrics over records the actor may see, so a sales
 * rep's dashboard contains only their own records and a manager's only their team's.
 */
import {
  activeDeals,
  averageDealSize,
  bucketFor,
  change,
  collected,
  conversionFunnel,
  conversionRate,
  dealsByStage,
  openDealsAt,
  openPipeline,
  orderValue,
  ordersByStatus,
  outstandingReceivables,
  overdueTasks,
  periodBounds,
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
import { findVisible, nowOf, requireCan, type ServiceContext } from "./context";
import { byId } from "./records";
import { recentActivities } from "./tasks";

async function metricsInput(ctx: ServiceContext) {
  return ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const [deals, orders, tasks, stages, allPayments, history, companies, profiles] = await Promise.all([
      findVisible(tx, ctx, "deals", "deal", (r) => r.owner_id),
      findVisible(tx, ctx, "orders", "order", (r) => r.owner_id),
      findVisible(tx, ctx, "tasks", "task", (r) => r.assignee_id),
      tx.find("pipeline_stages"),
      tx.find("payments"),
      tx.find("deal_stage_history"),
      tx.find("companies"),
      tx.find("profiles"),
    ]);
    const orderIds = new Set(orders.map((o) => o.id));
    const dealIds = new Set(deals.map((d) => d.id));
    const input: MetricsInput = { deals, orders, tasks, stages, payments: allPayments.filter((p) => orderIds.has(p.order_id)) };
    return { input, history: history.filter((h) => dealIds.has(h.deal_id)), companies: byId(companies), profiles: byId(profiles) };
  });
}

export type Kpi = { value: number | null; previous: number | null; change: number | null };
const kpi = (current: number | null, previous: number | null): Kpi => ({
  value: current,
  previous,
  change: current === null || previous === null ? null : change(current, previous),
});

export async function getDashboard(ctx: ServiceContext, period: Period) {
  requireCan(ctx, "view", "analytics");
  const { input, companies, profiles } = await metricsInput(ctx);
  const prev = previousPeriod(period);
  const now = nowOf(ctx);
  const nowIso = now.toISOString();

  const upcoming = input.tasks
    .filter((t) => !t.archived_at && (t.status === "todo" || t.status === "in_progress") && t.due_at)
    .sort((a, b) => a.due_at!.localeCompare(b.due_at!))
    .slice(0, 6)
    .map((t) => ({ id: t.id, title: t.title, due_at: t.due_at!, priority: t.priority, overdue: t.due_at! < nowIso }));
  const recentOrders = input.orders
    .filter((o) => !o.archived_at)
    .sort((a, b) => b.order_date.localeCompare(a.order_date) || b.created_at.localeCompare(a.created_at))
    .slice(0, 6)
    .map((o) => ({ id: o.id, order_number: o.order_number, company: companies.get(o.company_id)?.name ?? "Unknown", total: o.total, currency: o.currency, status: o.status }));
  const highPriority = openDealsAt(input, nowIso)
    .map((d) => ({ id: d.id, name: d.name, company: companies.get(d.company_id)?.name ?? "Unknown", amount: d.amount, currency: d.currency, weighted: (d.amount * d.probability) / 100, close: d.expected_close_date, owner: profiles.get(d.owner_id)?.full_name ?? "" }))
    .sort((a, b) => b.weighted - a.weighted)
    .slice(0, 6);

  return {
    period,
    previous: prev,
    kpis: {
      wonDealValue: kpi(wonDealValue(input, period), wonDealValue(input, prev)),
      openPipeline: kpi(openPipeline(input, period), openPipeline(input, prev)),
      activeDeals: kpi(activeDeals(input, period), activeDeals(input, prev)),
      conversionRate: kpi(conversionRate(input, period), conversionRate(input, prev)),
      outstandingReceivables: kpi(outstandingReceivables(input, period), outstandingReceivables(input, prev)),
      overdueTasks: kpi(overdueTasks(input, period, now), overdueTasks(input, prev, now)),
    },
    revenue: revenueSeries(input, period),
    bucket: bucketFor(period),
    byStage: dealsByStage(input, period),
    recentActivities: (await recentActivities(ctx, 6)).map((a) => ({ id: a.id, subject: a.subject, type: a.type, actor: a.actor_name, at: a.occurred_at, related: a.related })),
    upcomingTasks: upcoming,
    recentOrders,
    highPriorityDeals: highPriority,
  };
}

export async function getAnalytics(ctx: ServiceContext, period: Period) {
  requireCan(ctx, "view", "analytics");
  const { input, history, profiles } = await metricsInput(ctx);
  const now = nowOf(ctx);
  const completion = taskCompletionRate(input, period);
  const tasksDue = input.tasks.filter((t) => !t.archived_at && t.status !== "cancelled" && t.due_at && t.due_at >= periodBounds(period).start && t.due_at <= periodBounds(period).end);
  return {
    period,
    bucket: bucketFor(period),
    totals: {
      wonDealValue: wonDealValue(input, period),
      orderValue: orderValue(input, period),
      collected: collected(input, period),
      outstanding: outstandingReceivables(input, period),
      openPipeline: openPipeline(input, period),
      weightedPipeline: weightedPipeline(input, period),
      averageDealSize: averageDealSize(input, period),
      salesCycleDays: salesCycleDays(input, period),
      conversionRate: conversionRate(input, period),
      overdueTasks: overdueTasks(input, period, now),
    },
    revenue: revenueSeries(input, period),
    funnel: conversionFunnel(input, history, period),
    byOwner: salesByOwner(input, period).map((r) => ({ ...r, owner: profiles.get(r.owner_id)?.full_name ?? "Former member" })),
    bySource: salesBySource(input, period),
    distribution: pipelineDistribution(input, period),
    ordersByStatus: ordersByStatus(input, period),
    ageing: receivablesAgeing(input, period),
    taskCompletion: {
      ...completion,
      byAssignee: [...new Set(tasksDue.map((t) => t.assignee_id))].map((id) => {
        const mine = tasksDue.filter((t) => t.assignee_id === id);
        return { assignee: profiles.get(id)?.full_name ?? "Former member", due: mine.length, done: mine.filter((t) => t.status === "done").length };
      }),
    },
  };
}
