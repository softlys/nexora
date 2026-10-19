import { Handshake } from "lucide-react";
import { SectionPlaceholder } from "@/components/patterns/section-placeholder";
import { requirePermission } from "@/server/guards";
import { getRepositories } from "@/server/repositories";

export const metadata = { title: "Deals" };

export default async function DealsPage() {
  const { ctx } = await requirePermission("view", "deal");
  const counts = await getRepositories().stats.counts(ctx);
  return (
    <SectionPlaceholder
      title="Deals"
      description="Opportunities with amount, stage, probability and close date."
      icon={Handshake}
      emptyTitle="Deals will be listed here"
      emptyDescription="Track every opportunity from qualification to won or lost."
      planned={["List and detail drawer with full change history", "Probability defaulting from the stage, overridable per deal", "Create order from a won deal"]}
      dataNote={`${counts.deals} deals visible to your role are already in the dataset.`}
    />
  );
}
