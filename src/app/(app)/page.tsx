import { LayoutDashboard } from "lucide-react";
import { KpiCard } from "@/components/patterns/kpi-card";
import { SectionPlaceholder } from "@/components/patterns/section-placeholder";
import { formatNumber } from "@/lib/format";
import { requirePermission } from "@/server/guards";
import { getRepositories } from "@/server/repositories";

export const metadata = { title: "Overview" };

export default async function OverviewPage() {
  const { ctx } = await requirePermission("view", "analytics");
  const counts = await getRepositories().stats.counts(ctx);
  const tiles: Array<[string, number, string]> = [
    ["Companies", counts.companies, "/companies"],
    ["Contacts", counts.contacts, "/contacts"],
    ["Leads", counts.leads, "/leads"],
    ["Deals", counts.deals, "/deals"],
    ["Orders", counts.orders, "/orders"],
    ["Tasks", counts.tasks, "/tasks"],
  ];

  return (
    <SectionPlaceholder
      title="Overview"
      description="Sales, orders and work across your organization."
      icon={LayoutDashboard}
      emptyTitle="The performance dashboard will appear here"
      emptyDescription="KPIs and charts are computed from your data and respect your role's visibility."
      planned={[
        "Won deal value, open pipeline, active deals and conversion rate, compared with the previous period",
        "Outstanding receivables and overdue tasks",
        "Sales over time and deals by stage, with drill-down to the matching records",
      ]}
    >
      <section aria-labelledby="records-heading" className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 id="records-heading" className="text-sm font-medium text-foreground">
            Records you can access
          </h2>
          <span className="text-xs text-text-muted">Counted from the current dataset for your role</span>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {tiles.map(([label, value, href]) => (
            <KpiCard key={label} label={label} value={formatNumber(value)} href={href} />
          ))}
        </div>
      </section>
    </SectionPlaceholder>
  );
}
