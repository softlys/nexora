import { PageHeader } from "@/components/patterns/page-header";
import { tr } from "@/lib/i18n";
import { requirePermission } from "@/server/guards";
import { loadPage } from "@/server/page-data";
import { roleMatrix } from "@/server/services/roles";
import { RoleEditor } from "./role-editor";

export const metadata = { title: tr("Roles") };

/** Admins narrow what managers and sales reps may see and do. */
export default async function RolesPage() {
  await requirePermission("manage", "organization");
  const matrix = await loadPage((ctx) => roleMatrix(ctx));
  return (
    <div className="space-y-6">
      <PageHeader
        title={tr("Roles")}
        description={tr("Who sees and changes what. “Team” means the user's own records and those of the people who report to them. Admins always have full access.")}
      />
      <RoleEditor role="manager" title={tr("Manager")} matrix={matrix.manager} />
      <RoleEditor role="sales_rep" title={tr("Sales rep")} matrix={matrix.sales_rep} />
    </div>
  );
}
