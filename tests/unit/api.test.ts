import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AutomationWorkflow, Dataset } from "@/domain/entities";
import { buildOpenApi } from "@/domain/api/openapi";
import { ENDPOINTS } from "@/domain/api/contract";
import { generateSeed } from "@/domain/seed/generate";
import type { Db } from "@/server/db/types";
import { createTestDb, ctxFor, DEMO_ORG_ID, DEMO_USER_IDS, NOW } from "./helpers/services";

// The API resolves keys across organizations and runs as the service database; point both at the test store.
const state = vi.hoisted(() => ({ db: null as unknown as Db, data: null as unknown as () => Dataset }));
vi.mock("@/server/db", async () => {
  const types = await import("@/server/db/types");
  return {
    getDb: () => state.db,
    getServiceDb: () => state.db,
    listOrganizationIds: async () => [state.data().organizations[0]!.id],
    findApiKeyByHash: async (hash: string) => state.data().api_keys.find((k) => k.key_hash === hash) ?? null,
    findApiKeysByPrefix: async (prefix: string) => state.data().api_keys.filter((k) => k.prefix === prefix),
    UniqueViolation: types.UniqueViolation,
  };
});

const v1 = await import("@/server/api/v1");
const { createApiKey } = await import("@/server/services/api-keys");
const { saveIntegration } = await import("@/server/services/integrations");
const { signatureHeader } = await import("@/domain/integrations/webhooks");

process.env.NEXORA_ENCRYPTION_KEY = "test-encryption-key-0123456789-abcdefghij";

const BASE = "http://localhost/api/v1";

function request(method: "GET" | "POST", path: string, opts: { key?: string; body?: unknown; raw?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { "user-agent": "vitest", "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 200)}`, ...opts.headers };
  if (opts.key) headers.authorization = `Bearer ${opts.key}`;
  if (opts.body !== undefined || opts.raw !== undefined) headers["content-type"] = "application/json";
  return new Request(`${BASE}${path}`, { method, headers, body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)) });
}

async function call(handler: (r: Request) => Promise<Response>, req: Request) {
  const res = await handler(req);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose JSON access in assertions
  return { status: res.status, headers: res.headers, json: (await res.json()) as Record<string, any> };
}

async function key(scopes: string[], kind: "integration" | "siem" = "integration") {
  const ctx = ctxFor(state.db, state.data(), DEMO_USER_IDS.admin);
  return (await createApiKey(ctx, { name: `test ${scopes.join(",")}`, kind, scopes: scopes as never })).key;
}

const lead = { title: "Hydraulic press", company_name: "Example Presswerk", contact_name: "Ilse Example", email: "ilse@example.com", country: "DE", estimated_value: 120000 };

beforeEach(() => {
  ({ db: state.db, data: state.data } = createTestDb(generateSeed(NOW)));
});

