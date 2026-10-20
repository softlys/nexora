/**
 * The single permission matrix for NEXORA.
 *
 * Every server action, route handler and navigation item asks `can()`.
 * Hiding UI is never the security boundary: the same function runs on the server
 * before any read or mutation. Supabase RLS policies (supabase/migrations) mirror
 * this matrix at the database level; see docs/security.md for the table.
 */
import type { Role } from "./entities";

export const ACTIONS = ["view", "create", "update", "archive", "delete", "manage"] as const;
export type Action = (typeof ACTIONS)[number];

export const RESOURCES = [
  "organization",
  "profile",
  "team",
  "pipeline_stage",
  "company",
  "contact",
  "lead",
  "deal",
  "order",
  "payment",
  "product",
  "task",
  "activity",
  "comment",
  "notification",
  "analytics",
  "automation",
  "integration",
  "api_key",
  "audit_log",
  "demo",
  "ui_kit",
] as const;
export type Resource = (typeof RESOURCES)[number];

/**
 * own  - records the user owns (owner_id / assignee_id / recipient_id equals the user)
 * team - own records plus records owned by profiles that report to the user
 * all  - every record in the organization
 */
export type Scope = "own" | "team" | "all";

type Grants = Partial<Record<Action, Scope>>;
type Matrix = Record<Role, Partial<Record<Resource, Grants>>>;

const crud = (scope: Scope): Grants => ({ view: scope, create: scope, update: scope, archive: scope });
const viewOnly: Grants = { view: "all" };
const everything: Grants = { view: "all", create: "all", update: "all", archive: "all", delete: "all", manage: "all" };

export const PERMISSION_MATRIX: Matrix = {
  admin: Object.fromEntries(
    // Admin manages everything except other users' notifications, which stay private.
    ["organization", "profile", "team", "pipeline_stage", "company", "contact", "lead", "deal", "order", "payment", "product", "task", "activity", "comment", "analytics", "automation", "integration", "api_key", "audit_log", "demo", "ui_kit"].map(
      (r) => [r, everything],
    ),
  ) as Partial<Record<Resource, Grants>>,
  manager: {
    organization: viewOnly,
    profile: { view: "all", update: "own" },
    team: viewOnly,
    pipeline_stage: viewOnly,
    company: crud("team"),
    contact: crud("team"),
    lead: crud("team"),
    deal: crud("team"),
    order: crud("team"),
    payment: { view: "team", create: "team" },
    product: { view: "all", create: "all", update: "all", archive: "all" },
    task: crud("team"),
    activity: { view: "team", create: "team" },
    comment: { view: "team", create: "team", update: "own", archive: "own" },
    notification: { view: "own", update: "own" },
    analytics: { view: "team" },
    automation: { view: "all", create: "all", update: "all", manage: "all" },
    integration: viewOnly,
    ui_kit: viewOnly,
  },
  sales_rep: {
    organization: viewOnly,
    profile: { view: "all", update: "own" },
    pipeline_stage: viewOnly,
    company: crud("own"),
    contact: crud("own"),
    lead: crud("own"),
    deal: crud("own"),
    order: crud("own"),
    payment: { view: "own", create: "own" },
    product: viewOnly,
    task: crud("own"),
    activity: { view: "own", create: "own" },
    comment: { view: "own", create: "own", update: "own", archive: "own" },
    notification: { view: "own", update: "own" },
    analytics: { view: "own" },
    ui_kit: viewOnly,
  },
};
// Every role reads and marks its own notifications.
PERMISSION_MATRIX.admin.notification = { view: "own", update: "own" };

/** The user context `can()` needs. Built on the server from the session, never from client input. */
export type Actor = {
  id: string;
  role: Role;
  organization_id: string;
  /** Profile ids that report to this user (empty for sales reps). */
  team_member_ids: readonly string[];
};

/** A record being checked. `owner_id` is the owner, assignee or recipient, depending on the entity. */
export type RecordRef = {
  organization_id: string;
  owner_id: string | null;
};

export function scopeFor(role: Role, action: Action, resource: Resource): Scope | null {
  return PERMISSION_MATRIX[role]?.[resource]?.[action] ?? null;
}

/**
 * Returns true if the actor may perform `action` on `resource`.
 * Without a record it answers "is this allowed for at least some records?",
 * which is what navigation and create buttons need.
 * With a record it also checks organization and ownership scope.
 */
export function can(actor: Actor, action: Action, resource: Resource, record?: RecordRef): boolean {
  const scope = scopeFor(actor.role, action, resource);
  if (!scope) return false;
  if (!record) return true;
  if (record.organization_id !== actor.organization_id) return false;
  return isWithinScope(actor, scope, record.owner_id);
}

export function isWithinScope(actor: Actor, scope: Scope, ownerId: string | null): boolean {
  switch (scope) {
    case "all":
      return true;
    case "team":
      return ownerId === actor.id || (ownerId !== null && actor.team_member_ids.includes(ownerId));
    case "own":
      return ownerId === actor.id;
  }
}

/**
 * Whether a record with this owner is within the actor's scope for an action. Unassigned
 * leads (owner null) are visible to managers and admins so they can be routed; this matches
 * the "managers read unassigned leads" RLS policy.
 */
export function ownerInScope(actor: Actor, action: Action, resource: Resource, ownerId: string | null): boolean {
  const scope = scopeFor(actor.role, action, resource);
  if (!scope) return false;
  if (ownerId === null) return resource === "lead" && (scope === "team" || scope === "all");
  return isWithinScope(actor, scope, ownerId);
}

/**
 * Owner ids whose records the actor may see for a resource, or "all".
 * Repositories use this to filter list queries.
 */
export function visibleOwnerIds(actor: Actor, resource: Resource, action: Action = "view"): "all" | string[] {
  const scope = scopeFor(actor.role, action, resource);
  if (!scope) return [];
  if (scope === "all") return "all";
  if (scope === "team") return [actor.id, ...actor.team_member_ids];
  return [actor.id];
}

export class PermissionError extends Error {
  constructor(
    public readonly action: Action,
    public readonly resource: Resource,
  ) {
    super(`Not allowed to ${action} ${resource}`);
    this.name = "PermissionError";
  }
}

/** Throws PermissionError when `can()` is false. */
export function assertCan(actor: Actor, action: Action, resource: Resource, record?: RecordRef): void {
  if (!can(actor, action, resource, record)) throw new PermissionError(action, resource);
}
