import { redirect } from "next/navigation";
import { connection } from "next/server";
import { BrandMark } from "@/components/shell/brand";
import { demoAccessCode, getDataMode } from "@/server/env";
import { DemoAccessForm, LoginForm } from "./login-form";
import { tr } from "@/lib/i18n";

export const metadata = { title: tr("Sign in") };

/** Supabase mode sign-in. Demo mode has no sign-in: it asks for the access code when one is set, otherwise it goes straight to the app. */
export default async function LoginPage() {
  // The data mode is a runtime setting, so this page must not be prerendered at build time.
  await connection();
  const demo = getDataMode() !== "supabase";
  if (demo && !demoAccessCode()) redirect("/");
  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-subtle px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <BrandMark className="size-9" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{demo ? tr("NEXORA demo") : tr("Sign in to NEXORA")}</h1>
            <p className="mt-1 text-sm text-text-muted">{demo ? tr("Enter the access code you were given.") : tr("Use the account your admin created for you.")}</p>
          </div>
        </div>
        {demo ? <DemoAccessForm /> : <LoginForm />}
      </div>
    </div>
  );
}
