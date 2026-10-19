import { SquareKanban } from "lucide-react";
import { SectionPlaceholder } from "@/components/patterns/section-placeholder";
import { requirePermission } from "@/server/guards";
import { getRepositories } from "@/server/repositories";

export const metadata = { title: "Sales Pipeline" };

export default async function PipelinePage() {
  const { ctx } = await requirePermission("view", "deal");
  const counts = await getRepositories().stats.counts(ctx);
  return (
    <SectionPlaceholder
      title="Sales Pipeline"
      description="Deals by stage, with weighted forecast."
      icon={SquareKanban}
      emptyTitle="The pipeline board will appear here"
      emptyDescription="A kanban board of open deals using the stages configured in Settings."
      planned={["Drag and drop between stages, keyboard accessible", "Per-stage count, total and weighted forecast", "Table view with the same filters"]}
      dataNote={`${counts.deals} deals visible to your role are already in the dataset.`}
    />
  );
}
