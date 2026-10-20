import { describe, expect, it } from "vitest";
import type { EventInput } from "@/domain/events/types";
import {
  canonicalJson,
  redact,
  sealSecurityEvent,
  SECURITY_ACTION_NAMES,
  securityEventSchema,
  verifySecurityLogChain,
  type SecurityEvent,
  type SecurityEventDraft,
} from "@/domain/security/events";
import { EXAMPLE_WORKFLOWS } from "@/domain/automation/examples";
import { createWorkflow, setWorkflowEnabled, updateWorkflow } from "@/server/automation/workflows";
import { emit, flushSecurityEvents, getVisible } from "@/server/services/context";
import { createTestDb, ctxFor, DEMO_ORG_ID, DEMO_USER_IDS, NOW } from "./helpers/services";

const ORG = DEMO_ORG_ID;
const draft = (i: number, metadata: Record<string, unknown> = {}): SecurityEventDraft => ({
  event_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  organization_id: ORG,
  occurred_at: new Date(Date.UTC(2026, 9, 19, 12, 0, i)).toISOString(),
  action: "authz.denied",
  actor: { type: "user", user_id: DEMO_USER_IDS.repDaniel, role: "sales_rep" },
  source: { ip: "203.0.113.7", user_agent: "test", request_id: `req-${i}` },
  target: { type: "deal", id: `deal-${i}` },
  metadata,
});

function chain(n: number): SecurityEvent[] {
  const out: SecurityEvent[] = [];
  for (let i = 1; i <= n; i++) out.push(sealSecurityEvent(draft(i, { attempt: i }), out[out.length - 1] ?? null));
  return out;
}

describe("hash chain", () => {
  it("verifies a clean chain", () => {
    const events = chain(5);
    expect(verifySecurityLogChain(events)).toMatchObject({ ok: true, checked: 5, lastSequence: 5 });
    expect(verifySecurityLogChain([])).toMatchObject({ ok: true, checked: 0 });
  });

  it("detects a modified event", () => {
    const events = chain(5);
    events[2] = { ...events[2]!, metadata: { attempt: 999 } };
    expect(verifySecurityLogChain(events)).toMatchObject({ ok: false, failedAt: 3, reason: "hash_mismatch" });
  });

  it("detects a modified event even when its hash is recomputed", () => {
    const events = chain(5);
    const { hash, prev_hash, ...body } = events[1]!;
    void hash;
    const forged = { ...body, severity: "info" as const };
    events[1] = sealSecurityEvent({ ...forged, target: forged.target }, { sequence: 1, hash: prev_hash });
    expect(verifySecurityLogChain(events)).toMatchObject({ ok: false, failedAt: 3, reason: "prev_hash_mismatch" });
  });

  it("detects a deleted event", () => {
    const events = chain(5);
    events.splice(2, 1);
    expect(verifySecurityLogChain(events)).toMatchObject({ ok: false, failedAt: 4, reason: "sequence_gap" });
  });

  it("uses canonical JSON independent of key order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } })).toBe('{"a":{"c":[3,{"e":5,"f":4}],"d":2},"b":1}');
  });
});

describe("redaction", () => {
  it("removes secrets and truncates long values", () => {
    const out = redact({ password: "hunter2", api_key: "nx_live_abc", Authorization: "Bearer x", nested: { client_secret: "s", token: "t", ok: "fine" }, long: "x".repeat(900) }) as Record<string, unknown>;
    expect(out.password).toBe("[redacted]");
    expect(out.api_key).toBe("[redacted]");
    expect(out.Authorization).toBe("[redacted]");
    expect(out.nested).toEqual({ client_secret: "[redacted]", token: "[redacted]", ok: "fine" });
    expect((out.long as string).length).toBeLessThan(510);
  });

  it("is applied when events are sealed", () => {
    const event = sealSecurityEvent(draft(1, { password: "p", reason: "bad" }), null);
    expect(event.metadata).toEqual({ password: "[redacted]", reason: "bad" });
  });
});

describe("events through the bus", () => {
  it("every security action produces exactly one well-formed event and the chain stays intact", async () => {
    const { db, data } = createTestDb();
    const ctx = ctxFor(db, data(), DEMO_USER_IDS.admin);
    for (const action of SECURITY_ACTION_NAMES) {
      const payload =
        action === "authz.denied"
          ? { action: "view", resource: "deal", target_id: null, reason: "not_visible" }
          : action === "validation.failed"
            ? { action: "createCompany", count: 1, fields: ["name"] }
            : action === "rate_limit.exceeded"
              ? { bucket: "search", limit: 30, window_seconds: 60 }
              : action === "record.owner_changed"
                ? { entity: "deal", id: "x", from: null, to: null }
                : { target: { type: "test", id: action }, secret: "should-not-appear" };
      await db.write(ORG, (tx) => emit(tx, ctx, { type: action, payload } as EventInput));
    }
    const events = data().security_events;
    expect(events).toHaveLength(SECURITY_ACTION_NAMES.length);
    for (const action of SECURITY_ACTION_NAMES) expect(events.filter((e) => e.action === action)).toHaveLength(1);
    for (const e of events) {
      expect(securityEventSchema.safeParse(e).success).toBe(true);
      expect(JSON.stringify(e)).not.toContain("should-not-appear");
    }
    expect(verifySecurityLogChain(events).ok).toBe(true);
    // Domain events are not mixed into the security log, and security events are not in audit_logs.
    expect(data().audit_logs.some((l) => SECURITY_ACTION_NAMES.includes(l.action as never))).toBe(false);
  });

  it("records authz.denied once for a guessed id", async () => {
    const { db, data } = createTestDb();
    const daniel = ctxFor(db, data(), DEMO_USER_IDS.repDaniel);
    const sofiasDeal = data().deals.find((d) => d.owner_id === DEMO_USER_IDS.repSofia)!;
    await expect(db.read(ORG, (tx) => getVisible(tx, daniel, "deals", sofiasDeal.id, "deal", (r) => r.owner_id, "Deal"))).rejects.toThrow();
    await flushSecurityEvents(daniel);
    const denied = data().security_events.filter((e) => e.action === "authz.denied");
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ outcome: "failure", target: { type: "deal", id: sofiasDeal.id }, actor: { type: "user", user_id: DEMO_USER_IDS.repDaniel } });
  });

  it("records each workflow lifecycle change once, with a versioned audit diff", async () => {
    const { db, data } = createTestDb();
    const manager = ctxFor(db, data(), DEMO_USER_IDS.manager);
    manager.now = () => NOW;
    const def = EXAMPLE_WORKFLOWS[0]!.definition;
    const wf = await createWorkflow(manager, { name: "Copy", description: "", definition: def });
    await updateWorkflow(manager, { id: wf.id, name: "Copy v2", description: "", definition: def });
    await setWorkflowEnabled(manager, wf.id, true);
    await setWorkflowEnabled(manager, wf.id, false);
    const actions = data().security_events.filter((e) => e.target.id === wf.id).map((e) => e.action);
    expect(actions).toEqual(["workflow.created", "workflow.updated", "workflow.enabled", "workflow.disabled"]);
    const audit = data().audit_logs.filter((l) => l.target_id === wf.id && l.action === "record.updated");
    expect(audit[0]!.changes.changes).toMatchObject({ name: { before: "Copy", after: "Copy v2" }, version: { before: 1, after: 2 } });
    const rep = ctxFor(db, data(), DEMO_USER_IDS.repDaniel);
    await expect(createWorkflow(rep, { name: "x", description: "", definition: def })).rejects.toThrow(/Not allowed/);
  });
});
