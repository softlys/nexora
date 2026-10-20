import "server-only";
import { randomUUID } from "node:crypto";
import type { IntegrationSetting, WebhookDelivery } from "@/domain/entities";
import type { DomainEvent } from "@/domain/events/types";
import {
  DELIVERY_LIMITS,
  EVENT_ID_HEADER,
  EVENT_TYPE_HEADER,
  isRetryableStatus,
  outboundEventId,
  outboundEventsFor,
  retryDelayMs,
  serializeEnvelope,
  SIGNATURE_HEADER,
  signatureHeader,
  TOKEN_HEADER,
  type OutboundEvent,
  type WebhookEnvelope,
} from "@/domain/integrations/webhooks";
import type { Db, Tx } from "@/server/db/types";
import type { RequestMeta } from "@/server/repositories/types";
import { emit, type ServiceContext } from "@/server/services/context";
import { decryptSecret } from "./secret-box";
import { createTransport, SsrfBlockedError, transportOptionsFromEnv, type Transport } from "./transport";

/** Providers that receive outbound webhooks. The email provider is configured by env vars. */
export const WEBHOOK_PROVIDERS = ["make", "n8n", "generic_webhook"] as const;
export type WebhookProvider = (typeof WEBHOOK_PROVIDERS)[number];

export type WebhookDeps = { db: Db; meta: RequestMeta; now?: () => Date; transport?: Transport };

const SERVICE_ID = "00000000-0000-4000-8000-00000000a071";
const nowOf = (deps: WebhookDeps) => (deps.now ? deps.now() : new Date());

function systemContext(deps: WebhookDeps, orgId: string): ServiceContext {
  return {
    actor: { id: SERVICE_ID, role: "admin", organization_id: orgId, team_member_ids: [] },
    principal: "service",
    meta: deps.meta,
    db: deps.db,
    now: deps.now,
    deferred: [],
  };
}

export function integrationUrl(integration: Pick<IntegrationSetting, "config">): string | null {
  const url = integration.config.url;
  return typeof url === "string" && url.length > 0 ? url : null;
}

export function isWebhookProvider(provider: string): provider is WebhookProvider {
  return (WEBHOOK_PROVIDERS as readonly string[]).includes(provider);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "invalid-url";
  }
}

/** A compact copy of the record an event is about, so receivers rarely need to call back. */
async function recordSnapshot(tx: Tx, type: string, recordId: string | null): Promise<Record<string, unknown> | null> {
  if (!recordId) return null;
  if (type === "lead.created") {
    const l = await tx.get("leads", recordId);
    return l && { id: l.id, title: l.title, company_name: l.company_name, contact_name: l.contact_name, email: l.email, phone: l.phone, country: l.country, source: l.source, status: l.status, qualification: l.qualification, estimated_value: l.estimated_value, currency: l.currency, owner_id: l.owner_id, created_at: l.created_at };
  }
  if (type === "deal.stage_changed" || type === "deal.won") {
    const d = await tx.get("deals", recordId);
    if (!d) return null;
    const stage = await tx.get("pipeline_stages", d.stage_id);
    return { id: d.id, name: d.name, company_id: d.company_id, amount: d.amount, currency: d.currency, stage: stage?.name ?? null, probability: d.probability, expected_close_date: d.expected_close_date, owner_id: d.owner_id, closed_at: d.closed_at };
  }
  if (type === "order.created") {
    const o = await tx.get("orders", recordId);
    return o && { id: o.id, order_number: o.order_number, company_id: o.company_id, status: o.status, total: o.total, currency: o.currency, payment_status: o.payment_status, source_deal_id: o.source_deal_id, owner_id: o.owner_id, order_date: o.order_date };
  }
  if (type === "task.overdue") {
    const t = await tx.get("tasks", recordId);
    return t && { id: t.id, title: t.title, type: t.type, priority: t.priority, status: t.status, due_at: t.due_at, assignee_id: t.assignee_id, deal_id: t.deal_id, order_id: t.order_id, company_id: t.company_id, contact_id: t.contact_id };
  }
  return null;
}

export type AttemptOptions = { attempt: number; reason: WebhookDelivery["reason"]; retry: boolean };

/**
 * Sends one attempt and stores it in webhook_deliveries (status code, duration, response
 * excerpt, error, next retry). SSRF blocks are never retried and raise security.ssrf_blocked.
 */