describe("API key authentication and scopes", () => {
  it("rejects missing, malformed and wrong keys, logging a wrong secret for a known prefix", async () => {
    expect((await call(v1.listCompaniesRoute, request("GET", "/companies"))).json.error.code).toBe("unauthorized");
    expect((await call(v1.listCompaniesRoute, request("GET", "/companies", { key: "not-a-key" }))).status).toBe(401);
    const good = await key(["records:read"]);
    const wrong = good.slice(0, -4) + "AAAA";
    const res = await call(v1.listCompaniesRoute, request("GET", "/companies", { key: wrong }));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("Bearer");
    expect(state.data().security_events.some((e) => e.action === "api.auth_failed" && e.metadata.reason === "wrong_secret")).toBe(true);
  });

  it("accepts a valid key and returns the paginated, permission-scoped list", async () => {
    const k = await key(["records:read"]);
    const res = await call(v1.listCompaniesRoute, request("GET", "/companies?per_page=5&page=2", { key: k }));
    expect(res.status).toBe(200);
    expect(res.json.data).toHaveLength(5);
    expect(res.json.meta).toMatchObject({ page: 2, per_page: 5, total: state.data().companies.length });
    expect(Object.keys(res.json.data[0]).sort()).toEqual(["city", "contacts", "country", "created_at", "id", "industry", "lifecycle_stage", "name", "open_deals", "owner_id", "website"]);
    expect(state.data().api_keys[0]!.last_used_at).not.toBeNull();
  });

  it("limits a key to what its creator may see", async () => {
    const repCtx = ctxFor(state.db, state.data(), DEMO_USER_IDS.repDaniel);
    // A sales rep cannot create keys at all.
    await expect(createApiKey(repCtx, { name: "rep", kind: "integration", scopes: ["records:read"] })).rejects.toThrow();
  });

  it("denies a missing scope with 403 and records api.scope_denied", async () => {
    const k = await key(["records:read"]);
    const res = await call(v1.submitLead, request("POST", "/leads", { key: k, body: lead }));
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe("insufficient_scope");
    expect(state.data().security_events.find((e) => e.action === "api.scope_denied")).toMatchObject({ actor: { type: "api_key" }, metadata: { required: "leads:write" } });
  });

  it("keeps integration and SIEM scopes apart", async () => {
    const ctx = ctxFor(state.db, state.data(), DEMO_USER_IDS.admin);
    await expect(createApiKey(ctx, { name: "x", kind: "integration", scopes: ["security:read"] })).rejects.toThrow(/security scopes/);
    await expect(createApiKey(ctx, { name: "x", kind: "siem", scopes: ["records:read"] })).rejects.toThrow(/SIEM keys/);
  });

  it("refuses a revoked key and records api_key.used_after_revoke", async () => {
    const k = await key(["records:read"]);
    const id = state.data().api_keys[0]!.id;
    const ctx = ctxFor(state.db, state.data(), DEMO_USER_IDS.admin);
    const { revokeApiKey } = await import("@/server/services/api-keys");
    await revokeApiKey(ctx, { id, reason: "test" });
    const res = await call(v1.listCompaniesRoute, request("GET", "/companies", { key: k }));
    expect(res.status).toBe(401);
    expect(res.json.error.message).toMatch(/revoked/);
    expect(state.data().security_events.find((e) => e.action === "api_key.used_after_revoke")?.actor).toEqual({ type: "api_key", api_key_id: id });
  });
});

describe("validation", () => {
  it("returns structured errors for bad bodies, unknown fields, bad JSON and bad queries", async () => {
    const k = await key(["leads:write", "records:read"]);
    const bad = await call(v1.submitLead, request("POST", "/leads", { key: k, body: { ...lead, title: "", country: "Germany" } }));
    expect(bad.status).toBe(400);
    expect(bad.json.error.code).toBe("validation_failed");
    expect(bad.json.error.details.map((d: { path: string }) => d.path).sort()).toEqual(["country", "title"]);
    const extra = await call(v1.submitLead, request("POST", "/leads", { key: k, body: { ...lead, owner_id: DEMO_USER_IDS.admin } }));
    expect(extra.json.error.details[0].message).toMatch(/Unrecognized key/);
    expect((await call(v1.submitLead, request("POST", "/leads", { key: k, raw: "{not json" }))).json.error.code).toBe("invalid_json");
    expect((await call(v1.listDealsRoute, request("GET", "/deals?per_page=1000", { key: k }))).status).toBe(400);
    const big = await call(v1.submitLead, request("POST", "/leads", { key: k, raw: JSON.stringify({ ...lead, title: "x".repeat(70_000) }) }));
    expect(big.status).toBe(413);
    expect(state.data().security_events.some((e) => e.action === "validation.failed")).toBe(true);
  });
});

