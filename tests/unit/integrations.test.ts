import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Dataset } from "@/domain/entities";
import type { DomainEvent } from "@/domain/events/types";
import { blockedAddressReason, checkOutboundUrl } from "@/domain/integrations/ssrf";
import { isRetryableStatus, outboundEventsFor, retryDelayMs, SIGNATURE_HEADER, signatureHeader, verifySignature } from "@/domain/integrations/webhooks";
import type { Db } from "@/server/db/types";
import { createTransport, SsrfBlockedError, type Transport, type TransportRequest } from "@/server/integrations/transport";
import { dispatchDomainEvent, processDueRetries, sendTestEvent, redeliver } from "@/server/integrations/webhooks";
import { flushSecurityEvents } from "@/server/services/context";
import { engineOverlaps, saveIntegration, statusOf } from "@/server/services/integrations";
import { DomainError } from "@/server/repositories/types";
import { createTestDb, ctxFor, DEMO_ORG_ID, DEMO_USER_IDS, NOW } from "./helpers/services";

process.env.NEXORA_ENCRYPTION_KEY = "test-encryption-key-0123456789-abcdefghij";

const meta = { ip: null, user_agent: "vitest", request_id: "integrations-test" };

describe("SSRF policy", () => {
  it.each([
    ["127.0.0.1", "loopback"],
    ["10.1.2.3", "private"],
    ["172.20.0.5", "private"],
    ["192.168.1.10", "private"],
    ["169.254.169.254", "link-local (includes cloud metadata 169.254.169.254)"],
    ["100.64.0.1", "carrier-grade NAT"],
    ["0.0.0.0", "unspecified"],
    ["::1", "loopback"],
    ["::", "unspecified"],
    ["fd00::1", "unique local (private)"],
    ["fe80::1", "link-local"],
    ["::ffff:127.0.0.1", "loopback"],
    ["::ffff:169.254.169.254", "link-local (includes cloud metadata 169.254.169.254)"],
  ])("blocks %s (%s)", (address, reason) => {
    expect(blockedAddressReason(address)).toBe(reason);
  });

  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("allows public %s", (address) => {
    expect(blockedAddressReason(address)).toBeNull();
  });

  it("requires https in production and refuses credentials and internal hostnames", () => {
    expect(checkOutboundUrl("http://hooks.example.com/x", { allowHttp: false })).toMatchObject({ ok: false, reason: "Webhook URLs must use https." });
    expect(checkOutboundUrl("https://user:pass@hooks.example.com/x", { allowHttp: false }).ok).toBe(false);
    expect(checkOutboundUrl("https://localhost/x", { allowHttp: false }).ok).toBe(false);
    expect(checkOutboundUrl("https://metadata.google.internal/x", { allowHttp: false }).ok).toBe(false);
    expect(checkOutboundUrl("https://169.254.169.254/latest/meta-data", { allowHttp: false }).ok).toBe(false);
    expect(checkOutboundUrl("https://[::1]/x", { allowHttp: false }).ok).toBe(false);
    expect(checkOutboundUrl("https://hook.eu1.make.com/abc", { allowHttp: false }).ok).toBe(true);
  });
});

describe("signatures and retry timing", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ event_id: "e1", type: "lead.created" });

  it("verifies its own signature and rejects tampering, staleness and garbage", () => {
    const header = signatureHeader(secret, body, NOW);
    expect(verifySignature(secret, header, body, NOW)).toEqual({ ok: true });
    expect(verifySignature(secret, header, body.replace("e1", "e2"), NOW)).toEqual({ ok: false, reason: "mismatch" });
    expect(verifySignature("whsec_other", header, body, NOW)).toEqual({ ok: false, reason: "mismatch" });
    expect(verifySignature(secret, header, body, new Date(NOW.getTime() + 301_000))).toEqual({ ok: false, reason: "expired" });
    expect(verifySignature(secret, "v1=abc", body, NOW)).toEqual({ ok: false, reason: "malformed" });
    expect(verifySignature(secret, null, body, NOW)).toEqual({ ok: false, reason: "malformed" });
  });

  it("backs off exponentially for three attempts and retries only transient failures", () => {
    expect([1, 2, 3].map(retryDelayMs)).toEqual([60_000, 240_000, null]);
    expect([null, 408, 429, 500, 503].every(isRetryableStatus)).toBe(true);
    expect([400, 401, 404, 410].some(isRetryableStatus)).toBe(false);
  });

  it("maps domain events to outbound events, with deal.won in addition to the stage change", () => {
    const base = { id: "ev1", occurred_at: NOW.toISOString(), organization_id: DEMO_ORG_ID, actor: { id: null, role: "service" }, meta, causation: { depth: 0, chain: [] } };
    const won = { ...base, type: "deal.stage_changed", payload: { deal_id: "d1", from_stage_id: "s1", to_stage_id: "s2", is_won: true, is_lost: false, lost_reason: null } } as DomainEvent;
    expect(outboundEventsFor(won).map((m) => m.type)).toEqual(["deal.stage_changed", "deal.won"]);
    const lead = { ...base, type: "record.created", payload: { entity: "lead", id: "l1", after: {} } } as DomainEvent;
    expect(outboundEventsFor(lead).map((m) => m.type)).toEqual(["lead.created"]);
    const comment = { ...base, type: "record.created", payload: { entity: "comment", id: "c1", after: {} } } as DomainEvent;
    expect(outboundEventsFor(comment)).toEqual([]);
  });
});

