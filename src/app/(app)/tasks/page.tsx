import { ListChecks } from "lucide-react";
import { SectionPlaceholder } from "@/components/patterns/section-placeholder";
import { requirePermission } from "@/server/guards";
import { getRepositories } from "@/server/repositories";

export const metadata = { title: "Tasks & Activities" };

export default async function TasksPage() {
  const { ctx } = await requirePermission("view", "task");
  const counts = await getRepositories().stats.counts(ctx);
  return (
    <SectionPlaceholder
      title="Tasks & Activities"
      description="Follow-ups, calls, meetings and notes across all records."
      icon={ListChecks}
      emptyTitle="Tasks and activities will be listed here"
      emptyDescription="Your to-dos and the history of customer interactions."
      planned={["List and month/week calendar with overdue indicators", "One-click complete", "Activity logging from any record page"]}
      dataNote={`${counts.tasks} tasks visible to your role are already in the dataset.`}
    />
  );
}
