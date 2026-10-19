/**
 * Service plumbing shared by every CRM service:
 * - ServiceContext (actor + request metadata, always from the server session)
 * - the event bus with the audit-log subscriber
 * - visibility helpers that turn "exists but not yours" into 404 and emit authz.denied
 */
import { randomUUID } from "node:crypto";
import type { AuditLog, Profile } from "@/domain/entities";
import { EventBus } from "@/domain/events/bus";
import type { DomainEvent, EventInput } from "@/domain/events/types";
import { can, isWithinScope, PermissionError, scopeFor, visibleOwnerIds, type Action, type Actor, type Resource } from "@/domain/permissions";
import type { RequestMeta } from "@/server/repositories/types";
import { DomainError } from "@/server/repositories/types";
import type { Db, Row, Tx, Where } from "@/server/db/types";
import type { TableName } from "@/domain/entities";

export type ServiceContext = {
  actor: Actor;
  meta: RequestMeta;
  db: Db;
  now?: () => Date;
  /** Set by the automation engine (phase 3) for events caused by a workflow. */
  causation?: { depth: number; chain: string[] };
  /**
   * Security events raised while a unit of work is open. They are written by
   * `flushSecurityEvents` after the operation finishes (even if it failed), because a
   * nested write inside the demo store's write queue would deadlock.
   */
  deferred: EventInput[];
};

export const nowOf = (ctx: ServiceContext) => (ctx.now ? ctx.now() : new Date());

