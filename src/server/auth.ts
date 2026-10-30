import "server-only";
import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Profile } from "@/domain/entities";
import { DEMO_ORG_ID, DEMO_USER_IDS } from "@/domain/seed/generate";
import type { Actor } from "@/domain/permissions";
import { createHash } from "node:crypto";
import { demoAccessCode, getDataMode } from "@/server/env";
import { clientIp } from "@/server/security/client-ip";
import { getDemoStore } from "@/server/repositories/demo";
import type { RepoContext, RequestMeta } from "@/server/repositories/types";
import { verifySignedValue } from "@/server/session-signing";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { roleRestrictionFor } from "@/domain/permissions";
import type { Organization } from "@/domain/entities";

export const DEMO_USER_COOKIE = "nx_demo_user";
export const DEMO_ACCESS_COOKIE = "nx_demo_access";

/** The signed value of the access cookie; it changes with the code, so a new code locks out old visitors. */
export function demoAccessToken(code: string): string {
  return `demo-access:${createHash("sha256").update(code).digest("hex").slice(0, 32)}`;
}

/**
 * Demo with NEXORA_DEMO_ACCESS_CODE: whether this request carries the access cookie. The public
 * endpoints (website form, chat widget) check it too, so a closed demo stays closed to outsiders.
 */
export async function hasDemoAccess(): Promise<boolean> {
  const code = getDataMode() === "demo" ? demoAccessCode() : null;
  if (!code) return true;
  return (await verifySignedValue((await cookies()).get(DEMO_ACCESS_COOKIE)?.value)) === demoAccessToken(code);
}

export type SessionUser = {
  profile: Profile;
  actor: Actor;
  mode: "demo" | "supabase";
  /**
   * Two-factor state (Supabase mode): "pending" until the code is entered after the password,
   * "setup_required" when the organization requires two-factor and the user has not set it up.
   */
  mfa?: "pending" | "setup_required";
};

function toActor(profile: Profile, all: Profile[], settings?: Organization["settings"] | null): Actor {
  return {
    id: profile.id,
    role: profile.role,
    organization_id: profile.organization_id,
    team_member_ids: all.filter((p) => p.manager_id === profile.id && !p.archived_at).map((p) => p.id),
    ...roleRestrictionFor(profile.role, settings),
  };
}

async function demoSession(): Promise<SessionUser> {
  // Read the cookie first: it marks the route dynamic before any file I/O, so builds never
  // prerender (and write the demo store from) an authenticated page.
  const cookieStore = await cookies();
  if (!(await hasDemoAccess())) redirect("/login");
  const data = await getDemoStore().read();
  const chosenId = await verifySignedValue(cookieStore.get(DEMO_USER_COOKIE)?.value);
  const profiles = data.profiles.filter((p) => p.organization_id === DEMO_ORG_ID);
  // Without a valid signed cookie the demo starts as the admin user.
  const profile =
    profiles.find((p) => p.id === chosenId && p.is_active && !p.archived_at) ??
    profiles.find((p) => p.id === DEMO_USER_IDS.admin) ??
    profiles.find((p) => p.role === "admin");
  if (!profile) throw new Error("Demo dataset has no admin user. Reset demo data with `npm run demo:reset`.");
  return { profile, actor: toActor(profile, profiles, data.organizations.find((o) => o.id === profile.organization_id)?.settings), mode: "demo" };
}

async function supabaseSession(): Promise<SessionUser | null> {
  const db = await createSupabaseServerClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return null;
  const { data: profile } = await db.from("profiles").select("*").eq("id", auth.user.id).maybeSingle();
  if (!profile || !profile.is_active || profile.archived_at) return null;
  const { data: team } = await db.from("profiles").select("*").eq("organization_id", profile.organization_id);
  const { data: org } = await db.from("organizations").select("settings").eq("id", profile.organization_id).maybeSingle();
  const settings = (org?.settings ?? null) as Organization["settings"] | null;
  // The assurance level is read from the session token, without a network call.
  const { data: level } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  const mfa = level?.nextLevel === "aal2" && level.currentLevel !== "aal2" ? "pending" : settings?.require_mfa && level?.nextLevel !== "aal2" ? "setup_required" : undefined;
  return { profile: profile as Profile, actor: toActor(profile as Profile, (team ?? []) as Profile[], settings), mode: "supabase", ...(mfa && { mfa }) };
}

/** The current user, resolved once per request. Null only in Supabase mode when signed out. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  return getDataMode() === "supabase" ? supabaseSession() : demoSession();
});

/** Use in pages, layouts and server actions. Redirects to /login when signed out (Supabase mode). */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.mfa === "pending") redirect("/login/mfa");
  if (user.mfa === "setup_required") redirect("/two-factor");
  return user;
}

export const getRequestMeta = cache(async (): Promise<RequestMeta> => {
  const h = await headers();
  return {
    ip: clientIp(h.get("x-forwarded-for"), h.get("x-real-ip")),
    user_agent: h.get("user-agent")?.slice(0, 512) ?? null,
    request_id: h.get("x-request-id") ?? randomUUID(),
  };
});

/** Repository context for the current request. Organization and actor come only from the session. */
export async function getRepoContext(): Promise<{ user: SessionUser; ctx: RepoContext }> {
  const user = await requireUser();
  return { user, ctx: { actor: user.actor, meta: await getRequestMeta() } };
}
