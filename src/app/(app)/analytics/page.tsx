import { BarsChart, PairedBarsChart, RevenueChart } from "@/components/charts/charts";
import { RangeFilter } from "@/components/charts/range-filter";
import { Panel } from "@/components/crm/detail";
import { KpiCard } from "@/components/patterns/kpi-card";
import { PageHeader } from "@/components/patterns/page-header";
import { humanizeStatus } from "@/components/patterns/status-badge";
import { first } from "@/domain/list";
import { AGEING_BUCKETS } from "@/domain/metrics";
import { resolvePeriod } from "@/domain/metrics/period";
import { formatMoney, formatPercent } from "@/lib/format";
import { requirePermission } from "@/server/guards";
import { loadPage } from "@/server/page-data";
import { getAnalytics } from "@/server/services/analytics";
import { plural, tr } from "@/lib/i18n";

export const metadata = { title: tr("Analytics") };

export default async function AnalyticsPage({ searchParams }: PageProps<"/analytics">) {
  await requirePermission("view", "analytics");
  const params = await searchParams;
  const { preset, period } = resolvePeriod({ range: first(params.range), from: first(params.from), to: first(params.to) });
  const { a, currency } = await loadPage(async (ctx) => ({
    a: await getAnalytics(ctx, period),
    currency: (await ctx.db.read(ctx.actor.organization_id, (tx) => tx.get("organizations", ctx.actor.organization_id)))?.currency ?? "USD",
  }));
  const t = a.totals;
  const closed = `closed_from=${period.from}&closed_to=${period.to}`;
  const created = `created_from=${period.from}&created_to=${period.to}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={tr("Analytics")}
        description={tr("Revenue, conversion, pipeline, receivables and work, computed from your data. Definitions: docs/metrics.md.")}
        actions={<RangeFilter preset={preset} from={period.from} to={period.to} />}
      />

      <section aria-label={tr("Totals")} className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label={tr("Won deal value")} value={formatMoney(t.wonDealValue, currency)} href={`/deals?status=won&${closed}`} hint={tr("Deals closed won")} />
        <KpiCard label={tr("Order value")} value={formatMoney(t.orderValue, currency)} href="/orders" hint={tr("Non-cancelled orders")} />
        <KpiCard label={tr("Collected")} value={formatMoney(t.collected, currency)} href="/orders?payment=paid" hint={tr("Simulated payments")} />
        <KpiCard label={tr("Outstanding receivables")} value={formatMoney(t.outstanding, currency)} href="/orders?receivable=1" hint={tr("At period end")} />
        <KpiCard label={tr("Average deal size")} value={t.averageDealSize === null ? "—" : formatMoney(t.averageDealSize, currency)} href={`/deals?status=won&${closed}`} hint={tr("Won deals")} />
        <KpiCard label={tr("Sales cycle")} value={t.salesCycleDays === null ? "—" : plural(t.salesCycleDays, "day")} href={`/deals?status=won&${closed}`} hint={tr("Created to won")} />
        <KpiCard label={tr("Conversion rate")} value={t.conversionRate === null ? "—" : formatPercent(t.conversionRate)} href={`/deals?status=closed&${closed}`} hint={tr("Won ÷ (won + lost)")} />
        <KpiCard label={tr("Weighted pipeline")} value={formatMoney(t.weightedPipeline, currency)} href="/pipeline" hint={tr("Open {p0}", { p0: formatMoney(t.openPipeline, currency) })} />
      </section>

      <RevenueChart
        title={tr("Revenue over time")}
        description={tr("Won deal value and collected payments are different numbers: a won deal becomes cash only when its order is paid. Payments are simulated.")}
        data={a.revenue}
        bucket={a.bucket}
        currency={currency}
        period={period}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <BarsChart
          title={tr("Conversion funnel")}
          description={tr("Deals created in the period that reached each stage or later, and how many were won.")}
          data={a.funnel.map((s) => ({ label: tr(s.stage), value: s.count, href: `/deals?stage=${s.stage_id}&${created}` }))}
          format="count"
          valueLabel={tr("Deals")}
          layout="horizontal"
          emptyText={tr("No deals were created in this period.")}
        />
        <PairedBarsChart
          title={tr("Pipeline distribution")}
          description={tr("Open deals at the end of the period: amount and weighted amount per stage.")}
          data={a.distribution.map((s) => ({ label: tr(s.stage), a: s.amount, b: s.weighted, href: `/deals?stage=${s.stage_id}&status=open` }))}
          series={[tr("Amount"), tr("Weighted")]}
          currency={currency}
        />
        <BarsChart
          title={tr("Sales by owner")}
          description={tr("Won deal value per owner.")}
          data={a.byOwner.map((o) => ({ label: o.owner, value: o.won, href: `/deals?status=won&owner=${o.owner_id}&${closed}` }))}
          format="money"
          currency={currency}
          valueLabel={tr("Won value")}
          layout="horizontal"
          colorIndex={0}
          emptyText={tr("No deals were won in this period.")}
        />
        <BarsChart
          title={tr("Sales by source")}
          description={tr("Won deal value per lead source.")}
          data={a.bySource.map((s) => ({ label: humanizeStatus(s.source), value: s.won, href: `/deals?status=won&${closed}` }))}
          format="money"
          currency={currency}
          valueLabel={tr("Won value")}
          layout="horizontal"
          emptyText={tr("No deals were won in this period.")}
        />
        <BarsChart
          title={tr("Orders by status")}
          description={tr("Orders dated in the period.")}
          data={Object.entries(a.ordersByStatus).map(([status, count]) => ({ label: humanizeStatus(status), value: count, href: `/orders?status=${status}`, muted: status === "cancelled" }))}
          format="count"
          valueLabel={tr("Orders")}
          emptyText={tr("No orders in this period.")}
        />
        <BarsChart
          title={tr("Receivables ageing")}
          description={tr("Outstanding amounts at the end of the period by days past the payment due date.")}
          data={AGEING_BUCKETS.map((b) => ({ label: tr("{p0} days", { p0: b }), value: a.ageing[b].amount, href: b === "0-30" ? "/orders?receivable=1" : "/orders?payment=overdue" }))}
          format="money"
          currency={currency}
          valueLabel={tr("Outstanding")}
          emptyText={tr("Nothing is outstanding.")}
        />
      </div>

      <Panel title={tr("Task completion")} actions={<span className="text-xs text-text-muted">{tr("Tasks due in the period, excluding cancelled")}</span>}>
        {a.taskCompletion.due === 0 ? (
          <p className="text-sm text-text-muted">{tr("No tasks were due in this period.")}</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm">
              <span className="text-2xl font-semibold tabular-nums">{formatPercent(a.taskCompletion.rate ?? 0)}</span>
              <span className="ml-2 text-text-muted">
                {a.taskCompletion.done} {tr("of")} {a.taskCompletion.due} {tr("completed ·")} {t.overdueTasks} {tr("overdue now")}</span>
            </p>
            <table className="w-full text-sm">
              <caption className="sr-only">{tr("Task completion by assignee")}</caption>
              <thead className="text-xs text-text-muted">
                <tr className="border-b border-border">
                  <th scope="col" className="py-1.5 text-left font-medium">{tr("Assignee")}</th>
                  <th scope="col" className="py-1.5 text-right font-medium">{tr("Due")}</th>
                  <th scope="col" className="py-1.5 text-right font-medium">{tr("Done")}</th>
                  <th scope="col" className="py-1.5 text-right font-medium">{tr("Rate")}</th>
                </tr>
              </thead>
              <tbody>
                {a.taskCompletion.byAssignee.map((r) => (
                  <tr key={r.assignee} className="border-b border-border last:border-0">
                    <td className="py-1.5">{r.assignee}</td>
                    <td className="py-1.5 text-right tabular-nums">{r.due}</td>
                    <td className="py-1.5 text-right tabular-nums">{r.done}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatPercent(r.due ? r.done / r.due : 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
