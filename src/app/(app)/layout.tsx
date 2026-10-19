import { cookies } from "next/headers";
import { AppShell, SIDEBAR_COOKIE } from "@/components/shell/app-shell";
import type { ShellData } from "@/components/shell/shell-context";
import { visibleNavGroups, visibleSettingsSections } from "@/domain/navigation";
import { can } from "@/domain/permissions";
import { getRepoContext } from "@/server/auth";
import { getRepositories } from "@/server/repositories";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { user, ctx } = await getRepoContext();
  const repos = getRepositories();
  const [organization, notifications, profiles, cookieStore] = await Promise.all([
    repos.organizations.current(ctx),
    repos.notifications.listMine(ctx, 20),
    user.mode === "demo" ? repos.profiles.list(ctx) : Promise.resolve([]),
    cookies(),
  ]);

  const quickCreate: ShellData["quickCreate"] = [];
  if (can(user.actor, "manage", "pipeline_stage")) quickCreate.push({ label: "Pipeline stage", href: "/settings/pipeline?new=1", icon: "stage" });

  const data: ShellData = {
    mode: user.mode,
    organization: { name: organization.name, currency: organization.currency, locale: organization.locale },
    user: {
      id: user.profile.id,
      full_name: user.profile.full_name,
      email: user.profile.email,
      role: user.profile.role,
      title: user.profile.title,
    },
    navGroups: visibleNavGroups(user.actor),
    settingsSections: visibleSettingsSections(user.actor),
    notifications,
    demoUsers: profiles.filter((p) => p.is_active).map((p) => ({ id: p.id, full_name: p.full_name, role: p.role, title: p.title })),
    quickCreate,
    sidebarCollapsed: cookieStore.get(SIDEBAR_COOKIE)?.value === "collapsed",
  };

  return <AppShell data={data}>{children}</AppShell>;
}