export class NotFoundError extends DomainError {
  constructor(what = "Record") {
    super(`${what} not found.`, "not_found");
  }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type EventContext = { tx: Tx; ctx: ServiceContext };

export const eventBus = new EventBus<EventContext>();

const ENTITY_FROM_TYPE: Record<string, string> = {
  "deal.stage_changed": "deal",
  "lead.converted": "lead",
  "task.completed": "task",
  "order.status_changed": "order",
  "order.created_from_deal": "order",
};

export function auditRowFromEvent(event: DomainEvent): AuditLog {
  const p = event.payload as Record<string, unknown>;
  const targetType = (p.entity as string) ?? ENTITY_FROM_TYPE[event.type] ?? (p.resource as string) ?? "security";
  const targetId =
    (p.id as string) ?? (p.deal_id as string) ?? (p.lead_id as string) ?? (p.task_id as string) ?? (p.order_id as string) ?? (p.target_id as string) ?? null;
  return {
    id: randomUUID(),
    organization_id: event.organization_id,
    actor_id: event.actor.id,
    actor_role: event.actor.role,
    action: event.type,
    target_type: targetType,
    target_id: targetId,
    changes: { ...p, event_id: event.id },
    ip: event.meta.ip,
    user_agent: event.meta.user_agent,
    request_id: event.meta.request_id,
    created_at: event.occurred_at,
  };
}

// Phase 2: every domain and security event is recorded in audit_logs.
if (!eventBus.has("audit-log")) {
  eventBus.subscribe("audit-log", async (event, { tx }) => {
    await tx.insert("audit_logs", auditRowFromEvent(event));
  });
}

export function buildEvent(ctx: ServiceContext, input: EventInput): DomainEvent {
  return {
    id: randomUUID(),
    type: input.type,
    occurred_at: nowOf(ctx).toISOString(),
    organization_id: ctx.actor.organization_id,
    actor: { id: ctx.actor.id, role: ctx.actor.role },
    meta: ctx.meta,
    causation: ctx.causation ?? { depth: 0, chain: [] },
    payload: input.payload,
  } as DomainEvent;
}

/** Publishes events inside the current unit of work. */
export async function emit(tx: Tx, ctx: ServiceContext, ...inputs: EventInput[]): Promise<void> {
  await eventBus.publish(inputs.map((i) => buildEvent(ctx, i)), { tx, ctx });
}

/** Queues a security event; it is recorded after the current operation, success or failure. */
export function emitSecurity(ctx: ServiceContext, input: EventInput): void {
  ctx.deferred.push(input);
}

/** Writes queued security events in their own unit of work. Never throws. */
export async function flushSecurityEvents(ctx: ServiceContext): Promise<void> {
  if (ctx.deferred.length === 0) return;
  const inputs = ctx.deferred.splice(0);
  try {
    await ctx.db.write(ctx.actor.organization_id, (tx) => emit(tx, ctx, ...inputs));
  } catch (error) {
    // Logging failures must not change the outcome of the request.
    console.error("[security-event] failed to record", inputs.map((i) => i.type), error);
  }
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

/** Equality filter limiting a query to owners the actor may see ({} for "all"). */
export function ownerFilter<R>(ctx: ServiceContext, resource: Resource, ownerColumn: keyof R & string): Where<R> {
  const owners = visibleOwnerIds(ctx.actor, resource);
  if (owners === "all") return {};
  return { [ownerColumn]: owners } as Where<R>;
}

export async function findVisible<T extends TableName>(
  tx: Tx,
  ctx: ServiceContext,
  table: T,
  resource: Resource,
  ownerOf: (row: Row<T>) => string | null,
  where?: Where<Row<T>>,
): Promise<Row<T>[]> {
  const rows = await tx.find(table, where);
  const owners = visibleOwnerIds(ctx.actor, resource);
  return owners === "all" ? rows : rows.filter((r) => {
    const o = ownerOf(r);
    return o !== null && owners.includes(o);
  });
}

/**
 * Loads a record the actor may see, otherwise throws NotFound. A record that exists in the
 * organization but is outside the actor's scope also returns NotFound (IDOR protection) and
 * records an authz.denied security event.
 */
export async function getVisible<T extends TableName>(
  tx: Tx,
  ctx: ServiceContext,
  table: T,
  id: string,
  resource: Resource,
  ownerOf: (row: Row<T>) => string | null,
  label: string,
): Promise<Row<T>> {
  const row = await tx.get(table, id);
  if (!row) throw new NotFoundError(label);
  const scope = scopeFor(ctx.actor.role, "view", resource);
  if (!scope || !isWithinScope(ctx.actor, scope, ownerOf(row))) {
    emitSecurity(ctx, { type: "authz.denied", payload: { action: "view", resource, target_id: id, reason: "not_visible" } });
    throw new NotFoundError(label);
  }
  return row;
}

/** Throws 403 (PermissionError) and records authz.denied when the action is not allowed on a visible record. */
export function requireCan(ctx: ServiceContext, action: Action, resource: Resource, ownerId?: string | null, targetId: string | null = null): void {
  const record = ownerId === undefined ? undefined : { organization_id: ctx.actor.organization_id, owner_id: ownerId };
  if (can(ctx.actor, action, resource, record)) return;
  emitSecurity(ctx, { type: "authz.denied", payload: { action, resource, target_id: targetId, reason: "not_permitted" } });
  throw new PermissionError(action, resource);
}

/**
 * Validates an owner assignment. Sales reps cannot reassign; managers may assign within
 * their team; admins may assign to any active member of the organization.
 */
export async function resolveOwner(
  tx: Tx,
  ctx: ServiceContext,
  resource: Resource,
  requested: string | null | undefined,
  current: string | null,
  targetId: string | null,
): Promise<string | null> {
  if (requested === undefined || requested === current) return current;
  const scope = scopeFor(ctx.actor.role, "update", resource);
  const allowedToReassign = scope === "all" || scope === "team";
  const target = requested === null ? null : ((await tx.get("profiles", requested)) as Profile | null);
  const valid = requested === null || (target !== null && target.is_active && !target.archived_at);
  if (!allowedToReassign || !valid || !scope || !isWithinScope(ctx.actor, scope, requested)) {
    emitSecurity(ctx, { type: "authz.denied", payload: { action: "reassign", resource, target_id: targetId, reason: "forbidden_field" } });
    throw new PermissionError("update", resource);
  }
  return requested;
}

export function newId(): string {
  return randomUUID();
}
