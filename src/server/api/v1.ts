import "server-only";
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { Company, Contact, Deal, Lead, Order } from "@/domain/entities";
import { endpoint, type disableUserRequest, type externalEvent, type leadSubmission, type listQuery, type revokeKeyRequest, type securityEventsQuery, type testEventInput } from "@/domain/api/contract";
import { leadInput } from "@/domain/inputs";
import { verifySignature, SIGNATURE_HEADER } from "@/domain/integrations/webhooks";
import type { ListQuery } from "@/domain/list";
import { validateDefinition } from "@/domain/automation/logic";
import { decryptSecret } from "@/server/integrations/secret-box";
import { isWebhookProvider } from "@/server/integrations/webhooks";
import { respondDisableUser, respondRevokeApiKey } from "@/server/services/api-keys";
import { listCompanies } from "@/server/services/companies";
import { listContacts } from "@/server/services/contacts";
import { emit, emitSecurity, findVisible, NotFoundError, requireCan } from "@/server/services/context";
import { listDeals } from "@/server/services/deals";
import { createLead } from "@/server/services/leads";
import { listOrders } from "@/server/services/orders";
import { ApiError, apiRoute } from "./handler";

/** Route handlers for /api/v1. Each one is wired to its contract entry. */

const toListQuery = (q: z.output<typeof listQuery>): ListQuery => ({ q: q.q, page: q.page, size: q.per_page, sort: undefined, dir: "asc", archived: "0" });
const pageMeta = (p: { total: number; page: number; size: number; pageCount: number }) => ({ page: p.page, per_page: p.size, total: p.total, page_count: p.pageCount });

const leadView = (l: Lead) => ({ id: l.id, title: l.title, company_name: l.company_name, contact_name: l.contact_name, email: l.email, country: l.country, source: l.source, status: l.status, estimated_value: l.estimated_value, currency: l.currency, owner_id: l.owner_id, created_at: l.created_at });

export const health = apiRoute(endpoint("GET", "/health"), async () => ({ body: { data: { status: "ok", version: "1", time: new Date().toISOString() } } }));

export const submitLead = apiRoute(endpoint("POST", "/leads"), async ({ ctx, body }) => {
  const b = body as z.output<typeof leadSubmission>;
  // Same validation as the in-app form. Unassigned, so the New lead automation assigns an owner.
  const input = leadInput.parse({
    title: b.title,
    company_name: b.company_name,
    contact_name: b.contact_name,
    email: b.email ?? "",
    phone: b.phone ?? "",
    country: b.country ?? "",
    source: b.source,
    status: "new",
    qualification: "cold",
    next_action: b.message ?? "",
    next_action_at: "",
    estimated_value: b.estimated_value,
    owner_id: null,
  });
  const lead = await createLead(ctx, input);
  return { body: { data: leadView(lead) } };
});

export const listCompaniesRoute = apiRoute(endpoint("GET", "/companies"), async ({ ctx, query }) => {
  const page = await listCompanies(ctx, toListQuery(query as z.output<typeof listQuery>), {});
  const rows = page.rows as Array<Company & { open_deals: number; contacts: number }>;
  return {
    body: {
      data: rows.map((c) => ({ id: c.id, name: c.name, industry: c.industry, country: c.country, city: c.city, website: c.website, lifecycle_stage: c.lifecycle_stage, owner_id: c.owner_id, open_deals: c.open_deals, contacts: c.contacts, created_at: c.created_at })),
      meta: pageMeta(page),
    },
  };
});

export const listContactsRoute = apiRoute(endpoint("GET", "/contacts"), async ({ ctx, query }) => {
  const page = await listContacts(ctx, toListQuery(query as z.output<typeof listQuery>), {});
  const rows = page.rows as Contact[];
  return {
    body: {
      data: rows.map((c) => ({ id: c.id, first_name: c.first_name, last_name: c.last_name, email: c.email, phone: c.phone, job_title: c.job_title, company_id: c.company_id, owner_id: c.owner_id, created_at: c.created_at })),
      meta: pageMeta(page),
    },
  };
});

export const listDealsRoute = apiRoute(endpoint("GET", "/deals"), async ({ ctx, query }) => {
  const page = await listDeals(ctx, toListQuery(query as z.output<typeof listQuery>), {});
  const stageName = new Map(page.stages.map((s) => [s.id, s.name]));
  const rows = page.rows as Deal[];
  return {
    body: {
      data: rows.map((d) => ({ id: d.id, name: d.name, company_id: d.company_id, amount: d.amount, currency: d.currency, stage_id: d.stage_id, stage: stageName.get(d.stage_id) ?? null, probability: d.probability, expected_close_date: d.expected_close_date, owner_id: d.owner_id, closed_at: d.closed_at, created_at: d.created_at })),
      meta: pageMeta(page),
    },
  };
});

