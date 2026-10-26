import { can } from "@/domain/permissions";
import { requirePermission } from "@/server/guards";
import { getRepositories } from "@/server/repositories";
import { TeamTable } from "./team-table";
import { tr } from "@/lib/i18n";

export const metadata = { title: tr("Team") };

export default async function TeamSettingsPage() {
  const { user, ctx } = await requirePermission("view", "team");
  const profiles = await getRepositories().profiles.list(ctx);
  const names = new Map(profiles.map((p) => [p.id, p.full_name]));
  return (
    <TeamTable
      canManage={can(user.actor, "manage", "team")}
      currentUserId={user.profile.id}
      members={profiles.map((p) => ({
        id: p.id,
        full_name: p.full_name,
        email: p.email,
        title: p.title,
        role: p.role,
        is_active: p.is_active,
        manager: p.manager_id ? (names.get(p.manager_id) ?? null) : null,
      }))}
    />
  );
}
