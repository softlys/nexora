import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { BrandMark } from "@/components/shell/brand";
import { tr } from "@/lib/i18n";
import { getSessionUser } from "@/server/auth";
import { mfaState } from "@/server/mfa";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { TwoFactorSetup } from "./two-factor-setup";

export const metadata = { title: tr("Two-factor sign-in") };

/**
 * Setting up two-factor sign-in. Outside the app layout on purpose: when the organization requires
 * two-factor, users without it are sent here and cannot open other pages until they finish.
 */
export default async function TwoFactorPage() {
  await connection();
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.mfa === "pending") redirect("/login/mfa");
  const demo = user.mode === "demo";
  let enabled = false;
  let required = false;
  if (!demo) {
    const db = await createSupabaseServerClient();
    enabled = (await mfaState(db.auth)).factors.length > 0;
    const { data: org } = await db.from("organizations").select("settings").eq("id", user.profile.organization_id).maybeSingle();
    required = Boolean((org?.settings as { require_mfa?: boolean } | null)?.require_mfa);
  }
  return (
    <div className="flex min-h-dvh items-start justify-center bg-surface-subtle px-4 py-16">
      <div className="w-full max-w-lg space-y-6 rounded-xl border border-border bg-surface p-6">
        <div className="flex items-center gap-3">
          <BrandMark className="size-8" />
          <h1 className="text-xl font-semibold tracking-tight">{tr("Two-factor sign-in")}</h1>
        </div>
        {user.mfa === "setup_required" && <p className="rounded-md border border-warning-border bg-warning-bg p-3 text-sm text-warning">{tr("Your organization requires two-factor sign-in. Set it up to continue.")}</p>}
        {demo ? (
          <p className="text-sm text-text-muted">{tr("The demo has no passwords, so there is no second factor here. With real accounts (Supabase mode), every user can turn on codes from an authenticator app, and an admin can require them for everyone.")}</p>
        ) : (
          <TwoFactorSetup enabled={enabled} required={required} isAdmin={user.profile.role === "admin"} />
        )}
        {user.mfa !== "setup_required" && (
          <Link href="/settings/profile" className="inline-block text-sm text-brand hover:underline">
            {tr("Back to settings")}
          </Link>
        )}
      </div>
    </div>
  );
}