export const listOrdersRoute = apiRoute(endpoint("GET", "/orders"), async ({ ctx, query }) => {
  const page = await listOrders(ctx, toListQuery(query as z.output<typeof listQuery>), {});
  const rows = page.rows as Order[];
  return {
    body: {
      data: rows.map((o) => ({ id: o.id, order_number: o.order_number, company_id: o.company_id, status: o.status, payment_status: o.payment_status, total: o.total, currency: o.currency, order_date: o.order_date, source_deal_id: o.source_deal_id, owner_id: o.owner_id, created_at: o.created_at })),
      meta: pageMeta(page),
    },
  };
});

const OWNER_COLUMN = { lead: "owner_id", deal: "owner_id", company: "owner_id", order: "owner_id", task: "assignee_id" } as const;
const TABLE = { lead: "leads", deal: "deals", company: "companies", order: "orders", task: "tasks" } as const;

export const receiveEvent = apiRoute(endpoint("POST", "/events"), async ({ ctx, key, body, rawBody, request }) => {
  const b = body as z.output<typeof externalEvent>;
  if (JSON.stringify(b.data).length > 16 * 1024) throw new ApiError(400, "validation_failed", "data must be at most 16 KB.", [{ path: "data", message: "Too large" }]);
  const orgId = key.organization_id;

  // Optional proof that the caller holds an integration's signing secret (Make/n8n callbacks).
  const integrationHeader = request.headers.get("x-nexora-integration");
  if (integrationHeader !== null) {
    const integration = isWebhookProvider(integrationHeader) ? (await ctx.db.read(orgId, (tx) => tx.find("integration_settings", { provider: integrationHeader })))[0] : undefined;
    const secret = integration?.secret_ciphertext ? await decryptSecret(integration.secret_ciphertext) : null;
    const check = secret ? verifySignature(secret, request.headers.get(SIGNATURE_HEADER.toLowerCase()), rawBody) : { ok: false as const, reason: "mismatch" as const };
    if (!check.ok) {
      emitSecurity(ctx, { type: "webhook.signature_invalid", payload: { target: { type: "integration", id: integration?.id ?? null }, provider: integrationHeader.slice(0, 32), reason: secret ? check.reason : "unknown_integration", event_type: b.event_type } });
      throw new ApiError(401, "signature_invalid", "The X-Nexora-Signature header does not match this integration's signing secret.");
    }
  }

  const eventId = randomUUID();
  const workflowsMatched = await ctx.db.write(orgId, async (tx) => {
    if (b.entity && b.record_id) {
      const entity = b.entity;
      const visible = await findVisible(tx, ctx, TABLE[entity], entity, (r) => (r as unknown as Record<string, string | null>)[OWNER_COLUMN[entity]] ?? null, { id: b.record_id } as never);
      if (visible.length === 0) throw new NotFoundError("Record");
    }
    await emit(tx, ctx, { type: "webhook.received", payload: { event_type: b.event_type, data: { ...b.data, ...(b.entity ? { entity: b.entity, id: b.record_id } : {}), external_event_id: eventId } } });
    const workflows = await tx.find("automation_workflows", { enabled: true, archived_at: null });
    return workflows.filter((w) => {
      const parsed = validateDefinition(w.definition);
      return parsed.ok && parsed.definition.trigger.type === "webhook.received" && parsed.definition.trigger.event_type === b.event_type;
    }).length;
  });
  return { body: { data: { event_id: eventId, event_type: b.event_type, accepted: true, workflows_matched: workflowsMatched } } };
});

export const testEvent = apiRoute(endpoint("POST", "/test-event"), async ({ key, body }) => {
  const b = body as z.output<typeof testEventInput>;
  return { body: { data: { received: true, organization_id: key.organization_id, api_key: { id: key.id, name: key.name, scopes: key.scopes }, echo: b } } };
});

export const securityEvents = apiRoute(endpoint("GET", "/security-events"), async ({ ctx, query }) => {
  requireCan(ctx, "view", "audit_log");
  const q = query as z.output<typeof securityEventsQuery>;
  const after = q.after ?? q.after_sequence;
  // The cursor runs in the database: the log can grow far beyond what one read returns.
  const { rows, lastSequence } = await ctx.db.read(ctx.actor.organization_id, (tx) => tx.securityEventsAfter(after, q.limit));
  const next = rows.length ? rows[rows.length - 1]!.sequence : after;
  return {
    body: {
      data: rows,
      meta: { next_after_sequence: next, has_more: next < lastSequence, last_sequence: lastSequence },
    },
  };
});

export const revokeApiKeyAction = apiRoute(endpoint("POST", "/security-actions/revoke-api-key"), async ({ ctx, key, body }) => {
  requireCan(ctx, "manage", "api_key");
  const revoked = await respondRevokeApiKey(ctx, body as z.output<typeof revokeKeyRequest>, key.id);
  return { body: { data: { id: revoked.id, revoked_at: revoked.revoked_at } } };
});

export const disableUserAction = apiRoute(endpoint("POST", "/security-actions/disable-user"), async ({ ctx, body }) => {
  requireCan(ctx, "manage", "team");
  const result = await respondDisableUser(ctx, body as z.output<typeof disableUserRequest>);
  return { body: { data: result } };
});
