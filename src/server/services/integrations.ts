/**
 * Integrations settings: Make, n8n and a generic webhook endpoint (outbound webhooks), plus
 * the email provider (env-configured). Status is honest: an integration is "connected" only
 * after a real signed test event got a 2xx response.
 *
 * Admins manage integrations; managers can view them (permission matrix). Every change is
 * written to audit_logs (record.* events) and raises integration.changed.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AutomationWorkflow, IntegrationSetting, WebhookDelivery } from "@/domain/entities";
import { STEP_LABELS } from "@/domain/automation/schema";
import { validateDefinition } from "@/domain/automation/logic";
import { checkOutboundUrl } from "@/domain/integrations/ssrf";
import { PROVIDER_NAMES, STATUS_LABELS, type IntegrationStatus } from "@/domain/integrations/status";
import { OUTBOUND_EVENTS, type OutboundEvent } from "@/domain/integrations/webhooks";
import { DomainError } from "@/server/repositories/types";
import { encryptSecret, newSigningSecret, secretHash } from "@/server/integrations/secret-box";
import { transportOptionsFromEnv } from "@/server/integrations/transport";
import { integrationUrl, redeliver, sendTestEvent, WEBHOOK_PROVIDERS, type WebhookDeps, type WebhookProvider } from "@/server/integrations/webhooks";
import { emit, emitSecurity, NotFoundError, nowOf, requireCan, type ServiceContext } from "./context";

export { STATUS_LABELS, PROVIDER_NAMES, type IntegrationStatus };

export function statusOf(i: Pick<IntegrationSetting, "config" | "secret_ciphertext" | "last_tested_at" | "last_test_ok"> | null): IntegrationStatus {
  if (!i || !integrationUrl(i) || !i.secret_ciphertext) return "not_configured";
  if (!i.last_tested_at || i.last_test_ok === null) return "configured";
  return i.last_test_ok ? "connected" : "error";
}

/** The fields the browser may see. Secret hash and ciphertext never leave the server. */
export type IntegrationView = {
  id: string | null;
  provider: WebhookProvider;
  name: string;
  url: string | null;
  auth_mode: "signature" | "header_token";
  subscribed_events: OutboundEvent[];
  enabled: boolean;
  secret_preview: string | null;
  status: IntegrationStatus;
  last_tested_at: string | null;
  last_error: string | null;
  updated_at: string | null;
};

function toView(provider: WebhookProvider, i: IntegrationSetting | null): IntegrationView {
  return {
    id: i?.id ?? null,
    provider,
    name: i?.name ?? PROVIDER_NAMES[provider],
    url: i ? integrationUrl(i) : null,
    auth_mode: i?.config.auth_mode === "header_token" ? "header_token" : "signature",
    subscribed_events: (i?.subscribed_events ?? []).filter((e): e is OutboundEvent => (OUTBOUND_EVENTS as readonly string[]).includes(e)),
    enabled: i?.enabled ?? false,
    secret_preview: i?.secret_preview ?? null,
    status: statusOf(i),
    last_tested_at: i?.last_tested_at ?? null,
    last_error: i?.last_error ?? null,
    updated_at: i?.updated_at ?? null,
  };
}

export type EmailStatus = { status: IntegrationStatus; provider: "resend" | null; from: string | null; last_tested_at: string | null; last_error: string | null };

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.NEXORA_EMAIL_FROM);
}

function emailStatus(row: IntegrationSetting | null): EmailStatus {
  const configured = emailConfigured();
  const status: IntegrationStatus = !configured ? "not_configured" : !row?.last_tested_at || row.last_test_ok === null ? "configured" : row.last_test_ok ? "connected" : "error";
  return { status, provider: configured ? "resend" : null, from: configured ? (process.env.NEXORA_EMAIL_FROM ?? null) : null, last_tested_at: row?.last_tested_at ?? null, last_error: row?.last_error ?? null };
}

// ---------------------------------------------------------------------------
// "Which engine runs what": overlap between internal workflows and external routing
// ---------------------------------------------------------------------------

export type EngineOverlap = { event: OutboundEvent; workflow_id: string; workflow_name: string; actions: string[] };