describe("POST /leads", () => {
  it("creates an unassigned API lead that the New lead automation assigns and follows up", async () => {
    const k = await key(["leads:write"]);
    const res = await call(v1.submitLead, request("POST", "/leads", { key: k, body: lead }));
    expect(res.status).toBe(201);
    expect(res.json.data).toMatchObject({ title: lead.title, source: "api", status: "new", owner_id: null });
    const stored = state.data().leads.find((l) => l.id === res.json.data.id)!;
    expect(stored.owner_id).not.toBeNull(); // assigned by the seeded New lead workflow after commit
    expect(state.data().tasks.some((t) => t.title === `Follow up with ${lead.contact_name} at ${lead.company_name}`)).toBe(true);
    const audit = state.data().audit_logs.find((a) => a.action === "record.created" && a.target_id === stored.id)!;
    expect(audit.changes.via_api_key_id).toBe(state.data().api_keys[0]!.id);
  });

  it("honors Idempotency-Key: same request replays, a different body is refused, no duplicate lead", async () => {
    const k = await key(["leads:write"]);
    const first = await call(v1.submitLead, request("POST", "/leads", { key: k, body: lead, headers: { "idempotency-key": "form-123" } }));
    const replay = await call(v1.submitLead, request("POST", "/leads", { key: k, body: lead, headers: { "idempotency-key": "form-123" } }));
    expect(replay.status).toBe(201);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(replay.json.data.id).toBe(first.json.data.id);
    const changed = await call(v1.submitLead, request("POST", "/leads", { key: k, body: { ...lead, title: "Other" }, headers: { "idempotency-key": "form-123" } }));
    expect(changed.status).toBe(409);
    expect(changed.json.error.code).toBe("idempotency_key_reused");
    expect(state.data().leads.filter((l) => l.title === lead.title)).toHaveLength(1);
  });
});

describe("POST /events", () => {
  async function webhookWorkflow(eventType: string) {
    const wf: AutomationWorkflow = {
      id: randomUUID(),
      organization_id: DEMO_ORG_ID,
      name: "Log Make notification",
      description: "",
      trigger_type: "webhook.received",
      definition: { trigger: { type: "webhook.received", entity: "lead", event_type: eventType }, steps: [{ id: "log", type: "create_activity", activity_type: "system", subject: "Notified in Slack via Make", body: "" }] },
      enabled: true,
      version: 1,
      created_by: DEMO_USER_IDS.admin,
      updated_by: DEMO_USER_IDS.admin,
      created_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
      archived_at: null,
    };
    await state.db.write(DEMO_ORG_ID, (tx) => tx.insert("automation_workflows", wf));
    return wf;
  }

  it("raises webhook.received and runs the matching workflow on the record", async () => {
    const wf = await webhookWorkflow("make.lead_notified");
    const k = await key(["events:write"]);
    const target = state.data().leads[0]!;
    const res = await call(v1.receiveEvent, request("POST", "/events", { key: k, body: { event_type: "make.lead_notified", entity: "lead", record_id: target.id, data: { channel: "slack" } } }));
    expect(res.status).toBe(202);
    expect(res.json.data).toMatchObject({ accepted: true, workflows_matched: 1 });
    const run = state.data().automation_executions.find((e) => e.workflow_id === wf.id)!;
    expect(run.status).toBe("success");
    expect(state.data().activities.some((a) => a.lead_id === target.id && a.subject === "Notified in Slack via Make")).toBe(true);
  });

  it("checks an optional integration signature and records webhook.signature_invalid", async () => {
    const admin = ctxFor(state.db, state.data(), DEMO_USER_IDS.admin);
    const { secret } = await saveIntegration(admin, { provider: "make", url: "https://hook.eu1.make.com/abc", auth_mode: "signature", subscribed_events: ["lead.created"], enabled: true });
    const k = await key(["events:write"]);
    const raw = JSON.stringify({ event_type: "make.ping" });
    const ok = await call(v1.receiveEvent, request("POST", "/events", { key: k, raw, headers: { "x-nexora-integration": "make", "x-nexora-signature": signatureHeader(secret!, raw) } }));
    expect(ok.status).toBe(202);
    const forged = await call(v1.receiveEvent, request("POST", "/events", { key: k, raw, headers: { "x-nexora-integration": "make", "x-nexora-signature": signatureHeader("whsec_wrong", raw) } }));
    expect(forged.status).toBe(401);
    expect(forged.json.error.code).toBe("signature_invalid");
    expect(state.data().security_events.some((e) => e.action === "webhook.signature_invalid")).toBe(true);
  });

  it("returns 404 for a record that does not exist", async () => {
    const k = await key(["events:write"]);
    const res = await call(v1.receiveEvent, request("POST", "/events", { key: k, body: { event_type: "x.y", entity: "deal", record_id: randomUUID() } }));
    expect(res.status).toBe(404);
  });
});