describe("webhook delivery", () => {
  let db: Db;
  let data: () => Dataset;
  let calls: TransportRequest[];
  let responses: Array<number | Error>;
  const transport: Transport = async (req) => {
    calls.push(req);
    const next = responses.shift() ?? 200;
    if (next instanceof Error) throw next;
    return { status: next, body: next >= 400 ? "receiver error" : '{"ok":true}', durationMs: 12 };
  };
  let now: Date;
  const deps = () => ({ db, meta, now: () => now, transport });

  async function connect(events: string[] = ["lead.created"]) {
    const ctx = ctxFor(db, data(), DEMO_USER_IDS.admin);
    const result = await saveIntegration(ctx, { provider: "n8n", url: "https://n8n.example.com/webhook/nexora", auth_mode: "signature", subscribed_events: events as never, enabled: true });
    return { secret: result.secret!, integration: data().integration_settings.find((i) => i.provider === "n8n")! };
  }

  function leadCreated(id = "evt-lead-1"): DomainEvent {
    const lead = data().leads[0]!;
    return { id, type: "record.created", occurred_at: NOW.toISOString(), organization_id: DEMO_ORG_ID, actor: { id: DEMO_USER_IDS.admin, role: "admin" }, meta, causation: { depth: 0, chain: [] }, payload: { entity: "lead", id: lead.id, after: {} } } as DomainEvent;
  }

  beforeEach(() => {
    ({ db, data } = createTestDb());
    calls = [];
    responses = [];
    now = new Date(NOW);
  });

  it("stores the secret encrypted, shows it once and signs every request with it", async () => {
    const { secret, integration } = await connect();
    expect(secret).toMatch(/^whsec_/);
    expect(integration.secret_ciphertext).not.toContain(secret);
    expect(integration.secret_preview).toBe(secret.slice(-4));
    expect(JSON.stringify(integration)).not.toContain(secret);

    const [delivery] = await dispatchDomainEvent(deps(), leadCreated());
    expect(delivery).toMatchObject({ status: "success", status_code: 200, attempt: 1, reason: "event", event_type: "lead.created" });
    const sent = calls[0]!;
    expect(verifySignature(secret, sent.headers[SIGNATURE_HEADER], sent.body, now)).toEqual({ ok: true });
    const envelope = JSON.parse(sent.body);
    expect(Object.keys(envelope)).toEqual(["event_id", "type", "occurred_at", "organization_id", "data"]);
    expect(envelope.data.record.title).toBe(data().leads[0]!.title);
    expect(data().security_events.some((e) => e.action === "integration.webhook_sent" && e.metadata.domain === "n8n.example.com")).toBe(true);
  });

  it("delivers each event once per integration", async () => {
    await connect();
    await dispatchDomainEvent(deps(), leadCreated("same"));
    await dispatchDomainEvent(deps(), leadCreated("same"));
    expect(calls).toHaveLength(1);
  });

  it("retries a failing receiver with backoff, logging every attempt, and stops after three", async () => {
    await connect();
    responses = [503, new Error("socket hang up"), 500];
    await dispatchDomainEvent(deps(), leadCreated());
    let log = data().webhook_deliveries;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ status: "failed", attempt: 1, status_code: 503, error: "Receiver responded with HTTP 503" });
    expect(log[0]!.next_retry_at).toBe(new Date(NOW.getTime() + 60_000).toISOString());

    expect(await processDueRetries(deps(), DEMO_ORG_ID)).toBe(0); // backoff not elapsed
    now = new Date(NOW.getTime() + 61_000);
    expect(await processDueRetries(deps(), DEMO_ORG_ID)).toBe(1);
    now = new Date(NOW.getTime() + 61_000 + 241_000);
    expect(await processDueRetries(deps(), DEMO_ORG_ID)).toBe(1);
    now = new Date(NOW.getTime() + 3_600_000);
    expect(await processDueRetries(deps(), DEMO_ORG_ID)).toBe(0);

    log = [...data().webhook_deliveries].sort((a, b) => a.attempt - b.attempt);
    expect(log.map((d) => [d.attempt, d.status, d.reason])).toEqual([
      [1, "failed", "event"],
      [2, "failed", "retry"],
      [3, "failed", "retry"],
    ]);
    expect(log[1]!.error).toBe("socket hang up");
    expect(log.every((d) => d.event_id === log[0]!.event_id)).toBe(true);
    expect(log.every((d) => d.next_retry_at === null)).toBe(true);
    expect(calls).toHaveLength(3);
  });

  it("does not retry a 4xx answer", async () => {
    await connect();
    responses = [400];
    await dispatchDomainEvent(deps(), leadCreated());
    expect(data().webhook_deliveries[0]).toMatchObject({ status: "failed", next_retry_at: null });
  });

  it("sets Connected or Error from a real test event, and redelivers with the same event id", async () => {
    const { integration } = await connect();
    expect(statusOf(integration)).toBe("configured");
    responses = [500];
    await sendTestEvent(deps(), integration);
    expect(statusOf(data().integration_settings.find((i) => i.id === integration.id)!)).toBe("error");
    const failed = data().webhook_deliveries[0]!;
    expect(failed.next_retry_at).toBeNull(); // tests are not retried
    await sendTestEvent(deps(), data().integration_settings.find((i) => i.id === integration.id)!);
    expect(statusOf(data().integration_settings.find((i) => i.id === integration.id)!)).toBe("connected");

    const again = await redeliver(deps(), integration, failed);
    expect(again).toMatchObject({ reason: "redeliver", event_id: failed.event_id, status: "success" });
    expect(JSON.parse(calls[2]!.body).event_id).toBe(failed.event_id);
  });

  it("refuses private and metadata URLs when saving and records security.ssrf_blocked", async () => {
    const ctx = ctxFor(db, data(), DEMO_USER_IDS.admin);
    await expect(saveIntegration(ctx, { provider: "make", url: "https://169.254.169.254/latest", auth_mode: "signature", subscribed_events: ["lead.created"], enabled: true })).rejects.toThrow(DomainError);
    await flushSecurityEvents(ctx);
    expect(data().security_events.find((e) => e.action === "security.ssrf_blocked")?.metadata).toMatchObject({ host: "169.254.169.254", stage: "configuration" });
    expect(data().integration_settings).toHaveLength(0);
  });

  it("only admins can change integrations", async () => {
    const ctx = ctxFor(db, data(), DEMO_USER_IDS.manager);
    await expect(saveIntegration(ctx, { provider: "make", url: "https://hook.eu1.make.com/x", auth_mode: "signature", subscribed_events: ["lead.created"], enabled: true })).rejects.toThrow();
  });

  it("warns when an internal workflow already handles an event that goes to an external platform", () => {
    const overlaps = engineOverlaps(["lead.created", "order.created"], data().automation_workflows);
    expect(overlaps.map((o) => o.event)).toEqual(["lead.created"]);
    expect(overlaps[0]!.actions).toContain("Create task");
  });
});

