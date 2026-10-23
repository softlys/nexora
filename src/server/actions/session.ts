"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertCan } from "@/domain/permissions";
import { DEMO_ACCESS_COOKIE, DEMO_USER_COOKIE, demoAccessToken, getRepoContext, getRequestMeta } from "@/server/auth";
import { timingSafeEqual } from "node:crypto";
import { runAction } from "@/server/action-result";
import { demoAccessCode, getDataMode } from "@/server/env";
import { hitRateLimit } from "@/server/security/rate-limit";
import { supabaseCounter } from "@/server/security/shared-counter";
import { DomainError, getRepositories } from "@/server/repositories";
import { getDemoStore } from "@/server/repositories/demo";
import { signValue } from "@/server/session-signing";
import { recordSecurity } from "@/server/security/record";
import { createSupabaseServerClient } from "@/server/supabase/server";

const switchInput = z.object({ profile_id: z.uuid() }).strict();

/** Demo mode only: switch the acting user via a signed, httpOnly cookie. */
export async function switchDemoUserAction(input: unknown) {
  return runAction(async () => {
    if (getDataMode() !== "demo") throw new DomainError("User switching is only available in demo mode.");
    const { ctx } = await getRepoContext();
    const { profile_id } = switchInput.parse(input);
    const target = await getRepositories().profiles.get(ctx, profile_id);
    if (!target || !target.is_active) throw new DomainError("Demo user not found.", "not_found");

    const cookieStore = await cookies();
    cookieStore.set(DEMO_USER_COOKIE, await signValue(target.id), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    await recordSecurity({
      type: "auth.demo_user_switched",
      payload: { target: { type: "profile", id: target.id }, from_user_id: ctx.actor.id, to_user_id: target.id, to_role: target.role },
    });
    revalidatePath("/", "layout");
    return { role: target.role };
  });
}

export type DemoAccessState = { error: string | null };

/** Demo mode with NEXORA_DEMO_ACCESS_CODE: checks the shared code and opens the demo for 30 days. */
export async function demoAccessAction(_prev: DemoAccessState, form: FormData): Promise<DemoAccessState> {
  const code = getDataMode() === "demo" ? demoAccessCode() : null;
  if (!code) redirect("/");
  const meta = await getRequestMeta();
  const limit = await hitRateLimit(meta.ip ?? "unknown", "demo_access", supabaseCounter());
  if (!limit.allowed) return { error: "Too many attempts. Try again in 10 minutes." };
  const given = Buffer.from(String(form.get("code") ?? "").trim().slice(0, 200));
  const expected = Buffer.from(code);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    await new Promise((r) => setTimeout(r, 500));
    return { error: "That access code is not correct." };
  }
  (await cookies()).set(DEMO_ACCESS_COOKIE, await signValue(demoAccessToken(code)), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect("/");
}

/** Demo mode only: restore the seeded dataset. Admin only. */
export async function resetDemoDataAction() {
  return runAction(async () => {
    if (getDataMode() !== "demo") throw new DomainError("Reset is only available in demo mode.");
    const { ctx } = await getRepoContext();
    assertCan(ctx.actor, "manage", "demo");
    await getDemoStore().reset();
    // Recorded after the reset so the event survives in the fresh dataset.
    await recordSecurity({ type: "demo.reset", payload: { target: { type: "organization", id: ctx.actor.organization_id } } });
    revalidatePath("/", "layout");
    return undefined;
  });
}

export async function signOutAction() {
  if (getDataMode() === "supabase") {
    const db = await createSupabaseServerClient();
    await db.auth.signOut();
  }
  redirect("/login");
}
