"use server";

import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Role } from "@/domain/entities";
import { getDataMode } from "@/server/env";
import { recordSystemSecurity } from "@/server/security/record";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { createSupabaseServiceClient } from "@/server/supabase/service";

const loginInput = z
  .object({
    email: z.email().max(254),
    password: z.string().min(1).max(200),
  })
  .strict();

export type LoginState = { error: string | null };

/** Stable, non-reversible key for an attempted account, so attempts can be correlated without storing the email. */
function accountKey(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 24);
}

/** Supabase mode sign-in. Demo mode has no login and redirects home. */
export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  if (getDataMode() !== "supabase") redirect("/");
  const parsed = loginInput.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: "Enter a valid email and password." };

  const db = await createSupabaseServerClient();
  const { data, error } = await db.auth.signInWithPassword(parsed.data);

  // Security log: never the password, never the raw email; the account is identified by a hash.
  const service = createSupabaseServiceClient();
  const { data: profile } = await service.from("profiles").select("id, organization_id, role").eq("email", parsed.data.email).maybeSingle();
  const orgIds = profile ? [profile.organization_id as string] : ((await service.from("organizations").select("id")).data ?? []).map((o) => o.id as string);
  const account = accountKey(parsed.data.email);

  if (error) {
    await recordSystemSecurity(orgIds, "anonymous", {
      type: "auth.login_failed",
      payload: { target: { type: "account", id: profile ? (profile.id as string) : null }, account_key: account, known_account: Boolean(profile), reason: "invalid_credentials" },
    });
    // Same message for unknown email and wrong password, so accounts cannot be enumerated.
    return { error: "Email or password is incorrect." };
  }
  const userId = data.user?.id ?? (profile?.id as string | undefined) ?? null;
  await recordSystemSecurity(orgIds, profile && userId ? { user_id: userId, role: profile.role as Role } : "anonymous", {
    type: "auth.login_succeeded",
    payload: { target: { type: "account", id: data.user?.id ?? null }, account_key: account, user_id: data.user?.id ?? null },
  });
  redirect("/");
}
