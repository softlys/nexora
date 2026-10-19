import { Workflow } from "lucide-react";
import { SectionPlaceholder } from "@/components/patterns/section-placeholder";
import { requirePermission } from "@/server/guards";

export const metadata = { title: "Automation Studio" };

export default async function AutomationPage() {
  await requirePermission("view", "automation");
  return (
    <SectionPlaceholder
      title="Automation Studio"
      description="Workflows that react to CRM events."
      icon={Workflow}
      emptyTitle="Automations will be listed here"
      emptyDescription="Internal workflows triggered by record changes, stage moves and dates."
      planned={["Workflow list with run counts, success rate and errors", "Step-by-step flow view with a configuration panel", "Test runs, execution history and retries"]}
    />
  );
}
