/**
 * Public API contract (/api/v1): request and response schemas plus the endpoint registry.
 * Route handlers validate with these schemas and the OpenAPI document is generated from
 * them (src/domain/api/openapi.ts), so the two cannot drift apart.
 */
import { z } from "zod";
import { LEAD_SOURCES } from "../entities";
import { SECURITY_ACTION_NAMES } from "../security/events";
import type { ApiScope } from "./keys";

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

export const API_ERROR_CODES = [
  "unauthorized",
  "insufficient_scope",
  "forbidden",
  "validation_failed",
  "invalid_json",
  "payload_too_large",
  "not_found",
  "conflict",
  "idempotency_key_reused",
  "idempotency_in_progress",
  "rate_limited",
  "signature_invalid",
  "internal_error",
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const errorEnvelope = z
  .object({
    error: z.object({
      code: z.enum(API_ERROR_CODES),
      message: z.string(),
      details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
      request_id: z.string(),
    }),
  })
  .meta({ id: "Error" });

export const pageMeta = z
  .object({ page: z.number().int(), per_page: z.number().int(), total: z.number().int(), page_count: z.number().int() })
  .meta({ id: "PageMeta" });

export const listQuery = z
  .object({
    page: z.coerce.number().int().min(1).max(10_000).default(1).describe("Page number, starting at 1."),
    per_page: z.coerce.number().int().min(5).max(100).default(25).describe("Items per page (5–100)."),
    q: z.string().trim().max(100).default("").describe("Free-text search."),
  })
  .strict();

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const leadSubmission = z
  .object({
    title: z.string().trim().min(1).max(160).describe("What the lead is about, e.g. the product or project."),
    company_name: z.string().trim().min(1).max(160),
    contact_name: z.string().trim().min(1).max(160),
    email: z.email().max(254).optional(),
    phone: z.string().trim().max(40).optional(),
    country: z.string().regex(/^[A-Z]{2}$/).optional().describe("ISO 3166-1 alpha-2, used by owner assignment."),
    source: z.enum(LEAD_SOURCES).default("api"),
    estimated_value: z.number().min(0).max(1_000_000_000).default(0),
    message: z.string().trim().max(2000).optional().describe("Free text from the form; stored as the next action note."),
  })
  .strict()
  .meta({ id: "LeadSubmission" });

export const externalEvent = z
  .object({
    event_type: z.string().regex(/^[a-z0-9_.-]{1,64}$/).describe("Matched against webhook.received workflow triggers."),
    entity: z.enum(["lead", "deal", "task", "company", "order"]).optional().describe("Record type the event is about."),
    record_id: z.uuid().optional().describe("Id of that record; required for workflows that act on a record."),
    data: z.record(z.string(), z.unknown()).default({}).describe("Extra data, stored with the run (max 16 KB)."),
  })
  .strict()
  .refine((e) => (e.entity === undefined) === (e.record_id === undefined), { message: "entity and record_id go together", path: ["record_id"] })
  .meta({ id: "ExternalEvent" });

export const testEventInput = z.object({ message: z.string().max(500).optional() }).strict().meta({ id: "TestEvent" });

export const securityEventsQuery = z
  .object({
    after_sequence: z.coerce.number().int().min(0).default(0).describe("Return events with a sequence number greater than this."),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .strict();

export const revokeKeyRequest = z.object({ api_key_id: z.uuid(), reason: z.string().trim().min(3).max(500) }).strict().meta({ id: "RevokeApiKeyRequest" });
export const disableUserRequest = z.object({ user_id: z.uuid(), reason: z.string().trim().min(3).max(500) }).strict().meta({ id: "DisableUserRequest" });

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

const money = z.number();
const iso = z.string().describe("ISO 8601 timestamp");

export const leadResource = z
  .object({ id: z.uuid(), title: z.string(), company_name: z.string(), contact_name: z.string(), email: z.string().nullable(), country: z.string().nullable(), source: z.string(), status: z.string(), estimated_value: money, currency: z.string(), owner_id: z.uuid().nullable(), created_at: iso })
  .meta({ id: "Lead" });
export const companyResource = z
  .object({ id: z.uuid(), name: z.string(), industry: z.string(), country: z.string(), city: z.string(), website: z.string().nullable(), lifecycle_stage: z.string(), owner_id: z.uuid().nullable(), open_deals: z.number().int(), contacts: z.number().int(), created_at: iso })
  .meta({ id: "Company" });
export const contactResource = z
  .object({ id: z.uuid(), first_name: z.string(), last_name: z.string(), email: z.string().nullable(), phone: z.string().nullable(), job_title: z.string(), company_id: z.uuid().nullable(), owner_id: z.uuid().nullable(), created_at: iso })
  .meta({ id: "Contact" });
export const dealResource = z
  .object({ id: z.uuid(), name: z.string(), company_id: z.uuid(), amount: money, currency: z.string(), stage_id: z.uuid(), stage: z.string().nullable(), probability: z.number(), expected_close_date: z.string().nullable(), owner_id: z.uuid().nullable(), closed_at: z.string().nullable(), created_at: iso })
  .meta({ id: "Deal" });
export const orderResource = z
  .object({ id: z.uuid(), order_number: z.string(), company_id: z.uuid(), status: z.string(), payment_status: z.string(), total: money, currency: z.string(), order_date: z.string(), source_deal_id: z.uuid().nullable(), owner_id: z.uuid().nullable(), created_at: iso })
  .meta({ id: "Order" });

export const securityEventResource = z
  .object({
    event_id: z.uuid(),
    organization_id: z.uuid(),
    sequence: z.number().int(),
    occurred_at: iso,
    category: z.string(),
    action: z.enum(SECURITY_ACTION_NAMES as [string, ...string[]]),
    outcome: z.enum(["success", "failure", "unknown"]),
    severity: z.enum(["info", "low", "medium", "high"]),
    actor: z.record(z.string(), z.unknown()),
    source: z.object({ ip: z.string().nullable(), user_agent: z.string().nullable(), request_id: z.string().nullable() }),
    target: z.object({ type: z.string().nullable(), id: z.string().nullable() }),
    metadata: z.record(z.string(), z.unknown()),
    prev_hash: z.string(),
    hash: z.string(),
  })
  .meta({ id: "SecurityEvent", description: "See docs/security-events.md for the hash chain." });

const data = <T extends z.ZodType>(schema: T) => z.object({ data: schema });
const page = <T extends z.ZodType>(schema: T) => z.object({ data: z.array(schema), meta: pageMeta });

export const responses = {
  health: data(z.object({ status: z.literal("ok"), version: z.string(), time: iso })),
  lead: data(leadResource),
  companies: page(companyResource),
  contacts: page(contactResource),
  deals: page(dealResource),
  orders: page(orderResource),
  event: data(z.object({ event_id: z.string(), event_type: z.string(), accepted: z.literal(true), workflows_matched: z.number().int() })),
  testEvent: data(z.object({ received: z.literal(true), organization_id: z.uuid(), api_key: z.object({ id: z.uuid(), name: z.string(), scopes: z.array(z.string()) }), echo: z.record(z.string(), z.unknown()) })),
  securityEvents: z.object({ data: z.array(securityEventResource), meta: z.object({ next_after_sequence: z.number().int(), has_more: z.boolean(), last_sequence: z.number().int() }) }),
  revokedKey: data(z.object({ id: z.uuid(), revoked_at: z.string().nullable() })),
  disabledUser: data(z.object({ id: z.uuid(), is_active: z.literal(false), changed: z.boolean() })),
};

// ---------------------------------------------------------------------------
// Endpoint registry
// ---------------------------------------------------------------------------

export type Endpoint = {
  method: "GET" | "POST";
  path: string;
  summary: string;
  description: string;
  tag: "System" | "Leads" | "Records" | "Events" | "Security";
  scope: ApiScope | null;
  query?: z.ZodObject;
  body?: z.ZodType;
  response: z.ZodType;
  status: number;
  idempotent?: boolean;
  example?: { request?: unknown; response: unknown };
};

const exampleLead = {
  id: "7d0c6a51-3c5e-4b8c-9a55-0c2c6d1e9a01",
  title: "Conveyor retrofit, line 3",
  company_name: "Example Logistics GmbH",
  contact_name: "Alex Example",
  email: "alex@example.com",
  country: "DE",
  source: "api",
  status: "new",
  estimated_value: 48000,
  currency: "USD",
  owner_id: null,
  created_at: "2026-10-22T09:30:00.000Z",
};

export const ENDPOINTS: Endpoint[] = [
  {
    method: "GET",
    path: "/health",
    summary: "Health check",
    description: "Returns 200 when the API is up. No authentication.",
    tag: "System",
    scope: null,
    response: responses.health,
    status: 200,
    example: { response: { data: { status: "ok", version: "1", time: "2026-10-22T09:30:00.000Z" } } },
  },
  {
    method: "POST",
    path: "/leads",
    summary: "Submit a lead",
    description: "Creates a lead (source api by default) and runs the New lead automations, which assign an owner and create the follow-up task. Supports Idempotency-Key.",
    tag: "Leads",
    scope: "leads:write",
    body: leadSubmission,
    response: responses.lead,
    status: 201,
    idempotent: true,
    example: {
      request: { title: "Conveyor retrofit, line 3", company_name: "Example Logistics GmbH", contact_name: "Alex Example", email: "alex@example.com", country: "DE", estimated_value: 48000, message: "Please call back this week." },
      response: { data: exampleLead },
    },
  },
  {
    method: "GET",
    path: "/companies",
    summary: "List companies",
    description: "Paginated, limited to what the key owner may see.",
    tag: "Records",
    scope: "records:read",
    query: listQuery,
    response: responses.companies,
    status: 200,
  },
  { method: "GET", path: "/contacts", summary: "List contacts", description: "Paginated, limited to what the key owner may see.", tag: "Records", scope: "records:read", query: listQuery, response: responses.contacts, status: 200 },
  { method: "GET", path: "/deals", summary: "List deals", description: "Paginated, limited to what the key owner may see.", tag: "Records", scope: "records:read", query: listQuery, response: responses.deals, status: 200 },
  { method: "GET", path: "/orders", summary: "List orders", description: "Paginated, limited to what the key owner may see.", tag: "Records", scope: "records:read", query: listQuery, response: responses.orders, status: 200 },
  {
    method: "POST",
    path: "/events",
    summary: "Send an external workflow event",
    description:
      "Raises webhook.received, which runs workflows whose trigger has the same event_type. Optional X-Nexora-Signature and X-Nexora-Integration headers let a Make or n8n callback prove it holds that integration's signing secret. Supports Idempotency-Key.",
    tag: "Events",
    scope: "events:write",
    body: externalEvent,
    response: responses.event,
    status: 202,
    idempotent: true,
    example: {
      request: { event_type: "make.activity_logged", entity: "lead", record_id: exampleLead.id, data: { channel: "slack", note: "Sales notified in #leads" } },
      response: { data: { event_id: "3f6e2b8a-6a0e-4f53-9c51-2b7a4f0e8d11", event_type: "make.activity_logged", accepted: true, workflows_matched: 1 } },
    },
  },
  {
    method: "POST",
    path: "/test-event",
    summary: "Check a key",
    description: "Validates the key and echoes the body. Nothing is stored. Use it to test a Make or n8n connection.",
    tag: "Events",
    scope: "events:write",
    body: testEventInput,
    response: responses.testEvent,
    status: 200,
  },
  {
    method: "GET",
    path: "/security-events",
    summary: "Read the security log",
    description: "Cursor pagination by sequence number. Events include prev_hash and hash so the reader can verify the chain. SIEM keys only.",
    tag: "Security",
    scope: "security:read",
    query: securityEventsQuery,
    response: responses.securityEvents,
    status: 200,
  },
  {
    method: "POST",
    path: "/security-actions/revoke-api-key",
    summary: "Revoke an API key",
    description: "Incident response. Requires a reason; writes audit_logs and api_key.revoked. A key cannot revoke itself.",
    tag: "Security",
    scope: "security:respond",
    body: revokeKeyRequest,
    response: responses.revokedKey,
    status: 200,
    idempotent: true,
  },
  {
    method: "POST",
    path: "/security-actions/disable-user",
    summary: "Disable a user",
    description: "Incident response. Requires a reason; writes audit_logs and user.disabled. Refuses to disable the last active admin.",
    tag: "Security",
    scope: "security:respond",
    body: disableUserRequest,
    response: responses.disabledUser,
    status: 200,
    idempotent: true,
  },
];

export function endpoint(method: Endpoint["method"], path: string): Endpoint {
  const found = ENDPOINTS.find((e) => e.method === method && e.path === path);
  if (!found) throw new Error(`Unknown endpoint ${method} ${path}`);
  return found;
}