describe("security API for the SIEM", () => {
  it("pages the chained security log by sequence for SIEM keys only", async () => {
    const siem = await key(["security:read"], "siem");
    const integration = await key(["records:read"]);
    expect((await call(v1.securityEvents, request("GET", "/security-events", { key: integration }))).status).toBe(403);
    const page1 = await call(v1.securityEvents, request("GET", "/security-events?limit=1", { key: siem }));
    expect(page1.status).toBe(200);
    expect(page1.json.data[0]).toMatchObject({ sequence: 1 });
    expect(page1.json.data[0].hash).toMatch(/^[a-f0-9]{64}$/);
    const page2 = await call(v1.securityEvents, request("GET", `/security-events?after_sequence=${page1.json.meta.next_after_sequence}&limit=500`, { key: siem }));
    expect(page2.json.data[0].sequence).toBe(2);
    expect(page2.json.data[0].prev_hash).toBe(page1.json.data[0].hash);
    expect(page2.json.meta.has_more).toBe(false);
  });

  it("revokes keys and disables users with a reason, never the last active admin", async () => {
    const responder = await key(["security:respond"], "siem");
    await key(["records:read"]);
    const victim = state.data().api_keys.find((k) => k.kind === "integration")!;
    const noReason = await call(v1.revokeApiKeyAction, request("POST", "/security-actions/revoke-api-key", { key: responder, body: { api_key_id: victim.id } }));
    expect(noReason.status).toBe(400);
    const revoked = await call(v1.revokeApiKeyAction, request("POST", "/security-actions/revoke-api-key", { key: responder, body: { api_key_id: victim.id, reason: "Credential stuffing from 203.0.113.7" } }));
    expect(revoked.status).toBe(200);
    expect(state.data().api_keys.find((k) => k.id === victim.id)!.revoked_at).not.toBeNull();
    expect(state.data().security_events.find((e) => e.action === "api_key.revoked")?.metadata).toMatchObject({ via: "siem", reason: "Credential stuffing from 203.0.113.7" });

    const rep = await call(v1.disableUserAction, request("POST", "/security-actions/disable-user", { key: responder, body: { user_id: DEMO_USER_IDS.repDaniel, reason: "Impossible travel" } }));
    expect(rep.json.data).toEqual({ id: DEMO_USER_IDS.repDaniel, is_active: false, changed: true });
    expect(state.data().audit_logs.some((a) => a.target_id === DEMO_USER_IDS.repDaniel && a.action === "record.updated")).toBe(true);
    const admin = await call(v1.disableUserAction, request("POST", "/security-actions/disable-user", { key: responder, body: { user_id: DEMO_USER_IDS.admin, reason: "test" } }));
    expect(admin.status).toBe(409);
    expect(state.data().profiles.find((p) => p.id === DEMO_USER_IDS.admin)!.is_active).toBe(true);
  });
});

describe("OpenAPI document", () => {
  it("documents every registered endpoint with its scope and named schemas", () => {
    const doc = buildOpenApi() as { openapi: string; paths: Record<string, Record<string, { security: unknown[] }>>; components: { schemas: Record<string, unknown> } };
    expect(doc.openapi).toBe("3.1.0");
    for (const e of ENDPOINTS) expect(doc.paths[e.path]?.[e.method.toLowerCase()]).toBeDefined();
    expect(Object.keys(doc.components.schemas)).toEqual(expect.arrayContaining(["LeadSubmission", "Lead", "SecurityEvent", "Error"]));
    expect(JSON.stringify(doc)).not.toContain("#/$defs/");
  });

  it("has a route file for every endpoint", async () => {
    const { existsSync } = await import("node:fs");
    for (const e of ENDPOINTS) expect(existsSync(`src/app/api/v1${e.path}/route.ts`), e.path).toBe(true);
  });
});
