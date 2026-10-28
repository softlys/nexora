import { PageHeader } from "@/components/patterns/page-header";
import { tr } from "@/lib/i18n";
import { requirePermission } from "@/server/guards";
import { loadPage } from "@/server/page-data";
import { getRequisites } from "@/server/services/requisites";
import { RequisitesForm } from "./requisites-form";

export const metadata = { title: tr("Requisites") };

/** Admins fill in the legal details, bank account, signature and stamp printed on invoices and quotes. */
export default async function RequisitesPage() {
  await requirePermission("manage", "organization");
  const requisites = await loadPage((ctx) => getRequisites(ctx));
  return (
    <div className="space-y-6">
      <PageHeader title={tr("Requisites")} description={tr("Legal details, bank account, signature and stamp for invoices and quotes.")} />
      <RequisitesForm initial={requisites} />
    </div>
  );
}
