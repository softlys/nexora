import type { SecurityEvent } from "@/domain/entities";
import { verifySecurityLogChain, type SecurityCategory, type SecuritySeverity } from "@/domain/security/events";
import { requireCan, type ServiceContext } from "./context";

export type SecurityLogFilters = { category?: SecurityCategory; severity?: SecuritySeverity; outcome?: SecurityEvent["outcome"]; action?: string; q?: string };

/** Admin-only view of the hash-chained security log, newest first. */
export async function listSecurityEvents(ctx: ServiceContext, filters: SecurityLogFilters, limit = 200) {
  requireCan(ctx, "view", "audit_log");
  return ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const [events, profiles] = await Promise.all([tx.find("security_events"), tx.find("profiles")]);
    const names = new Map(profiles.map((p) => [p.id, p.full_name]));
    const q = filters.q?.toLowerCase().trim();
    const rows = events
      .filter(
        (e) =>
          (!filters.category || e.category === filters.category) &&
          (!filters.severity || e.severity === filters.severity) &&
          (!filters.outcome || e.outcome === filters.outcome) &&
          (!filters.action || e.action === filters.action) &&
          (!q || `${e.action} ${e.target.type ?? ""} ${e.target.id ?? ""} ${e.source.ip ?? ""} ${JSON.stringify(e.metadata)}`.toLowerCase().includes(q)),
      )
      .sort((a, b) => b.sequence - a.sequence);
    return {
      total: rows.length,
      events: rows.slice(0, limit).map((e) => ({
        ...e,
        actor_label: e.actor.type === "user" ? (names.get(e.actor.user_id) ?? "Former member") : e.actor.type === "service" ? "NEXORA service" : e.actor.type === "api_key" ? "API key" : "Anonymous",
      })),
      actions: [...new Set(events.map((e) => e.action))].sort(),
    };
  });
}

/** Re-verifies the whole chain for the organization. */
export async function verifySecurityLog(ctx: ServiceContext) {
  requireCan(ctx, "view", "audit_log");
  const events = await ctx.db.read(ctx.actor.organization_id, (tx) => tx.find("security_events"));
  return { ...verifySecurityLogChain(events), verified_at: new Date().toISOString() };
}
