import { ROLE_LABELS } from "@/lib/format";
import { requirePermission } from "@/server/guards";
import Link from "next/link";
import { SettingsCard } from "@/components/patterns/form-field";
import { ProfileForm } from "./profile-form";
import { tr } from "@/lib/i18n";

export const metadata = { title: tr("Profile") };

export default async function ProfileSettingsPage() {
  const { user } = await requirePermission("update", "profile");
  return (
    <div className="space-y-6">
    <ProfileForm
      defaults={{ full_name: user.profile.full_name, title: user.profile.title, phone_extension: user.profile.phone_extension ?? "" }}
      email={user.profile.email}
      roleLabel={ROLE_LABELS[user.profile.role]!}
    />
      <SettingsCard title={tr("Two-factor sign-in")} description={tr("A code from an authenticator app after the password.")}>
        <Link href="/two-factor" className="text-sm text-brand hover:underline" data-testid="two-factor-link">
          {tr("Set up or change two-factor sign-in")}
        </Link>
      </SettingsCard>
    </div>
  );
}