export async function attemptDelivery(deps: WebhookDeps, integration: IntegrationSetting, env: WebhookEnvelope, options: AttemptOptions): Promise<WebhookDelivery> {
  const orgId = integration.organization_id;
  const url = integrationUrl(integration);
  const at = nowOf(deps);
  const delivery: WebhookDelivery = {
    id: randomUUID(),
    organization_id: orgId,
    integration_id: integration.id,
    event_id: env.event_id,
    event_type: env.type,
    url: url ?? "https://invalid.example",
    attempt: options.attempt,
    status: "failed",
    status_code: null,
    duration_ms: null,
    request_body: env as unknown as Record<string, unknown>,
    response_excerpt: null,
    error: null,
    next_retry_at: null,
    reason: options.reason,
    created_at: at.toISOString(),
  };
  let blocked: SsrfBlockedError | null = null;
  let retryable = false;
  const started = Date.now();
  try {
    if (!url) throw new Error("No webhook URL is configured.");
    if (!integration.secret_ciphertext) throw new Error("No signing secret is configured.");
    const secret = await decryptSecret(integration.secret_ciphertext);
    const body = serializeEnvelope(env);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "NEXORA-Webhooks/1.0",
      [EVENT_ID_HEADER]: env.event_id,
      [EVENT_TYPE_HEADER]: env.type,
      [SIGNATURE_HEADER]: signatureHeader(secret, body, at),
    };
    if (integration.config.auth_mode === "header_token") headers[TOKEN_HEADER] = secret;
    const transport = deps.transport ?? createTransport(transportOptionsFromEnv());
    const res = await transport({ url, body, headers });
    delivery.status_code = res.status;
    delivery.duration_ms = res.durationMs;
    delivery.response_excerpt = res.body.slice(0, DELIVERY_LIMITS.excerptLength) || null;
    if (res.status >= 200 && res.status < 300) delivery.status = "success";
    else {
      delivery.error = `Receiver responded with HTTP ${res.status}`;
      retryable = isRetryableStatus(res.status);
    }
  } catch (error) {
    delivery.duration_ms = Date.now() - started;
    if (error instanceof SsrfBlockedError) {
      blocked = error;
      delivery.error = `Blocked by SSRF protection: ${error.reason}`;
    } else {
      delivery.error = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      retryable = Boolean(url && integration.secret_ciphertext);
    }
  }
  if (delivery.status === "failed" && retryable && options.retry) {
    const delay = retryDelayMs(options.attempt);
    if (delay !== null) delivery.next_retry_at = new Date(at.getTime() + delay).toISOString();
  }

  const ctx = systemContext(deps, orgId);
  await deps.db.write(orgId, async (tx) => {
    await tx.insert("webhook_deliveries", delivery);
    if (options.reason === "test") {
      await tx.update("integration_settings", integration.id, {
        last_tested_at: at.toISOString(),
        last_test_ok: delivery.status === "success",
        last_error: delivery.status === "success" ? null : delivery.error,
        updated_at: at.toISOString(),
      });
    }
    if (blocked) {
      await emit(tx, ctx, {
        type: "security.ssrf_blocked",
        payload: { target: { type: "integration", id: integration.id }, provider: integration.provider, host: blocked.host, reason: blocked.reason, event_type: env.type },
      });
    } else if (delivery.status_code !== null) {
      await emit(tx, ctx, {
        type: "integration.webhook_sent",
        payload: {
          target: { type: "integration", id: integration.id },
          outcome: delivery.status === "success" ? "success" : "failure",
          provider: integration.provider,
          domain: hostOf(delivery.url),
          event_type: env.type,
          event_id: env.event_id,
          attempt: options.attempt,
          status_code: delivery.status_code,
        },
      });
    }
  });
  return delivery;
}

async function activeIntegrations(tx: Tx, subscribedTo: OutboundEvent): Promise<IntegrationSetting[]> {
  return (await tx.find("integration_settings", { enabled: true })).filter(
    (i) => isWebhookProvider(i.provider) && integrationUrl(i) !== null && i.secret_ciphertext !== null && i.subscribed_events.includes(subscribedTo),
  );
}

/**
 * Sends the outbound events a committed domain event produces to every subscribed
 * integration. Each (integration, event id) pair is delivered once; retries and
 * redeliveries reuse the same event id.
 */
