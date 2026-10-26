import { AlertTriangle, BadgeDollarSign, Briefcase, CalendarClock, Percent, Wallet } from "lucide-react";
import Link from "next/link";
import { BarsChart, RevenueChart } from "@/components/charts/charts";
import { RangeFilter } from "@/components/charts/range-filter";
import { Panel } from "@/components/crm/detail";
import { InitialsAvatar } from "@/components/patterns/initials-avatar";
import { KpiCard } from "@/components/patterns/kpi-card";
import { PageHeader } from "@/components/patterns/page-header";
import { humanizeStatus, StatusBadge } from "@/components/patterns/status-badge";
import { first } from "@/domain/list";
import { periodQuery, RANGE_LABELS, resolvePeriod } from "@/domain/metrics/period";
import { formatAmount, formatDate, formatMoney, formatNumber, formatPercent, formatRelative } from "@/lib/format";
import { requirePermission } from "@/server/guards";
import { loadPage } from "@/server/page-data";
import { getDashboard } from "@/server/services/analytics";
import { tr, trNode } from "@/lib/i18n";

export const metadata = { title: tr("Overview") };

export default async function OverviewPage({ searchParams }: PageProps<"/">) {
  const { user } = await requirePermission("view", "analytics");
  const params = await searchParams;
  const { preset, period } = resolvePeriod({ range: first(params.range), from: first(params.from), to: first(params.to) });
  const { dash, currency } = await loadPage(async (ctx) => ({
    dash: await getDashboard(ctx, period, first(params.pipeline)),
    currency: (await ctx.db.read(ctx.actor.organization_id, (tx) => tx.get("organizations", ctx.actor.organization_id)))?.currency ?? "USD",
  }));
  const k = dash.kpis;
  const vs = "vs previous period";
  const range = `closed_from=${period.from}&closed_to=${period.to}`;
  const scope = tr(user.actor.role === "admin" ? "the whole organization" : user.actor.role === "manager" ? "you and your team" : "your records");

  return (
    <div className="space-y-6">
      <PageHeader
        title={tr("Overview")}
        description={tr("Sales, orders and work for {p0}. Every number links to the records behind it; definitions are in docs/metrics.md.", { p0: scope })}
        actions={<RangeFilter preset={preset} from={period.from} to={period.to} />}
      />

      <section aria-label={tr("Key metrics")} className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          label={tr("Won deal value")}
          icon={BadgeDollarSign}
          tone="brand"
          spark={dash.revenue.map((r) => r.won)}
          value={formatMoney(k.wonDealValue.value ?? 0, currency)}
          delta={{ value: k.wonDealValue.change, label: vs }}
          href={`/deals?status=won&${range}`}
        />
        <KpiCard label={tr("Open pipeline")} icon={Briefcase} tone="info" value={formatMoney(k.openPipeline.value ?? 0, currency)} delta={{ value: k.openPipeline.change, label: vs }} href="/pipeline" hint={tr("At period end")} />
        <KpiCard label={tr("Active deals")} icon={CalendarClock} tone="brand" value={formatNumber(k.activeDeals.value ?? 0)} delta={{ value: k.activeDeals.change, label: vs }} href="/deals?status=open" />
        <KpiCard
          label={tr("Conversion rate")}
          icon={Percent}
          tone="success"
          value={k.conversionRate.value === null ? "—" : formatPercent(k.conversionRate.value)}
          delta={k.conversionRate.value === null ? { value: null, emptyLabel: tr("No deals closed") } : { value: k.conversionRate.change, label: vs }}
          href={`/deals?status=closed&${range}`}
        />
        <KpiCard
          label={tr("Outstanding receivables")}
          icon={Wallet}
          tone="warning"
          spark={dash.revenue.map((r) => r.collected)}
          value={formatMoney(k.outstandingReceivables.value ?? 0, currency)}
          delta={{ value: k.outstandingReceivables.change, positiveIsGood: false, label: vs }}
          href="/orders?receivable=1"
          hint={tr("At period end")}
        />
        <KpiCard label={tr("Overdue tasks")} icon={AlertTriangle} tone="danger" value={formatNumber(k.overdueTasks.value ?? 0)} delta={{ value: k.overdueTasks.change, positiveIsGood: false, label: vs }} href="/tasks?status=overdue" />
      </section>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <RevenueChart data={dash.revenue} bucket={dash.bucket} currency={currency} period={period} />
        </div>
        <div className="lg:col-span-2">
          <BarsChart
            title={dash.pipelines.length > 1 && dash.pipeline ? `${tr("Deals by stage")} · ${tr(dash.pipeline.name)}` : tr("Deals by stage")}
            description={tr("Deals created in {p0}, by current stage. Click a bar to see them.", { p0: tr(RANGE_LABELS[preset]).toLowerCase() })}
            data={dash.byStage.map((s) => ({ label: tr(s.stage), value: s.count, href: `/deals?stage=${s.stage_id}&created_from=${period.from}&created_to=${period.to}`, muted: s.is_lost }))}
            format="count"
            layout="horizontal"
            height={300}
            valueLabel={tr("Deals")}
            emptyText={tr("No deals were created in this period.")}
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={tr("Recent activities")} actions={<Link href="/tasks?view=activity" className="text-xs text-brand hover:underline">{tr("All activity")}</Link>}>
          {dash.recentActivities.length === 0 ? (
            <p className="text-sm text-text-muted">{tr("No activities yet.")}</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {dash.recentActivities.map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-2.5">
                  <InitialsAvatar name={a.actor} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{a.subject}</span>
                    {a.related ? (
                      <Link href={a.related.href} className="block truncate text-xs text-brand hover:underline">
                        {trNode(a.related.label)}
                      </Link>
                    ) : (
                      <span className="text-xs text-text-muted">{humanizeStatus(a.type)}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-right text-xs text-text-muted">
                    <span className="block text-text-subtle">{a.actor}</span>
                    {formatRelative(a.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title={tr("Upcoming tasks")} actions={<Link href="/tasks" className="text-xs text-brand hover:underline">{tr("All tasks")}</Link>}>
          {dash.upcomingTasks.length === 0 ? (
            <p className="text-sm text-text-muted">{tr("No open tasks with a due date.")}</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {dash.upcomingTasks.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                  <Link href={`/tasks/${t.id}`} className="min-w-0 truncate hover:underline">
                    {t.title}
                  </Link>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className={t.overdue ? "text-xs font-medium text-danger" : "text-xs text-text-muted"}>{t.overdue ? tr("Overdue · {p0}", { p0: formatDate(t.due_at) }) : formatDate(t.due_at)}</span>
                    <StatusBadge status={t.priority} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title={tr("Recent orders")} actions={<Link href="/orders" className="text-xs text-brand hover:underline">{tr("All orders")}</Link>}>
          {dash.recentOrders.length === 0 ? (
            <p className="text-sm text-text-muted">{tr("No orders yet.")}</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {dash.recentOrders.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <Link href={`/orders/${o.id}`} className="font-medium tabular-nums hover:underline">
                      {o.order_number}
                    </Link>
                    <span className="block truncate text-xs text-text-muted">{o.company}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <StatusBadge status={o.status} />
                    <span className="tabular-nums">{formatAmount(o.total, o.currency)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title={tr("High-priority open deals")} actions={<span className="text-xs text-text-muted">{tr("Largest weighted value")}</span>}>
          {dash.highPriorityDeals.length === 0 ? (
            <p className="text-sm text-text-muted">{tr("No open deals.")}</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {dash.highPriorityDeals.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <Link href={`/deals/${d.id}`} className="block truncate font-medium hover:underline">
                      {d.name}
                    </Link>
                    <span className="block truncate text-xs text-text-muted">
                      {d.company} {tr("· close")} {formatDate(d.close)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block tabular-nums">{formatMoney(d.amount, d.currency)}</span>
                    <span className="block text-xs text-text-muted tabular-nums">{tr("wtd")} {formatMoney(d.weighted, d.currency)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <p className="text-xs text-text-muted">{tr("Showing")} {tr(RANGE_LABELS[preset]).toLowerCase()} ({period.from} – {period.to}{tr("). Payments are simulated.")} <Link href={`/analytics?${periodQuery(preset, period)}`} className="text-brand hover:underline">{tr("Open analytics for this range")}</Link>
      </p>
    </div>
  );
}
