/**
 * Service plumbing shared by every CRM service:
 * - ServiceContext (actor + request metadata, always from the server session)
 * - the event bus with the audit-log subscriber
 * - visibility helpers that turn "exists but not yours" into 404 and emit authz.denied
 */
import { outboundEventsFor } from "@/domain/integrations/webhooks";
import { getServiceDb } from "@/server/db";
import { getDataMode } from "@/server/env";
import { enqueueOutbound } from "@/server/integrations/webhooks";
import { randomUUID } from "node:crypto";
import type { AuditLog, Profile } from "@/domain/entities";
import { EventBus } from "@/domain/events/bus";
import { isSecurityEvent, type DomainEvent, type EventInput } from "@/domain/events/types";
import type { SecurityActor, SecurityEventDraft } from "@/domain/security/events";
import { can, ownerInScope, PermissionError, scopeFor, visibleOwnerIds, type Action, type Actor, type Resource } from "@/domain/permissions";
import type { RequestMeta } from "@/server/repositories/types";
import { DomainError } from "@/server/repositories/types";
import type { Db, Row, Tx, Where } from "@/server/db/types";
import type { TableName } from "@/domain/entities";
import type { Counter } from "@/server/security/rate-limit";
import { supabaseCounter } from "@/server/security/shared-counter";

export type ServiceContext = {
  actor: Actor;
  meta: RequestMeta;
  db: Db;
  now?: () => Date;
  /** Set by the automation engine for events caused by a workflow. */
  causation?: { depth: number; chain: string[] };
  /** "service" when the automation engine or scheduler acts (no user session). */
  principal?: "user" | "service" | "anonymous";
  /**
   * Security events raised while a unit of work is open. They are written by
   * `flushSecurityEvents` after the operation finishes (even if it failed), because a
   * nested write inside the demo store's write queue would deadlock.
   */
  deferred: EventInput[];
  /**
   * Domain events that may trigger automations. Collected while the unit of work runs and
   * dispatched only after it committed (see dispatchAutomations), never inside it.
   */
  pendingEvents?: DomainEvent[];
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
    changes: event.meta.api_key_id ? { ...p, event_id: event.id, via_api_key_id: event.meta.api_key_id } : { ...p, event_id: event.id },
    ip: event.meta.ip,
    user_agent: event.meta.user_agent,
    request_id: event.meta.request_id,
    created_at: event.occurred_at,
  };
}

export function securityDraftFromEvent(event: DomainEvent): SecurityEventDraft {
  const p = { ...(event.payload as Record<string, unknown>) };
  // Automation runs are the service even when an API request started them; the key is kept as context.
  const actor: SecurityActor =
    event.actor.role === "service"
      ? { type: "service", name: "nexora" }
      : event.meta.api_key_id
        ? { type: "api_key", api_key_id: event.meta.api_key_id }
        : event.actor.id !== null
          ? { type: "user", user_id: event.actor.id, role: event.actor.role }
          : { type: "anonymous" };
  if (event.actor.role === "service" && event.meta.api_key_id) p.caused_by_api_key_id = event.meta.api_key_id;
  let target = (p.target as { type: string | null; id: string | null } | undefined) ?? null;
  if (!target && event.type === "authz.denied") target = { type: p.resource as string, id: (p.target_id as string | null) ?? null };
  if (!target && typeof p.entity === "string") target = { type: p.entity, id: (p.id as string) ?? null };
  const outcome = p.outcome as SecurityEventDraft["outcome"];
  const severity = p.severity as SecurityEventDraft["severity"];
  delete p.target;
  delete p.outcome;
  delete p.severity;
  if (event.causation.depth > 0) p.causation = event.causation;
  return {
    event_id: event.id,
    organization_id: event.organization_id,
    occurred_at: event.occurred_at,
    action: event.type as SecurityEventDraft["action"],
    outcome,
    severity,
    actor,
    source: { ip: event.meta.ip, user_agent: event.meta.user_agent, request_id: event.meta.request_id },
    target: target ?? undefined,
    metadata: p,
  };
}

