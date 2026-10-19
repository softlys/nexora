import { Users } from "lucide-react";
import { SectionPlaceholder } from "@/components/patterns/section-placeholder";
import { requirePermission } from "@/server/guards";
import { getRepositories } from "@/server/repositories";

export const metadata = { title: "Contacts" };

export default async function ContactsPage() {
  const { ctx } = await requirePermission("view", "contact");
  const counts = await getRepositories().stats.counts(ctx);
  return (
    <SectionPlaceholder
      title="Contacts"
      description="People at your customer and prospect companies."
      icon={Users}
      emptyTitle="Contacts will be listed here"
      emptyDescription="Every person you work with, linked to their company and activity."
      planned={["List with search and owner filter", "Contact page with activity timeline and last interaction", "Create, edit and archive with validated email and phone"]}
      dataNote={`${counts.contacts} contacts visible to your role are already in the dataset.`}
    />
  );
}
