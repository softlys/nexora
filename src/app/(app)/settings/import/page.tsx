import { PageHeader } from "@/components/patterns/page-header";
import { tr } from "@/lib/i18n";
import { requirePermission } from "@/server/guards";
import { ImportForm } from "./import-form";

export const metadata = { title: tr("Move from another CRM") };

/** Admins move pipelines, companies, contacts and deals from Bitrix24 or amoCRM. */
export default async function ImportPage() {
  await requirePermission("manage", "organization");
  return (
    <div className="space-y-6">
      <PageHeader title={tr("Move from another CRM")} description={tr("Pipelines with their stages, companies, contacts and deals from Bitrix24 or amoCRM. First check what will be moved, then move it; a repeated move only adds new records.")} />
      <ImportForm />
    </div>
  );
}