export async function dispatchDomainEvent(deps: WebhookDeps, event: DomainEvent): Promise<WebhookDelivery[]> {
  const mappings = outboundEventsFor(event);
  if (mappings.length === 0) return [];
  const orgId = event.organization_id;
  const out: WebhookDelivery[] = [];
  for (const mapping of mappings) {
    const eventId = outboundEventId(event.id, mapping.type);
    const { targets, snapshot } = await deps.db.read(orgId, async (tx) => {
      const integrations = await activeIntegrations(tx, mapping.type);
      if (integrations.length === 0) return { targets: [], snapshot: null };
      const already = new Set((await tx.find("webhook_deliveries", { event_id: eventId, reason: "event" })).map((d) => d.integration_id));
      return { targets: integrations.filter((i) => !already.has(i.id)), snapshot: await recordSnapshot(tx, mapping.type, mapping.recordId) };
    });
    for (const integration of targets) {
      const env: WebhookEnvelope = { event_id: eventId, type: mapping.type, occurred_at: event.occurred_at, organization_id: orgId, data: { ...mapping.data, record: snapshot } };
      out.push(await attemptDelivery(deps, integration, env, { attempt: 1, reason: "event", retry: true }));
    }
  }
  return out;
}

/** The Send webhook workflow step: delivers to integrations subscribed to workflow.webhook. */
export async function sendWorkflowWebhook(deps: WebhookDeps, input: { organization_id: string; event_id: string; event_type: string; data: Record<string, unknown> }) {
  const integrations = await deps.db.read(input.organization_id, (tx) => activeIntegrations(tx, "workflow.webhook"));
  let delivered = 0;
  const deliveries: string[] = [];
  for (const integration of integrations) {
    const env: WebhookEnvelope = { event_id: input.event_id, type: input.event_type, occurred_at: nowOf(deps).toISOString(), organization_id: input.organization_id, data: input.data };
    const d = await attemptDelivery(deps, integration, env, { attempt: 1, reason: "event", retry: true });
    deliveries.push(d.id);
    if (d.status === "success") delivered += 1;
  }
  return { delivered, attempted: integrations.length, deliveries };
}

/** A signed test event; its result sets the integration's Connected / Error status. */
export async function sendTestEvent(deps: WebhookDeps, integration: IntegrationSetting): Promise<WebhookDelivery> {
  const env: WebhookEnvelope = {
    event_id: `test_${randomUUID()}`,
    type: "nexora.test",
    occurred_at: nowOf(deps).toISOString(),
    organization_id: integration.organization_id,
    data: {
      message: "Test event from NEXORA. If you can read this, the endpoint and signature verification work.",
      integration: { id: integration.id, provider: integration.provider, name: integration.name },
      subscribed_events: integration.subscribed_events,
      sample: { type: "lead.created", record: { id: "00000000-0000-4000-8000-000000000000", title: "Sample lead (test event)", company_name: "Example Industrial GmbH", contact_name: "Sample Contact", source: "website", estimated_value: 25000, currency: "USD" } },
    },
  };
  return attemptDelivery(deps, integration, env, { attempt: 1, reason: "test", retry: false });
}

/** Sends a stored payload again with the same event_id, so receivers can deduplicate. */
export async function redeliver(deps: WebhookDeps, integration: IntegrationSetting, original: WebhookDelivery): Promise<WebhookDelivery> {
  const env = original.request_body as unknown as WebhookEnvelope;
  return attemptDelivery(deps, integration, env, { attempt: 1, reason: "redeliver", retry: false });
}

/** Runs failed attempts whose backoff has elapsed. Called by the scheduler. */
export async function processDueRetries(deps: WebhookDeps, orgId: string): Promise<number> {
  const nowIso = nowOf(deps).toISOString();
  const due = await deps.db.read(orgId, async (tx) => (await tx.find("webhook_deliveries", { status: "failed" })).filter((d) => d.next_retry_at && d.next_retry_at <= nowIso));
  let count = 0;
  for (const previous of due) {
    // Claim it first so a concurrent scheduler run does not send the same retry.
    const integration = await deps.db.write(orgId, async (tx) => {
      const fresh = await tx.get("webhook_deliveries", previous.id);
      if (!fresh?.next_retry_at) return null;
      await tx.update("webhook_deliveries", previous.id, { next_retry_at: null });
      return tx.get("integration_settings", previous.integration_id);
    });
    if (!integration || !integration.enabled) continue;
    await attemptDelivery(deps, integration, previous.request_body as unknown as WebhookEnvelope, { attempt: previous.attempt + 1, reason: "retry", retry: true });
    count += 1;
  }
  return count;
}

export function webhookDepsFrom(db: Db, meta: RequestMeta, now?: () => Date): WebhookDeps {
  return { db, meta, now };
}
