import { redirect } from "next/navigation";
import { connection } from "next/server";
import { BrandMark } from "@/components/shell/brand";
import { tr } from "@/lib/i18n";
import { getSessionUser } from "@/server/auth";
import { MfaLoginForm } from "./mfa-form";

export const metadata = { title: tr("Two-factor sign-in") };

/** The second step of sign-in for users with an authenticator app. */
export default async function MfaLoginPage() {
  await connection();
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.mfa !== "pending") redirect("/");
  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-subtle px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <BrandMark className="size-9" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{tr("Two-factor sign-in")}</h1>
            <p className="mt-1 text-sm text-text-muted">{tr("Open your authenticator app and enter the 6-digit code for NEXORA.")}</p>
          </div>
        </div>
        <MfaLoginForm />
      </div>
    </div>
  );
}
