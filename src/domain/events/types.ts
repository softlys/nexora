/**
 * Typed domain events. Services emit them; subscribers react.
 * Phase 2: the audit subscriber writes every event to audit_logs.
 * Phase 3: the automation engine and the security log subscribe to the same bus.
 *
 * Naming follows the security-event schema agreed for phase 3 and VIGIL:
 * `<category>.<action>`, e.g. `authz.denied`, `rate_limit.exceeded`.
 */
import type { EntityType, OrderStatus, Role } from "../entities";

export type FieldChanges = Record<string, { before: unknown; after: unknown }>;

export type RecordEntity = EntityType | "comment" | "activity" | "payment" | "order_item";

type Payloads = {
  "record.created": { entity: RecordEntity; id: string; after: Record<string, unknown> };
  "record.updated": { entity: RecordEntity; id: string; changes: FieldChanges };
  "record.archived": { entity: RecordEntity; id: string };
  "record.restored": { entity: RecordEntity; id: string };
  "record.deleted": { entity: RecordEntity; id: string; before: Record<string, unknown> };
  "record.owner_changed": { entity: RecordEntity; id: string; from: string | null; to: string | null };
  "deal.stage_changed": {
    deal_id: string;
    from_stage_id: string | null;
    to_stage_id: string;
    is_won: boolean;
    is_lost: boolean;
    lost_reason: string | null;
  };
  "lead.converted": { lead_id: string; deal_id: string; company_id: string; contact_id: string | null };
  "task.completed": { task_id: string; assignee_id: string };
  "order.status_changed": { order_id: string; from: OrderStatus; to: OrderStatus };
  "order.created_from_deal": { order_id: string; deal_id: string; mode: "draft" | "confirmed" };
  // Security events
  "authz.denied": { action: string; resource: string; target_id: string | null; reason: "not_visible" | "not_permitted" | "forbidden_field" };
  "validation.failed": { action: string; count: number; fields: string[] };
  "rate_limit.exceeded": { bucket: string; limit: number; window_seconds: number };
};

export type EventType = keyof Payloads;

export type EventActor = { id: string; role: Role } | { id: null; role: "service" };

export type EventMeta = { ip: string | null; user_agent: string | null; request_id: string };

export type DomainEvent<T extends EventType = EventType> = {
  [K in T]: {
    id: string;
    type: K;
    occurred_at: string;
    organization_id: string;
    actor: EventActor;
    meta: EventMeta;
    /** Events caused by an automation carry the chain of workflow ids (phase 3 loop protection). */
    causation: { depth: number; chain: string[] };
    payload: Payloads[K];
  };
}[T];

export type EventInput<T extends EventType = EventType> = { [K in T]: { type: K; payload: Payloads[K] } }[T];

export const SECURITY_EVENT_TYPES = ["authz.denied", "validation.failed", "rate_limit.exceeded", "record.owner_changed"] as const satisfies readonly EventType[];

export function isSecurityEvent(type: EventType): boolean {
  return (SECURITY_EVENT_TYPES as readonly string[]).includes(type);
}