function triggerCovers(event: OutboundEvent, w: AutomationWorkflow): string[] | null {
  const parsed = validateDefinition(w.definition);
  if (!parsed.ok) return null;
  const t = parsed.definition.trigger;
  const same =
    (event === "lead.created" && t.type === "record.created" && t.entity === "lead") ||
    (event === "order.created" && t.type === "record.created" && t.entity === "order") ||
    (event === "deal.won" && t.type === "deal.stage_changed" && (t.to === "won" || t.to === "any")) ||
    (event === "deal.stage_changed" && t.type === "deal.stage_changed") ||
    (event === "task.overdue" && t.type === "date.reached");
  if (!same) return null;
  return parsed.definition.steps.filter((s) => s.type !== "condition" && s.type !== "delay").map((s) => STEP_LABELS[s.type]);
}

/** Enabled internal workflows that react to an event an integration also receives. */
export function engineOverlaps(subscribed: readonly OutboundEvent[], workflows: AutomationWorkflow[]): EngineOverlap[] {
  const out: EngineOverlap[] = [];
  for (const event of subscribed) {
    for (const w of workflows) {
      if (!w.enabled || w.archived_at) continue;
      const actions = triggerCovers(event, w);
      if (actions) out.push({ event, workflow_id: w.id, workflow_name: w.name, actions });
    }
  }
  return out;
}


// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listIntegrations(ctx: ServiceContext) {
  requireCan(ctx, "view", "integration");
  return ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const [rows, deliveries, workflows] = await Promise.all([tx.find("integration_settings"), tx.find("webhook_deliveries"), tx.find("automation_workflows", { archived_at: null })]);
    const since = new Date(nowOf(ctx).getTime() - 24 * 3600_000).toISOString();
    const webhooks = WEBHOOK_PROVIDERS.map((provider) => {
      const row = rows.find((r) => r.provider === provider) ?? null;
      const recent = row ? deliveries.filter((d) => d.integration_id === row.id && d.created_at >= since) : [];
      const view = toView(provider, row);
      return {
        ...view,
        recent: { success: recent.filter((d) => d.status === "success").length, failed: recent.filter((d) => d.status === "failed").length },
        overlaps: view.enabled ? engineOverlaps(view.subscribed_events, workflows) : [],
      };
    });
    return { webhooks, email: emailStatus(rows.find((r) => r.provider === "email") ?? null), workflows: workflows.filter((w) => w.enabled).map((w) => ({ id: w.id, name: w.name, trigger_type: w.trigger_type })) };
  });
}

export type DeliveryFilters = { status?: WebhookDelivery["status"]; event_type?: string };

export async function getIntegration(ctx: ServiceContext, provider: WebhookProvider, filters: DeliveryFilters = {}) {
  requireCan(ctx, "view", "integration");
  return ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const row = (await tx.find("integration_settings", { provider }))[0] ?? null;
    const workflows = await tx.find("automation_workflows", { archived_at: null });
    const deliveries = row
      ? (await tx.find("webhook_deliveries", { integration_id: row.id }))
          .filter((d) => (!filters.status || d.status === filters.status) && (!filters.event_type || d.event_type === filters.event_type))
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .slice(0, 100)
      : [];
    const view = toView(provider, row);
    return { integration: view, deliveries, overlaps: engineOverlaps(view.subscribed_events, workflows), eventTypes: [...new Set(deliveries.map((d) => d.event_type))].sort() };
  });
}

// ---------------------------------------------------------------------------
// Writes (admin)
// ---------------------------------------------------------------------------

export const integrationInput = z
  .object({
    provider: z.enum(WEBHOOK_PROVIDERS),
    url: z.string().trim().max(2000),
    auth_mode: z.enum(["signature", "header_token"]).default("signature"),
    subscribed_events: z.array(z.enum(OUTBOUND_EVENTS)).max(OUTBOUND_EVENTS.length),
    enabled: z.boolean(),
  })
  .strict();

/** Validates an endpoint URL. Private, loopback and metadata addresses raise security.ssrf_blocked. */
function checkUrl(ctx: ServiceContext, url: string, provider: string): string {
  const options = transportOptionsFromEnv();
  const check = checkOutboundUrl(url, options);
  if (!check.ok) {
    let host = "invalid-url";
    try {
      host = new URL(url).hostname;
    } catch {}
    if (host !== "invalid-url") emitSecurity(ctx, { type: "security.ssrf_blocked", payload: { target: { type: "integration", id: null }, provider, host, reason: check.reason, stage: "configuration" } });
    throw new DomainError(check.reason);
  }
  return check.url.toString();
}

