import { ChartColumn } from "lucide-react";
import { SectionPlaceholder } from "@/components/patterns/section-placeholder";
import { requirePermission } from "@/server/guards";

export const metadata = { title: "Analytics" };

export default async function AnalyticsPage() {
  await requirePermission("view", "analytics");
  return (
    <SectionPlaceholder
      title="Analytics"
      description="Revenue, conversion, pipeline and receivables over time."
      icon={ChartColumn}
      emptyTitle="Reports will appear here"
      emptyDescription="Charts computed from your data, each with a written metric definition."
      planned={["Won value versus collected payments over time", "Conversion funnel, sales by owner and source", "Receivables ageing and task completion"]}
    />
  );
}
