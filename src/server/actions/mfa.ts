"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getSessionUser } from "@/server/auth";
import { getDataMode } from "@/server/env";
import { enrollTotp, mfaState, removeFactor, verifyCode } from "@/server/mfa";
import { recordSystemSecurity } from "@/server/security/record";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { tr } from "@/lib/i18n";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
const codeInput = z.object({ code: z.string().trim().regex(/^\d{6}$/) }).strict();

async function auth() {
  if (getDataMode() !== "supabase") throw new Error(tr("Two-factor sign-in works with real accounts (Supabase mode), not in the demo."));
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return { user, auth: (await createSupabaseServerClient()).auth };
}

/** Starts adding an authenticator app: returns the QR code and the secret. */
export async function startMfaSetupAction(): Promise<Result<{ factorId: string; qr: string; secret: string }>> {
  try {
    const { auth: a } = await auth();
    return { ok: true, data: await enrollTotp(a) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function confirmMfaSetupAction(input: unknown): Promise<Result<null>> {
  const parsed = z.object({ factorId: z.string().min(1).max(100), code: z.string().trim() }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: tr("Enter the 6-digit code from the app.") };
  const { user, auth: a } = await auth();
  if (!(await verifyCode(a, parsed.data.factorId, parsed.data.code))) return { ok: false, error: tr("The code is not correct. Check the time on your phone and try again.") };
  await recordSystemSecurity([user.profile.organization_id], { user_id: user.profile.id, role: user.profile.role }, { type: "settings.changed", payload: { target: { type: "account", id: user.profile.id }, fields: ["two_factor_enabled"] } });
  return { ok: true, data: null };
}

export async function removeMfaAction(input: unknown): Promise<Result<null>> {
  const parsed = codeInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: tr("Enter the 6-digit code from the app.") };
  const { user, auth: a } = await auth();
  const { createSupabaseServiceClient } = await import("@/server/supabase/service");
  const { data: org } = await createSupabaseServiceClient().from("organizations").select("settings").eq("id", user.profile.organization_id).maybeSingle();
  if ((org?.settings as { require_mfa?: boolean } | null)?.require_mfa) return { ok: false, error: tr("Your organization requires two-factor sign-in.") };
  const state = await mfaState(a);
  const factor = state.factors[0];
  if (!factor || !(await removeFactor(a, factor.id, parsed.data.code))) return { ok: false, error: tr("The code is not correct. Check the time on your phone and try again.") };
  await recordSystemSecurity([user.profile.organization_id], { user_id: user.profile.id, role: user.profile.role }, { type: "settings.changed", payload: { target: { type: "account", id: user.profile.id }, fields: ["two_factor_disabled"] } });
  return { ok: true, data: null };
}

/** The second step of sign-in. */
export async function verifyMfaLoginAction(input: unknown): Promise<Result<null>> {
  const parsed = codeInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: tr("Enter the 6-digit code from the app.") };
  const { auth: a } = await auth();
  const state = await mfaState(a);
  const ok = await Promise.all(state.factors.map((f) => verifyCode(a, f.id, parsed.data.code))).then((r) => r.some(Boolean));
  if (!ok) return { ok: false, error: tr("The code is not correct. Check the time on your phone and try again.") };
  redirect("/");
}

/** Admin: require two-factor sign-in for every user of the organization. */
export async function setRequireMfaAction(input: unknown): Promise<Result<null>> {
  const parsed = z.object({ required: z.boolean() }).strict().safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const { user, auth: a } = await auth();
  if (user.profile.role !== "admin") return { ok: false, error: tr("Only an admin can change this.") };
  if (parsed.data.required && (await mfaState(a)).factors.length === 0) return { ok: false, error: tr("Set up two-factor sign-in for yourself first.") };
  const db = await createSupabaseServerClient();
  const { data: org } = await db.from("organizations").select("settings").eq("id", user.profile.organization_id).single();
  const { error } = await db.from("organizations").update({ settings: { ...(org?.settings ?? {}), require_mfa: parsed.data.required } }).eq("id", user.profile.organization_id);
  if (error) return { ok: false, error: error.message };
  await recordSystemSecurity([user.profile.organization_id], { user_id: user.profile.id, role: user.profile.role }, { type: "settings.changed", payload: { target: { type: "organization", id: user.profile.organization_id }, fields: ["require_mfa"] } });
  return { ok: true, data: null };
}