/** Creates or updates an integration. Returns the signing secret only when it was just created. */
export async function saveIntegration(ctx: ServiceContext, input: z.output<typeof integrationInput>): Promise<{ integration: IntegrationView; secret: string | null }> {
  requireCan(ctx, "manage", "integration");
  const url = checkUrl(ctx, input.url, input.provider);
  const subscribed = [...new Set(input.subscribed_events)];
  if (input.enabled && subscribed.length === 0) throw new DomainError("Choose at least one event to send, or leave the integration disabled.");
  const newSecret = newSigningSecret();
  const ciphertext = await encryptSecret(newSecret);
  return ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const at = nowOf(ctx).toISOString();
    const current = (await tx.find("integration_settings", { provider: input.provider }))[0] ?? null;
    const config = { url, auth_mode: input.auth_mode };
    if (!current) {
      const row: IntegrationSetting = {
        id: randomUUID(),
        organization_id: ctx.actor.organization_id,
        provider: input.provider,
        name: PROVIDER_NAMES[input.provider],
        config,
        secret_hash: secretHash(newSecret),
        secret_ciphertext: ciphertext,
        secret_preview: newSecret.slice(-4),
        subscribed_events: subscribed,
        enabled: input.enabled,
        last_tested_at: null,
        last_test_ok: null,
        last_error: null,
        created_at: at,
        updated_at: at,
      };
      await tx.insert("integration_settings", row);
      await emit(
        tx,
        ctx,
        { type: "record.created", payload: { entity: "integration", id: row.id, after: { provider: row.provider, url, auth_mode: input.auth_mode, subscribed_events: subscribed, enabled: row.enabled } } },
        { type: "integration.changed", payload: { target: { type: "integration", id: row.id }, provider: row.provider, change: "created", domain: new URL(url).hostname, subscribed_events: subscribed, enabled: row.enabled } },
      );
      return { integration: toView(input.provider, row), secret: newSecret };
    }
    const before = { url: integrationUrl(current), auth_mode: current.config.auth_mode ?? "signature", subscribed_events: current.subscribed_events, enabled: current.enabled };
    const after = { url, auth_mode: input.auth_mode, subscribed_events: subscribed, enabled: input.enabled };
    const changes: Record<string, { before: unknown; after: unknown }> = {};
    for (const key of Object.keys(after) as Array<keyof typeof after>) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changes[key] = { before: before[key], after: after[key] };
    }
    if (Object.keys(changes).length === 0) return { integration: toView(input.provider, current), secret: null };
    // A new URL needs a new test before it counts as connected.
    const urlChanged = "url" in changes;
    const updated = await tx.update("integration_settings", current.id, {
      config: { ...current.config, ...config },
      subscribed_events: subscribed,
      enabled: input.enabled,
      ...(urlChanged ? { last_tested_at: null, last_test_ok: null, last_error: null } : {}),
      updated_at: at,
    });
    await emit(
      tx,
      ctx,
      { type: "record.updated", payload: { entity: "integration", id: current.id, changes } },
      { type: "integration.changed", payload: { target: { type: "integration", id: current.id }, provider: current.provider, change: "updated", fields: Object.keys(changes), domain: new URL(url).hostname, enabled: input.enabled } },
    );
    return { integration: toView(input.provider, updated), secret: null };
  });
}

/** Issues a new signing secret; the old one stops working immediately. Returned once. */
export async function rotateSecret(ctx: ServiceContext, provider: WebhookProvider): Promise<string> {
  requireCan(ctx, "manage", "integration");
  const secret = newSigningSecret();
  const ciphertext = await encryptSecret(secret);
  await ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const current = (await tx.find("integration_settings", { provider }))[0];
    if (!current) throw new NotFoundError("Integration");
    await tx.update("integration_settings", current.id, { secret_hash: secretHash(secret), secret_ciphertext: ciphertext, secret_preview: secret.slice(-4), last_tested_at: null, last_test_ok: null, last_error: null, updated_at: nowOf(ctx).toISOString() });
    await emit(
      tx,
      ctx,
      { type: "record.updated", payload: { entity: "integration", id: current.id, changes: { secret: { before: "[redacted]", after: "[rotated]" } } } },
      { type: "integration.changed", payload: { target: { type: "integration", id: current.id }, provider, change: "secret_rotated" } },
    );
  });
  return secret;
}

