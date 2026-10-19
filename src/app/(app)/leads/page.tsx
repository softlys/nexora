import { Target } from "lucide-react";
import { SectionPlaceholder } from "@/components/patterns/section-placeholder";
import { requirePermission } from "@/server/guards";
import { getRepositories } from "@/server/repositories";

export const metadata = { title: "Leads" };

export default async function LeadsPage() {
  const { ctx } = await requirePermission("view", "lead");
  const counts = await getRepositories().stats.counts(ctx);
  return (
    <SectionPlaceholder
      title="Leads"
      description="Inbound and outbound interest that is not a deal yet."
      icon={Target}
      emptyTitle="Leads will be listed here"
      emptyDescription="Qualify incoming interest and convert it into deals."
      planned={["List by source, status, qualification and owner", "One-step conversion into a company, contact and deal", "Protection against converting the same lead twice"]}
      dataNote={`${counts.leads} leads visible to your role are already in the dataset.`}
    />
  );
}
