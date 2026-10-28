import { ChevronLeft, ChevronRight, Trophy } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/patterns/page-header";
import { Button } from "@/components/ui/button";
import { first } from "@/domain/list";
import { formatMoney, formatPercent } from "@/lib/format";
import { intlLocale, tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { requirePermission } from "@/server/guards";
import { loadPage } from "@/server/page-data";
import { monthInput, salesPlan } from "@/server/services/sales-plan";
import { TargetInput } from "./target-input";

export const metadata = { title: tr("Sales plan") };

const shift = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
};

/** Monthly targets, completion and activity KPIs per person, ranked. */
export default async function SalesPlanPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("view", "analytics");
  const params = await searchParams;
  const month = monthInput.safeParse(first(params.month)).success ? first(params.month)! : new Date().toISOString().slice(0, 7);
  const [plan, currency] = await loadPage(async (ctx) => [await salesPlan(ctx, month), (await ctx.db.read(ctx.actor.organization_id, (tx) => tx.get("organizations", ctx.actor.organization_id)))?.currency ?? "USD"] as const);
  const monthName = new Date(`${month}-15T00:00:00Z`).toLocaleDateString(intlLocale(), { month: "long", year: "numeric", timeZone: "UTC" });
  const bar = (completion: number | null) => Math.min(100, Math.round((completion ?? 0) * 100));

  return (
    <div className="space-y-5">
      <PageHeader
        title={tr("Sales plan")}
        description={tr("Monthly targets and what each person closed, with calls, meetings, win rate and forecast. Won deals count in the month they were closed.")}
        actions={
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" asChild>
              <Link href={`/plan?month=${shift(month, -1)}`} aria-label={tr("Previous month")}>
                <ChevronLeft aria-hidden />
              </Link>
            </Button>
            <span className="min-w-36 text-center text-sm font-medium capitalize">{monthName}</span>
            <Button variant="outline" size="icon" asChild>
              <Link href={`/plan?month=${shift(month, 1)}`} aria-label={tr("Next month")}>
                <ChevronRight aria-hidden />
              </Link>
            </Button>
          </div>
        }
      />
      <dl className="grid gap-3 sm:grid-cols-4" data-testid="plan-total">
        {[
          [tr("Plan"), formatMoney(plan.total.target, currency)],
          [tr("Won"), formatMoney(plan.total.won_amount, currency)],
          [tr("Completion"), plan.total.completion === null ? "—" : formatPercent(plan.total.completion)],
          [tr("Forecast"), formatMoney(plan.total.forecast, currency)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-border bg-surface p-3">
            <dt className="text-xs text-text-muted">{label}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-sm" data-testid="plan-table">
          <thead className="border-b border-border text-xs text-text-muted">
            <tr>
              <th className="px-3 py-2 text-left font-normal">#</th>
              <th className="px-3 py-2 text-left font-normal">{tr("Person")}</th>
              <th className="px-3 py-2 text-right font-normal">{tr("Plan")}</th>
              <th className="px-3 py-2 text-right font-normal">{tr("Won")}</th>
              <th className="px-3 py-2 text-left font-normal">{tr("Completion")}</th>
              <th className="px-3 py-2 text-right font-normal">{tr("Deals won")}</th>
              <th className="px-3 py-2 text-right font-normal">{tr("Win rate")}</th>
              <th className="px-3 py-2 text-right font-normal">{tr("Calls")}</th>
              <th className="px-3 py-2 text-right font-normal">{tr("Meetings")}</th>
              <th className="px-3 py-2 text-right font-normal">{tr("Forecast")}</th>
            </tr>
          </thead>
          <tbody>
            {plan.rows.map((r, i) => (
              <tr key={r.profile_id} className="border-b border-border last:border-0">
                <td className="px-3 py-2 tabular-nums">{i === 0 && (r.completion ?? 0) > 0 ? <Trophy className="size-4 text-warning" aria-label={tr("Leader")} /> : i + 1}</td>
                <td className="px-3 py-2 font-medium whitespace-nowrap">{r.name}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.can_edit ? <TargetInput profileId={r.profile_id} period={month} value={r.target} name={r.name} /> : r.target === null ? "—" : formatMoney(r.target, currency)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(r.won_amount, currency)}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-24 overflow-hidden rounded-full bg-surface-muted" aria-hidden>
                      <div className={cn("h-full rounded-full", (r.completion ?? 0) >= 1 ? "bg-success" : "bg-brand")} style={{ width: `${bar(r.completion)}%` }} />
                    </div>
                    <span className="tabular-nums">{r.completion === null ? "—" : formatPercent(r.completion)}</span>
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{r.won_count}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.win_rate === null ? "—" : formatPercent(r.win_rate)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.calls}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.meetings}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(r.forecast, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {plan.canSetTargets && <p className="text-xs text-text-muted">{tr("Type a plan in the Plan column and press Enter. Managers set plans for their team, admins for everyone.")}</p>}
    </div>
  );
}
