"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertCan } from "@/domain/permissions";
import { DEMO_USER_COOKIE, getRepoContext } from "@/server/auth";
import { runAction } from "@/server/action-result";
import { getDataMode } from "@/server/env";
import { DomainError, getRepositories } from "@/server/repositories";
import { getDemoStore } from "@/server/repositories/demo";
import { signValue } from "@/server/session-signing";
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
    await getRepositories().audit.record(ctx, {
      action: "auth.demo_user_switched",
      target_type: "profile",
      target_id: target.id,
      changes: { from: ctx.actor.id, to: target.id },
    });
    revalidatePath("/", "layout");
    return { role: target.role };
  });
}

/** Demo mode only: restore the seeded dataset. Admin only. */
export async function resetDemoDataAction() {
  return runAction(async () => {
    if (getDataMode() !== "demo") throw new DomainError("Reset is only available in demo mode.");
    const { ctx } = await getRepoContext();
    assertCan(ctx.actor, "manage", "demo");
    await getDemoStore().reset();
    await getRepositories().audit.record(ctx, { action: "demo.reset", target_type: "organization", target_id: ctx.actor.organization_id, changes: {} });
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
