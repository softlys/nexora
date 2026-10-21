import "server-only";
import type { Role } from "@/domain/entities";
import type { EventInput } from "@/domain/events/types";
import { getRequestMeta } from "@/server/auth";
import { getServiceDb } from "@/server/db";
import { getServiceContext } from "@/server/service-action";
import { emit, type ServiceContext } from "@/server/services/context";

/**
 * Records security events for the signed-in user, outside a service unit of work
 * (settings changes, demo user switch, demo reset). Failures are logged, never thrown:
 * logging must not change the outcome of the action that triggered it.
 */
export async function recordSecurity(...inputs: EventInput[]): Promise<void> {
  try {
    const ctx = await getServiceContext();
    await ctx.db.write(ctx.actor.organization_id, (tx) => emit(tx, ctx, ...inputs));
  } catch (error) {
    console.error("[security-event] failed to record", inputs.map((i) => i.type), error);
  }
}

/**
 * Records security events that have no session (failed login, unauthorized cron call,
 * scheduler heartbeat) for the given organizations, through the service-principal database.
 * A successful sign-in passes the signed-in user as the principal, so the actor is that user.
 */
export async function recordSystemSecurity(organizationIds: string[], principal: "anonymous" | "service" | { user_id: string; role: Role }, ...inputs: EventInput[]): Promise<void> {
  const meta = await getRequestMeta().catch(() => ({ ip: null, user_agent: null, request_id: "system" }));
  for (const organization_id of organizationIds) {
    // A user principal is the person the event is about before their session exists (a successful sign-in).
    const asUser = typeof principal === "object";
    const ctx: ServiceContext = {
      actor: { id: asUser ? principal.user_id : "00000000-0000-4000-8000-000000000000", role: asUser ? principal.role : "admin", organization_id, team_member_ids: [] },
      meta,
      db: getServiceDb(),
      deferred: [],
      principal: asUser ? "user" : principal,
    };
    try {
      await ctx.db.write(organization_id, (tx) => emit(tx, ctx, ...inputs));
    } catch (error) {
      console.error("[security-event] failed to record", inputs.map((i) => i.type), error);
    }
  }
}
