import { Building2 } from "lucide-react";
import { SectionPlaceholder } from "@/components/patterns/section-placeholder";
import { requirePermission } from "@/server/guards";
import { getRepositories } from "@/server/repositories";

export const metadata = { title: "Companies" };

export default async function CompaniesPage() {
  const { ctx } = await requirePermission("view", "company");
  const counts = await getRepositories().stats.counts(ctx);
  return (
    <SectionPlaceholder
      title="Companies"
      description="Accounts you sell to, with their contacts, deals, orders and history."
      icon={Building2}
      emptyTitle="Company records will be listed here"
      emptyDescription="Search, filter and open every account your role can see."
      planned={["List with search and filters by industry, size, country, owner and lifecycle stage", "Company page with contacts, deals, orders, tasks, notes and activity timeline", "Create, edit, archive and restore"]}
      dataNote={`${counts.companies} companies visible to your role are already in the dataset.`}
    />
  );
}
