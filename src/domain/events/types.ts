/**
 * Typed domain events. Services emit them; subscribers react.
 * - audit-log subscriber: writes domain events to audit_logs
 * - security-log subscriber: writes security events to the hash-chained security_events log
 * - automation subscriber: queues events for workflows (run after the change commits)
 *
 * Security event names follow `<category>.<action>` as agreed with VIGIL; the catalog with
 * category and severity lives in src/domain/security/events.ts.
 */
import type { EntityType, OrderStatus, Role } from "../entities";
import { isSecurityAction, type SecurityAction, type SecurityOutcome, type SecuritySeverity } from "../security/events";

export type FieldChanges = Record<string, { before: unknown; after: unknown }>;

export type RecordEntity = EntityType | "comment" | "activity" | "payment" | "order_item" | "workflow" | "notification";

/** Payload for security events without a dedicated type below. */
export type SecurityPayload = {
  target?: { type: string | null; id: string | null };
  outcome?: SecurityOutcome;
  severity?: SecuritySeverity;
  [key: string]: unknown;
};

type DomainPayloads = {
  "record.created": { entity: RecordEntity; id: string; after: Record<string, unknown> };
  "record.updated": { entity: RecordEntity; id: string; changes: FieldChanges };
  "record.archived": { entity: RecordEntity; id: string };
  "record.restored": { entity: RecordEntity; id: string };
  "record.deleted": { entity: RecordEntity; id: string; before: Record<string, unknown> };
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
  /** Raised by the scheduler for date-based triggers (e.g. a follow-up task passing its due date). */
  "date.reached": { entity: RecordEntity; id: string; field: string; at: string; task_type?: string };
  /** Raised by the inbound API in phase 4. */
  "webhook.received": { event_type: string; data: Record<string, unknown> };
};

type TypedSecurityPayloads = {
  "authz.denied": { action: string; resource: string; target_id: string | null; reason: "not_visible" | "not_permitted" | "forbidden_field" };
  "validation.failed": { action: string; count: number; fields: string[] };
  "rate_limit.exceeded": { bucket: string; limit: number; window_seconds: number };
  "record.owner_changed": { entity: RecordEntity; id: string; from: string | null; to: string | null };
};

type Payloads = DomainPayloads & TypedSecurityPayloads & { [K in Exclude<SecurityAction, keyof TypedSecurityPayloads>]: SecurityPayload };

export type EventType = keyof Payloads;

export type EventActor = { id: string; role: Role } | { id: null; role: "service" } | { id: null; role: "anonymous" };

export type EventMeta = { ip: string | null; user_agent: string | null; request_id: string };

export type DomainEvent<T extends EventType = EventType> = {
  [K in T]: {
    id: string;
    type: K;
    occurred_at: string;
    organization_id: string;
    actor: EventActor;
    meta: EventMeta;
    /** Workflow ids that caused this event (automation loop protection). */
    causation: { depth: number; chain: string[] };
    payload: Payloads[K];
  };
}[T];

export type EventInput<T extends EventType = EventType> = { [K in T]: { type: K; payload: Payloads[K] } }[T];

export function isSecurityEvent(type: EventType): type is SecurityAction {
  return isSecurityAction(type);
}