/** Removes the endpoint and secret; the delivery log is kept. */
export async function disconnectIntegration(ctx: ServiceContext, provider: WebhookProvider): Promise<void> {
  requireCan(ctx, "manage", "integration");
  await ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const current = (await tx.find("integration_settings", { provider }))[0];
    if (!current) throw new NotFoundError("Integration");
    await tx.update("integration_settings", current.id, {
      config: {},
      secret_hash: null,
      secret_ciphertext: null,
      secret_preview: null,
      enabled: false,
      last_tested_at: null,
      last_test_ok: null,
      last_error: null,
      updated_at: nowOf(ctx).toISOString(),
    });
    await emit(
      tx,
      ctx,
      { type: "record.updated", payload: { entity: "integration", id: current.id, changes: { url: { before: integrationUrl(current), after: null }, enabled: { before: current.enabled, after: false } } } },
      { type: "integration.changed", payload: { target: { type: "integration", id: current.id }, provider, change: "disconnected" } },
    );
  });
}

async function loadRow(ctx: ServiceContext, provider: WebhookProvider): Promise<IntegrationSetting> {
  const row = await ctx.db.read(ctx.actor.organization_id, async (tx) => (await tx.find("integration_settings", { provider }))[0] ?? null);
  if (!row || !integrationUrl(row) || !row.secret_ciphertext) throw new DomainError("Save a webhook URL first.");
  return row;
}

export async function testIntegration(ctx: ServiceContext, deps: WebhookDeps, provider: WebhookProvider): Promise<WebhookDelivery> {
  requireCan(ctx, "manage", "integration");
  return sendTestEvent(deps, await loadRow(ctx, provider));
}

export async function redeliverDelivery(ctx: ServiceContext, deps: WebhookDeps, deliveryId: string): Promise<WebhookDelivery> {
  requireCan(ctx, "manage", "integration");
  const { delivery, integration } = await ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const delivery = await tx.get("webhook_deliveries", deliveryId);
    return { delivery, integration: delivery ? await tx.get("integration_settings", delivery.integration_id) : null };
  });
  if (!delivery || !integration) throw new NotFoundError("Delivery");
  if (!integrationUrl(integration) || !integration.secret_ciphertext) throw new DomainError("This integration has no endpoint configured.");
  return redeliver(deps, integration, delivery);
}

/** Sends a real test email through the configured provider and records the result. */
export async function testEmail(ctx: ServiceContext, send: (message: { to: string; subject: string; text: string }) => Promise<{ id: string }>, to: string): Promise<{ ok: boolean; error: string | null }> {
  requireCan(ctx, "manage", "integration");
  if (!emailConfigured()) throw new DomainError("Set RESEND_API_KEY and NEXORA_EMAIL_FROM to enable email.");
  let ok = true;
  let error: string | null = null;
  try {
    await send({ to, subject: "NEXORA test email", text: "This is a test email from NEXORA. Email steps in Automation Studio will be delivered through this provider." });
  } catch (e) {
    ok = false;
    error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
  }
  await ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const at = nowOf(ctx).toISOString();
    const current = (await tx.find("integration_settings", { provider: "email" }))[0];
    if (current) await tx.update("integration_settings", current.id, { last_tested_at: at, last_test_ok: ok, last_error: error, updated_at: at });
    else
      await tx.insert("integration_settings", {
        id: randomUUID(),
        organization_id: ctx.actor.organization_id,
        provider: "email",
        name: PROVIDER_NAMES.email,
        config: { provider: "resend" },
        secret_hash: null,
        secret_ciphertext: null,
        secret_preview: null,
        subscribed_events: [],
        enabled: true,
        last_tested_at: at,
        last_test_ok: ok,
        last_error: error,
        created_at: at,
        updated_at: at,
      });
  });
  return { ok, error };
}

/** Sends a real test message to the configured Telegram chat. Admins only; nothing is stored. */
export async function testTelegram(ctx: ServiceContext, send: ((text: string) => Promise<{ message_id: number }>) | null): Promise<{ ok: boolean; error: string | null }> {
  requireCan(ctx, "manage", "integration");
  if (!send) throw new DomainError("Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID on the server to enable Telegram.");
  try {
    await send(`NEXORA test message. "Send to Telegram" workflow steps will post to this chat. Sent by ${ctx.actor.role} at ${nowOf(ctx).toISOString()}.`);
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 300) };
  }
}