// Domain events go to audit_logs; security events go to the hash-chained security_events log.
if (!eventBus.has("audit-log")) {
  eventBus.subscribe("audit-log", async (event, { tx }) => {
    if (isSecurityEvent(event.type)) return;
    await tx.insert("audit_logs", auditRowFromEvent(event));
  });
}
const AUTOMATION_TRIGGER_TYPES = new Set(["record.created", "record.updated", "deal.stage_changed", "date.reached", "webhook.received"]);
if (!eventBus.has("automation-queue")) {
  eventBus.subscribe("automation-queue", (event, { ctx }) => {
    if (ctx.pendingEvents && AUTOMATION_TRIGGER_TYPES.has(event.type)) ctx.pendingEvents.push(event);
  });
}
// Outbox for outbound webhooks (see enqueueOutbound). Supabase mode has no multi-statement
// transactions and RLS may hide integrations from the user, so the rows are written with the
// service client before the action returns; the demo adapter writes them in the same unit of work.
if (!eventBus.has("webhook-outbox")) {
  eventBus.subscribe("webhook-outbox", async (event, { tx, ctx }) => {
    if (outboundEventsFor(event).length === 0) return;
    try {
      if (getDataMode() === "supabase") await getServiceDb().write(event.organization_id, (stx) => enqueueOutbound(stx, event, nowOf(ctx)));
      else await enqueueOutbound(tx, event, nowOf(ctx));
    } catch (error) {
      // Never fail the user's action over the outbox: the after-response send still runs.
      console.error(`[outbox] could not queue webhooks for ${event.type}`, error);
    }
  });
}
if (!eventBus.has("security-log")) {
  eventBus.subscribe("security-log", async (event, { tx }) => {
    if (!isSecurityEvent(event.type)) return;
    await tx.appendSecurityEvent(securityDraftFromEvent(event));
  });
}

export function buildEvent(ctx: ServiceContext, input: EventInput): DomainEvent {
  return {
    id: randomUUID(),
    type: input.type,
    occurred_at: nowOf(ctx).toISOString(),
    organization_id: ctx.actor.organization_id,
    actor:
      ctx.principal === "service"
        ? { id: null, role: "service" }
        : ctx.principal === "anonymous"
          ? { id: null, role: "anonymous" }
          : { id: ctx.actor.id, role: ctx.actor.role },
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
  if (visibleOwnerIds(ctx.actor, resource) === "all") return rows;
  return rows.filter((r) => ownerInScope(ctx.actor, "view", resource, ownerOf(r)));
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
  if (!ownerInScope(ctx.actor, "view", resource, ownerOf(row))) {
    emitSecurity(ctx, { type: "authz.denied", payload: { action: "view", resource, target_id: id, reason: "not_visible" } });
    throw new NotFoundError(label);
  }
  return row;
}

/** Throws 403 (PermissionError) and records authz.denied when the action is not allowed on a visible record. */
export function requireCan(ctx: ServiceContext, action: Action, resource: Resource, ownerId?: string | null, targetId: string | null = null): void {
  const allowed = ownerId === undefined ? can(ctx.actor, action, resource) : ownerInScope(ctx.actor, action, resource, ownerId);
  if (allowed) return;
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
  if (!allowedToReassign || !valid || !scope || !ownerInScope(ctx.actor, "update", resource, requested)) {
    emitSecurity(ctx, { type: "authz.denied", payload: { action: "reassign", resource, target_id: targetId, reason: "forbidden_field" } });
    throw new PermissionError("update", resource);
  }
  return requested;
}

export function newId(): string {
  return randomUUID();
}

// ---------------------------------------------------------------------------
// Bulk read detection
// ---------------------------------------------------------------------------

const BULK_WINDOW_MS = 5 * 60_000;
const bulkReads = globalThis as unknown as { __nexoraBulkReads?: Map<string, { start: number; count: number; flagged: boolean }> };

export function bulkReadThreshold(): number {
  const n = Number(process.env.NEXORA_BULK_READ_THRESHOLD);
  return Number.isFinite(n) && n > 0 ? n : 300;
}

/**
 * Counts records returned to a user. Crossing the threshold within five minutes emits one
 * data.bulk_read event for that window (a signal for VIGIL's exfiltration rule). In Supabase mode
 * the count is shared by every server instance (public.hit_counter).
 */
export async function trackRead(ctx: ServiceContext, resource: string, records: number, now = Date.now(), counter: Counter | null = supabaseCounter()): Promise<void> {
  if (ctx.principal === "service" || records <= 0) return;
  const threshold = bulkReadThreshold();
  if (counter) {
    const total = await counter(`bulk:${ctx.actor.id}`, BULK_WINDOW_MS / 1000, records);
    // Flag once per window: on the request that crossed the threshold.
    if (total > threshold && total - records <= threshold) {
      emitSecurity(ctx, { type: "data.bulk_read", payload: { resource, records: total, threshold, window_seconds: BULK_WINDOW_MS / 1000 } });
    }
    return;
  }
  bulkReads.__nexoraBulkReads ??= new Map();
  const windows = bulkReads.__nexoraBulkReads;
  const key = ctx.actor.id;
  let w = windows.get(key);
  if (!w || now - w.start >= BULK_WINDOW_MS) {
    w = { start: now, count: 0, flagged: false };
    windows.set(key, w);
  }
  w.count += records;
  if (!w.flagged && w.count > threshold) {
    w.flagged = true;
    emitSecurity(ctx, { type: "data.bulk_read", payload: { resource, records: w.count, threshold, window_seconds: BULK_WINDOW_MS / 1000 } });
  }
}
