import { requirePermission } from "@/server/guards";
import { getRepositories } from "@/server/repositories";
import { OrganizationForm } from "./organization-form";
import { tr } from "@/lib/i18n";

export const metadata = { title: tr("Organization") };

export default async function OrganizationSettingsPage() {
  const { ctx } = await requirePermission("update", "organization");
  const org = await getRepositories().organizations.current(ctx);
  return (
    <OrganizationForm
      defaults={{
        name: org.name,
        currency: org.currency,
        locale: org.locale as "en-US",
        order_conversion_mode: org.settings.order_conversion_mode,
      }}
    />
  );
}
