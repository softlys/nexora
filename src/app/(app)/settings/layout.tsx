import { PageHeader } from "@/components/patterns/page-header";
import { visibleSettingsSections } from "@/domain/navigation";
import { requirePermission } from "@/server/guards";
import { SettingsNav } from "./settings-nav";

export default async function SettingsLayout({ children }: LayoutProps<"/settings">) {
  const { user } = await requirePermission("view", "profile");
  const sections = visibleSettingsSections(user.actor).map(({ href, label }) => ({ href, label }));
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Your profile, organization, team and pipeline." />
      <div className="flex flex-col gap-6 md:flex-row">
        <SettingsNav sections={sections} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