describe("HTTP transport", () => {
  let server: Server;
  let base: string;
  let received: string[] = [];
  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.push(`${req.url} ${body}`);
        if (req.url === "/redirect-same") return res.writeHead(307, { location: "/ok" }).end();
        if (req.url === "/redirect-other") return res.writeHead(307, { location: "https://evil.example.com/" }).end();
        if (req.url === "/big") return res.writeHead(200).end("x".repeat(200_000));
        res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());
  beforeEach(() => {
    received = [];
  });

  it("blocks loopback targets unless private addresses are explicitly allowed (local development)", async () => {
    const strict = createTransport({ allowHttp: true, allowPrivate: false });
    await expect(strict({ url: `${base}/ok`, body: "{}", headers: {} })).rejects.toBeInstanceOf(SsrfBlockedError);
    expect(received).toHaveLength(0);
    const local = createTransport({ allowHttp: true, allowPrivate: true });
    await expect(local({ url: `${base}/ok`, body: '{"a":1}', headers: { "Content-Type": "application/json" } })).resolves.toMatchObject({ status: 200, body: '{"ok":true}' });
    expect(received).toEqual(['/ok {"a":1}']);
  });

  it("follows redirects only to the same host and caps the response size", async () => {
    const local = createTransport({ allowHttp: true, allowPrivate: true, maxResponseBytes: 1024 });
    await expect(local({ url: `${base}/redirect-same`, body: "{}", headers: {} })).resolves.toMatchObject({ status: 200 });
    await expect(local({ url: `${base}/redirect-other`, body: "{}", headers: {} })).rejects.toBeInstanceOf(SsrfBlockedError);
    const big = await local({ url: `${base}/big`, body: "{}", headers: {} });
    expect(big.body.length).toBeLessThanOrEqual(1024);
  });
});
