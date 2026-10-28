import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/patterns/page-header";
import { Button } from "@/components/ui/button";
import { first } from "@/domain/list";
import { formatMoney, formatPercent } from "@/lib/format";
import { intlLocale, tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { requirePermission } from "@/server/guards";
import { loadPage } from "@/server/page-data";
import { CHANNEL_GROUPS, channelReport, NO_CHANNEL, type ChannelGroup, type ChannelRow } from "@/server/services/channels";
import { monthInput } from "@/server/services/sales-plan";
import { AddSpend, SpendInput } from "./spend-input";

export const metadata = { title: tr("End-to-end analytics") };

const GROUP_LABELS: Record<ChannelGroup, string> = { source: "Source (utm_source)", medium: "Medium (utm_medium)", campaign: "Campaign (utm_campaign)", lead_source: "Lead source" };
const shift = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
};

/** Leads by advertising channel, followed to won deals and revenue, with spend, cost per lead and ROI. */
export default async function ChannelsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("view", "analytics");
  const params = await searchParams;
  const month = monthInput.safeParse(first(params.month)).success ? first(params.month)! : new Date().toISOString().slice(0, 7);
  const group = (CHANNEL_GROUPS as readonly string[]).includes(first(params.group) ?? "") ? (first(params.group) as ChannelGroup) : "source";
  const [report, currency] = await loadPage(async (ctx) => [await channelReport(ctx, month, group), (await ctx.db.read(ctx.actor.organization_id, (tx) => tx.get("organizations", ctx.actor.organization_id)))?.currency ?? "USD"] as const);
  const money = (v: number | null) => (v === null ? "—" : formatMoney(v, currency));
  const pct = (v: number | null) => (v === null ? "—" : formatPercent(v));
  const monthName = new Date(`${month}-15T00:00:00Z`).toLocaleDateString(intlLocale(), { month: "long", year: "numeric", timeZone: "UTC" });
  const href = (patch: Record<string, string>) => `/analytics/channels?${new URLSearchParams({ month, group, ...patch })}`;
  const editSpend = group === "source" && report.canRecordSpend;
  const cells = (r: ChannelRow, total = false) => (
    <>
      <td className="px-3 py-2 text-right tabular-nums">{r.leads}</td>
      <td className="px-3 py-2 text-right tabular-nums">{r.converted}</td>
      <td className="px-3 py-2 text-right tabular-nums">{r.won_deals}</td>
      <td className="px-3 py-2 text-right font-medium tabular-nums">{money(r.revenue)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{pct(r.lead_to_won)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{money(r.average_deal)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{editSpend && !total && r.channel !== NO_CHANNEL ? <SpendInput period={month} channel={r.channel} value={r.spend} /> : money(r.spend)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{money(r.cost_per_lead)}</td>
      <td className={cn("px-3 py-2 text-right tabular-nums", r.roi !== null && (r.roi >= 0 ? "text-success" : "text-danger"))}>{pct(r.roi)}</td>
    </>
  );

  return (
    <div className="space-y-5">
      <Link href="/analytics" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        {tr("Analytics")}
      </Link>
      <PageHeader
        title={tr("End-to-end analytics")}
        description={tr("Leads of the month by advertising channel, followed to the deals they became and the money won. Enter what each channel cost to see the cost per lead and ROI.")}
        actions={
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" asChild>
              <Link href={href({ month: shift(month, -1) })} aria-label={tr("Previous month")}>
                <ChevronLeft aria-hidden />
              </Link>
            </Button>
            <span className="min-w-36 text-center text-sm font-medium capitalize">{monthName}</span>
            <Button variant="outline" size="icon" asChild>
              <Link href={href({ month: shift(month, 1) })} aria-label={tr("Next month")}>
                <ChevronRight aria-hidden />
              </Link>
            </Button>
          </div>
        }
      />
      <nav aria-label={tr("Group by")} className="flex flex-wrap gap-1">
        {CHANNEL_GROUPS.map((g) => (
          <Link key={g} href={href({ group: g })} aria-current={g === group ? "page" : undefined} className={cn("rounded-md px-3 py-1.5 text-sm text-text-subtle hover:bg-surface-muted", g === group && "bg-surface-muted font-medium text-foreground")}>
            {tr(GROUP_LABELS[g])}
          </Link>
        ))}
      </nav>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-sm" data-testid="channels-table">
          <thead className="border-b border-border text-xs text-text-muted">
            <tr>
              <th className="px-3 py-2 text-left font-normal">{tr("Channel")}</th>
              <th className="px-3 py-2 text-right font-normal">{tr("Leads")}</th>
              <th className="px-3 py-2 text-right font-normal">{tr("To deals")}</th>
              <th className="px-3 py-2 text-right font-normal">{tr("Won")}</th>
              <th className="px-3 py-2 text-right font-normal">{tr("Revenue")}</th>
              <th className="px-3 py-2 text-right font-normal">{tr("Lead → won")}</th>
              <th className="px-3 py-2 text-right font-normal">{tr("Average deal")}</th>
              <th className="px-3 py-2 text-right font-normal">{tr("Spend")}</th>
              <th className="px-3 py-2 text-right font-normal">{tr("Cost per lead")}</th>
              <th className="px-3 py-2 text-right font-normal">ROI</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-text-muted">
                  {tr("No leads this month.")}
                </td>
              </tr>
            )}
            {report.rows.map((r) => (
              <tr key={r.channel} className="border-b border-border">
                <td className="px-3 py-2 font-medium">{r.channel === NO_CHANNEL ? <span className="text-text-muted">{tr("No tags")}</span> : group === "lead_source" ? tr(r.channel.replace(/_/g, " ")) : r.channel}</td>
                {cells(r)}
              </tr>
            ))}
          </tbody>
          <tfoot className="font-semibold">
            <tr>
              <td className="px-3 py-2">{tr("Total")}</td>
              {cells(report.total, true)}
            </tr>
          </tfoot>
        </table>
      </div>
      {editSpend && <AddSpend period={month} />}
      <p className="text-xs text-text-muted">{tr("UTM tags come from website forms (Tilda, Yandex Forms), the website chat and the API (field utm). A lead counts in the month it arrived; its deal counts as won whenever it is won.")}</p>
    </div>
  );
}
