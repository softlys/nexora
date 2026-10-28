import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Two-factor sign-in (TOTP: Яндекс Ключ, Google Authenticator, 1Password…) through Supabase Auth's
 * MFA. A user with a verified factor must enter a code after the password before the session
 * reaches "aal2"; until then every page sends them to /login/mfa. Demo mode has no passwords and
 * therefore no second factor.
 */

export type MfaState = { factors: Array<{ id: string; name: string | null }>; current: string | null; next: string | null };

type MfaClient = Pick<SupabaseClient["auth"], "mfa">;

export async function mfaState(auth: MfaClient): Promise<MfaState> {
  const [{ data: factors }, { data: level }] = await Promise.all([auth.mfa.listFactors(), auth.mfa.getAuthenticatorAssuranceLevel()]);
  return {
    factors: (factors?.totp ?? []).filter((f) => f.status === "verified").map((f) => ({ id: f.id, name: f.friendly_name ?? null })),
    current: level?.currentLevel ?? null,
    next: level?.nextLevel ?? null,
  };
}

/** The user set up a second factor but this session has not passed it yet. */
export const mfaPending = (s: MfaState) => s.next === "aal2" && s.current !== "aal2";

/** Starts adding an authenticator app: the QR code and the secret for manual entry. */
export async function enrollTotp(auth: MfaClient): Promise<{ factorId: string; qr: string; secret: string }> {
  // A half-finished earlier attempt blocks a new factor with the same name; remove it first.
  const { data: existing } = await auth.mfa.listFactors();
  for (const f of existing?.all ?? []) if (f.status === "unverified") await auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await auth.mfa.enroll({ factorType: "totp", friendlyName: `NEXORA ${new Date().toISOString().slice(0, 10)}` });
  if (error || !data) throw new Error(error?.message ?? "Could not start two-factor setup.");
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

/** Checks a 6-digit code for a factor (finishes setup, or passes the second step at sign-in). */
export async function verifyCode(auth: MfaClient, factorId: string, code: string): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const { error } = await auth.mfa.challengeAndVerify({ factorId, code });
  return !error;
}

/** Turns two-factor off; needs a current code so a stolen session cannot do it. */
export async function removeFactor(auth: MfaClient, factorId: string, code: string): Promise<boolean> {
  if (!(await verifyCode(auth, factorId, code))) return false;
  const { error } = await auth.mfa.unenroll({ factorId });
  return !error;
}
