/**
 * Outbound webhooks: event catalog, JSON envelope, HMAC-SHA256 signatures and retry timing.
 * Shared by Make, n8n and generic endpoints. Pure functions; delivery lives in
 * src/server/integrations/delivery.ts.
 *
 * Signature header (Stripe-style, so receivers can reject replays):
 *   X-Nexora-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { DomainEvent } from "../events/types";

/** Domain events an integration can subscribe to. */
export const OUTBOUND_EVENTS = ["lead.created", "deal.stage_changed", "deal.won", "order.created", "task.overdue", "workflow.webhook"] as const;
export type OutboundEvent = (typeof OUTBOUND_EVENTS)[number];

export const OUTBOUND_EVENT_LABELS: Record<OutboundEvent, string> = {
  "lead.created": "Lead created",
  "deal.stage_changed": "Deal stage changed",
  "deal.won": "Deal won",
  "order.created": "Order created",
  "task.overdue": "Task overdue",
  "workflow.webhook": "Sent by a workflow step",
};

export const OUTBOUND_EVENT_DESCRIPTIONS: Record<OutboundEvent, string> = {
  "lead.created": "A lead was created in the app, through the API or by import.",
  "deal.stage_changed": "A deal moved to another pipeline stage (including Won and Lost).",
  "deal.won": "A deal moved to the Won stage. Sent in addition to deal.stage_changed.",
  "order.created": "An order was created, by hand or from a won deal.",
  "task.overdue": "An open task passed its due date (raised by the scheduler).",
  "workflow.webhook": "A Send webhook step in an Automation Studio workflow ran. The envelope type is the step's event type.",
};

export const SIGNATURE_HEADER = "X-Nexora-Signature";
export const EVENT_ID_HEADER = "X-Nexora-Event-Id";
export const EVENT_TYPE_HEADER = "X-Nexora-Event-Type";
export const TOKEN_HEADER = "X-Nexora-Token";
/** Receivers should reject signatures older than this (replay protection). */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export const DELIVERY_LIMITS = {
  maxAttempts: 3,
  timeoutMs: 5_000,
  /** Response bodies are read up to this size; the stored excerpt is shorter. */
  maxResponseBytes: 64 * 1024,
  excerptLength: 1_000,
  maxRedirects: 2,
} as const;

export type WebhookEnvelope = {
  event_id: string;
  type: string;
  occurred_at: string;
  organization_id: string;
  data: Record<string, unknown>;
};

export function envelope(input: WebhookEnvelope): WebhookEnvelope {
  return { event_id: input.event_id, type: input.type, occurred_at: input.occurred_at, organization_id: input.organization_id, data: input.data };
}

/** The exact bytes that are signed and sent. */
export function serializeEnvelope(env: WebhookEnvelope): string {
  return JSON.stringify(envelope(env));
}

export function computeSignature(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function signatureHeader(secret: string, body: string, now: Date = new Date()): string {
  const t = Math.floor(now.getTime() / 1000);
  return `t=${t},v1=${computeSignature(secret, t, body)}`;
}

export type SignatureCheck = { ok: true } | { ok: false; reason: "malformed" | "expired" | "mismatch" };

/** Verifies a signature header in constant time, rejecting stale timestamps. */
export function verifySignature(secret: string, header: string | null | undefined, body: string, now: Date = new Date(), toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS): SignatureCheck {
  if (!header) return { ok: false, reason: "malformed" };
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return i < 0 ? [p.trim(), ""] : [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = Number(parts.t);
  const v1 = parts.v1 ?? "";
  if (!Number.isInteger(t) || !/^[a-f0-9]{64}$/.test(v1)) return { ok: false, reason: "malformed" };
  if (Math.abs(Math.floor(now.getTime() / 1000) - t) > toleranceSeconds) return { ok: false, reason: "expired" };
  const expected = Buffer.from(computeSignature(secret, t, body), "hex");
  const given = Buffer.from(v1, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given) ? { ok: true } : { ok: false, reason: "mismatch" };
}

/**
 * Delay before the next attempt (exponential backoff): attempt 1 failed → 1 minute,
 * attempt 2 failed → 4 minutes. Null when no attempts remain.
 */
export function retryDelayMs(failedAttempt: number): number | null {
  if (failedAttempt >= DELIVERY_LIMITS.maxAttempts) return null;
  return 60_000 * 4 ** (failedAttempt - 1);
}

/** A 2xx response is delivered; 408, 429 and 5xx are worth retrying; other 4xx are not. */
export function isRetryableStatus(status: number | null): boolean {
  if (status === null) return true;
  return status === 408 || status === 429 || status >= 500;
}

type OutboundMapping = { type: OutboundEvent; data: Record<string, unknown>; recordId: string | null };

/**
 * Turns a committed domain event into the outbound events it produces. Only ids and
 * business fields go out; the full record is fetched by the dispatcher.
 */
export function outboundEventsFor(event: DomainEvent): OutboundMapping[] {
  const p = event.payload as Record<string, unknown>;
  switch (event.type) {
    case "record.created":
      if (p.entity === "lead") return [{ type: "lead.created", data: { lead_id: p.id }, recordId: p.id as string }];
      if (p.entity === "order") return [{ type: "order.created", data: { order_id: p.id }, recordId: p.id as string }];
      return [];
    case "deal.stage_changed": {
      const data = { deal_id: p.deal_id, from_stage_id: p.from_stage_id, to_stage_id: p.to_stage_id, is_won: p.is_won, is_lost: p.is_lost, lost_reason: p.lost_reason };
      const out: OutboundMapping[] = [{ type: "deal.stage_changed", data, recordId: p.deal_id as string }];
      if (p.is_won) out.push({ type: "deal.won", data, recordId: p.deal_id as string });
      return out;
    }
    case "date.reached":
      if (p.entity === "task" && p.field === "due_at") return [{ type: "task.overdue", data: { task_id: p.id, due_at: p.at, task_type: p.task_type ?? null }, recordId: p.id as string }];
      return [];
    default:
      return [];
  }
}

/** Delivery event id: stable per source event and outbound type, so receivers can deduplicate. */
export function outboundEventId(sourceEventId: string, type: string): string {
  return type === "deal.won" ? `${sourceEventId}:won` : sourceEventId;
}
