import { redirect } from "next/navigation";
import { connection } from "next/server";
import { BrandMark } from "@/components/shell/brand";
import { getDataMode } from "@/server/env";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

/** Supabase mode sign-in. Demo mode has no login, so it goes straight to the app. */
export default async function LoginPage() {
  // The data mode is a runtime setting, so this page must not be prerendered at build time.
  await connection();
  if (getDataMode() !== "supabase") redirect("/");
  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-subtle px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <BrandMark className="size-9" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Sign in to NEXORA</h1>
            <p className="mt-1 text-sm text-text-muted">Use the account your admin created for you.</p>
          </div>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
