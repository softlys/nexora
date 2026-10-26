import { ROLE_LABELS } from "@/lib/format";
import { requirePermission } from "@/server/guards";
import { ProfileForm } from "./profile-form";
import { tr } from "@/lib/i18n";

export const metadata = { title: tr("Profile") };

export default async function ProfileSettingsPage() {
  const { user } = await requirePermission("update", "profile");
  return (
    <ProfileForm
      defaults={{ full_name: user.profile.full_name, title: user.profile.title, phone_extension: user.profile.phone_extension ?? "" }}
      email={user.profile.email}
      roleLabel={ROLE_LABELS[user.profile.role]!}
    />
  );
}
