import { describe, expect, it } from "vitest";
import { enrollTotp, mfaPending, mfaState, removeFactor, verifyCode } from "@/server/mfa";

/** A stand-in for Supabase Auth's MFA API with one authenticator and a fixed valid code. */
function fakeAuth(opts: { verified?: boolean; level?: "aal1" | "aal2" } = {}) {
  const calls: string[] = [];
  const factors = opts.verified ? [{ id: "f1", status: "verified", friendly_name: "NEXORA" }] : [{ id: "old", status: "unverified", friendly_name: "NEXORA" }];
  const mfa = {
    listFactors: async () => ({ data: { totp: factors, all: factors }, error: null }),
    getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: opts.level ?? "aal1", nextLevel: opts.verified ? "aal2" : "aal1" }, error: null }),
    enroll: async () => (calls.push("enroll"), { data: { id: "f2", totp: { qr_code: "data:image/svg+xml;base64,AAA", secret: "SECRET", uri: "otpauth://" } }, error: null }),
    unenroll: async ({ factorId }: { factorId: string }) => (calls.push(`unenroll:${factorId}`), { data: { id: factorId }, error: null }),
    challengeAndVerify: async ({ code }: { factorId: string; code: string }) => (calls.push(`verify:${code}`), code === "123456" ? { data: {}, error: null } : { data: null, error: { message: "Invalid TOTP code entered" } }),
  };
  return { auth: { mfa } as never, calls };
}

describe("two-factor sign-in", () => {
  it("knows when a session still needs the code", async () => {
    expect(mfaPending(await mfaState(fakeAuth({ verified: true, level: "aal1" }).auth))).toBe(true);
    expect(mfaPending(await mfaState(fakeAuth({ verified: true, level: "aal2" }).auth))).toBe(false);
    expect(mfaPending(await mfaState(fakeAuth().auth))).toBe(false);
  });

  it("clears an unfinished setup before a new one and checks codes", async () => {
    const { auth, calls } = fakeAuth();
    expect(await enrollTotp(auth)).toEqual({ factorId: "f2", qr: "data:image/svg+xml;base64,AAA", secret: "SECRET" });
    expect(calls).toEqual(["unenroll:old", "enroll"]);
    expect(await verifyCode(auth, "f2", "12345")).toBe(false);
    expect(await verifyCode(auth, "f2", "000000")).toBe(false);
    expect(await verifyCode(auth, "f2", "123456")).toBe(true);
  });

  it("turns off only with a valid current code", async () => {
    const { auth, calls } = fakeAuth({ verified: true, level: "aal2" });
    expect(await removeFactor(auth, "f1", "999999")).toBe(false);
    expect(calls).not.toContain("unenroll:f1");
    expect(await removeFactor(auth, "f1", "123456")).toBe(true);
    expect(calls).toContain("unenroll:f1");
  });
});
