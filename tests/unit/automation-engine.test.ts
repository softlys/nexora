import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { AutomationWorkflow, Dataset } from "@/domain/entities";
import type { DomainEvent } from "@/domain/events/types";
import { EXAMPLE_WORKFLOWS } from "@/domain/automation/examples";
import type { WorkflowDefinition } from "@/domain/automation/schema";
import { handleEvent, retryExecution, testRunWorkflow, type EngineDeps } from "@/server/automation/engine";
import { runScheduler } from "@/server/automation/scheduler";
import type { Db } from "@/server/db/types";
import { createLead } from "@/server/services/leads";
import { moveDealStage } from "@/server/services/deals";
import { generateSeed } from "@/domain/seed/generate";
import { createTestDb, ctxFor, DEMO_ORG_ID, DEMO_USER_IDS, NOW } from "./helpers/services";

let db: Db;
let data: () => Dataset;
let deps: EngineDeps;
const meta = { ip: null, user_agent: "vitest", request_id: "engine-test" };

function insertWorkflow(def: WorkflowDefinition, name = "Test workflow", enabled = true): Promise<AutomationWorkflow> {
  const at = NOW.toISOString();
  const wf: AutomationWorkflow = {
    id: randomUUID(),
    organization_id: DEMO_ORG_ID,
    name,
    description: "",
    trigger_type: def.trigger.type,
    definition: def as unknown as Record<string, unknown>,
    enabled,
    version: 1,
    created_by: DEMO_USER_IDS.admin,
    updated_by: DEMO_USER_IDS.admin,
    created_at: at,
    updated_at: at,
    archived_at: null,
  };
  return db.write(DEMO_ORG_ID, async (tx) => {
    await tx.insert("automation_workflows", wf);
    return wf;
  });
}

const example = (key: string) => EXAMPLE_WORKFLOWS.find((w) => w.key === key)!.definition;

async function runPending(events: DomainEvent[] | undefined) {
  const out = [];
  for (const e of events ?? []) out.push(...(await handleEvent(deps, e)));
  return out;
}

beforeEach(() => {
  // Start without the seeded example automations so each test controls which workflows exist.
  const seed = generateSeed(NOW);
  seed.automation_workflows = [];
  seed.automation_executions = [];
  seed.notifications = seed.notifications.filter((n) => !n.type.startsWith("automation."));
  ({ db, data } = createTestDb(seed));
  deps = { db, meta, now: () => NOW };
});

describe("example automation: new lead", () => {
  it("assigns an owner, creates a follow-up due in one business day and logs an activity", async () => {
    const wf = await insertWorkflow(example("new_lead"));
    const manager = { ...ctxFor(db, data(), DEMO_USER_IDS.manager), pendingEvents: [] as DomainEvent[] };
    const lead = await createLead(manager, {
      title: "Compressor inquiry",
      company_name: "Fjordline Dairy",
      contact_name: "Ada Lind",
      email: null,
      phone: null,
      country: "NO",
      source: "website",
      status: "new",
      qualification: "warm",
      next_action: "",
      next_action_at: null,
      estimated_value: 9000,
      owner_id: null,
    });
    const [execution] = await runPending(manager.pendingEvents);
    expect(execution).toMatchObject({ workflow_id: wf.id, status: "success" });
    const after = data();
    const updated = after.leads.find((l) => l.id === lead.id)!;
    const reps = after.profiles.filter((p) => p.role === "sales_rep").map((p) => p.id);
    expect(reps).toContain(updated.owner_id);
    const task = after.tasks.find((t) => t.title === "Follow up with Ada Lind at Fjordline Dairy")!;
    expect(task.assignee_id).toBe(updated.owner_id);
    expect(task.type).toBe("follow_up");
    expect(task.due_at).toBe("2026-10-20T12:00:00.000Z"); // NOW is Monday 2026-10-19 12:00 → next business day
    expect(after.activities.some((a) => a.lead_id === lead.id && a.subject === "Lead received and assigned")).toBe(true);
    expect((execution!.steps as Array<{ status: string }>).map((s) => s.status)).toEqual(["success", "success", "success"]);
    expect(execution!.duration_ms).not.toBeNull();
  });

  it("uses the country map when one matches", async () => {
    const def = structuredClone(example("new_lead"));
    (def.steps[0] as { country_map: Record<string, string> }).country_map = { NO: DEMO_USER_IDS.repEthan };
    await insertWorkflow(def);
    const admin = { ...ctxFor(db, data(), DEMO_USER_IDS.admin), pendingEvents: [] as DomainEvent[] };
    const lead = await createLead(admin, {
      title: "x", company_name: "y", contact_name: "z", email: null, phone: null, country: "NO", source: "website", status: "new", qualification: "warm", next_action: "", next_action_at: null, estimated_value: 1, owner_id: null,
    });
    await runPending(admin.pendingEvents);
    expect(data().leads.find((l) => l.id === lead.id)!.owner_id).toBe(DEMO_USER_IDS.repEthan);
  });
});

describe("example automation: deal won", () => {
  it("creates exactly one order and notifies the owner and managers, even when the event repeats", async () => {
    await insertWorkflow(example("deal_won"));
    const won = data().pipeline_stages.find((s) => s.is_won)!;
    const open = data().deals.find((d) => d.closed_at === null && !data().orders.some((o) => o.source_deal_id === d.id))!;
    const owner = { ...ctxFor(db, data(), open.owner_id), pendingEvents: [] as DomainEvent[] };
    await moveDealStage(owner, { deal_id: open.id, stage_id: won.id });
    const event = owner.pendingEvents.find((e) => e.type === "deal.stage_changed")!;
    const [first] = await handleEvent(deps, event);
    expect(first!.status).toBe("success");
    const again = await handleEvent(deps, event);
    expect(again[0]!.id).toBe(first!.id);
    expect(data().orders.filter((o) => o.source_deal_id === open.id)).toHaveLength(1);
    const notified = data().notifications.filter((n) => n.dedupe_key?.includes(open.id)).map((n) => n.recipient_id);
    expect(notified).toContain(open.owner_id);
    expect(notified).toContain(DEMO_USER_IDS.manager);

    // Moving it out of Won and back is a new event; the workflow runs again but finds the existing order.
    const proposal = data().pipeline_stages.find((s) => s.name === "Proposal")!;
    const admin = { ...ctxFor(db, data(), DEMO_USER_IDS.admin), pendingEvents: [] as DomainEvent[] };
    await moveDealStage(admin, { deal_id: open.id, stage_id: proposal.id });
    await moveDealStage(admin, { deal_id: open.id, stage_id: won.id });
    const reruns = await runPending(admin.pendingEvents);
    expect(reruns.some((r) => r.status === "success")).toBe(true);
    expect(data().orders.filter((o) => o.source_deal_id === open.id)).toHaveLength(1);
    expect(data().notifications.filter((n) => n.dedupe_key?.includes(open.id))).toHaveLength(notified.length);
  });
});

describe("example automation: overdue follow-up", () => {
  it("notifies once per task across scheduler runs and emits a heartbeat", async () => {
    await insertWorkflow(example("overdue_follow_up"));
    const overdue = data().tasks.filter((t) => t.type === "follow_up" && (t.status === "todo" || t.status === "in_progress") && t.due_at! <= NOW.toISOString());
    expect(overdue.length).toBeGreaterThan(0);
    const first = await runScheduler(deps, DEMO_ORG_ID);
    expect(first.dateEvents).toBe(overdue.length);
    expect(first.heartbeat).toBe(true);
    const countNotifications = () => data().notifications.filter((n) => n.type === "automation.date.reached").length;
    const afterFirst = countNotifications();
    expect(afterFirst).toBe(overdue.length);
    const second = await runScheduler(deps, DEMO_ORG_ID);
    expect(second.executions).toBe(0);
    expect(countNotifications()).toBe(afterFirst);
    expect(second.heartbeat).toBe(false); // less than five minutes later
    expect(data().security_events.filter((e) => e.action === "system.heartbeat")).toHaveLength(1);
  });
});

describe("engine guarantees", () => {
  it("logs each step with status and output", async () => {
    await insertWorkflow(example("overdue_follow_up"));
    await runScheduler(deps, DEMO_ORG_ID);
    const run = data().automation_executions[0]!;
    expect(run.trigger_payload.event).toBeTruthy();
    const steps = run.steps as Array<{ step_id: string; status: string; duration_ms: number }>;
    expect(steps[0]).toMatchObject({ step_id: "still-open", status: "success" });
    expect(typeof steps[0]!.duration_ms).toBe("number");
  });

  it("stops at causation depth 3", async () => {
    const wf = await insertWorkflow(example("new_lead"));
    const lead = data().leads[0]!;
    const event = {
      id: randomUUID(), type: "record.created", occurred_at: NOW.toISOString(), organization_id: DEMO_ORG_ID,
      actor: { id: null, role: "service" }, meta, causation: { depth: 3, chain: ["a", "b", "c"] }, payload: { entity: "lead", id: lead.id, after: {} },
    } as DomainEvent;
    const [run] = await handleEvent(deps, event);
    expect(run).toMatchObject({ workflow_id: wf.id, status: "skipped" });
    expect(run!.error).toContain("depth");
  });

  it("never retriggers a workflow on its own change", async () => {
    // Updating qualification on any lead update would loop forever without the causation chain.
    const def: WorkflowDefinition = {
      trigger: { type: "record.updated", entity: "lead", fields: [] },
      steps: [{ id: "touch", type: "update_record", fields: { next_action: "Call back" } }],
    };
    await insertWorkflow(def);
    const lead = data().leads.find((l) => l.status !== "converted")!;
    const event = {
      id: randomUUID(), type: "record.updated", occurred_at: NOW.toISOString(), organization_id: DEMO_ORG_ID,
      actor: { id: null, role: "service" }, meta, causation: { depth: 0, chain: [] }, payload: { entity: "lead", id: lead.id, changes: { status: { before: "new", after: "contacted" } } },
    } as DomainEvent;
    const runs = await handleEvent(deps, event);
    expect(runs).toHaveLength(1);
    expect(data().automation_executions).toHaveLength(1);
  });

  it("retries a failed run from the failed step without repeating earlier side effects", async () => {
    const def: WorkflowDefinition = {
      trigger: { type: "record.created", entity: "lead" },
      steps: [
        { id: "log", type: "create_activity", activity_type: "system", subject: "Received {{lead.title}}", body: "" },
        { id: "task", type: "create_task", title: "Call {{lead.contact_name}}", task_type: "call", priority: "medium", due_in_business_days: 1, assignee: "record_owner" },
      ],
    };
    await insertWorkflow(def);
    // A lead with no owner, so the task step fails ("no owner") after the activity step succeeded.
    const lead = data().leads[0]!;
    await db.write(DEMO_ORG_ID, (tx) => tx.update("leads", lead.id, { owner_id: null }));
    const event = {
      id: randomUUID(), type: "record.created", occurred_at: NOW.toISOString(), organization_id: DEMO_ORG_ID,
      actor: { id: null, role: "service" }, meta, causation: { depth: 0, chain: [] }, payload: { entity: "lead", id: lead.id, after: {} },
    } as DomainEvent;
    const [failed] = await handleEvent(deps, event);
    expect(failed!.status).toBe("failed");
    expect(failed!.error).toContain("no owner");
    const activitiesBefore = data().activities.filter((a) => a.lead_id === lead.id).length;

    await db.write(DEMO_ORG_ID, (tx) => tx.update("leads", lead.id, { owner_id: DEMO_USER_IDS.repSofia }));
    const retried = await retryExecution(deps, DEMO_ORG_ID, failed!.id);
    expect(retried).toMatchObject({ status: "success", retry_of: failed!.id });
    expect(data().activities.filter((a) => a.lead_id === lead.id).length).toBe(activitiesBefore);
    expect(data().tasks.some((t) => t.title === `Call ${lead.contact_name}` && t.assignee_id === DEMO_USER_IDS.repSofia)).toBe(true);
    await expect(retryExecution(deps, DEMO_ORG_ID, retried.id)).rejects.toThrow(/Only failed/);
  });

  it("fails runs over the per-minute limit and records a security event", async () => {
    const wf = await insertWorkflow({ trigger: { type: "record.created", entity: "lead" }, steps: [{ id: "log", type: "create_activity", activity_type: "note", subject: "x", body: "" }] });
    const lead = data().leads[0]!;
    const fire = () =>
      handleEvent(deps, {
        id: randomUUID(), type: "record.created", occurred_at: NOW.toISOString(), organization_id: DEMO_ORG_ID,
        actor: { id: null, role: "service" }, meta, causation: { depth: 0, chain: [] }, payload: { entity: "lead", id: lead.id, after: {} },
      } as DomainEvent);
    for (let i = 0; i < 30; i++) await fire();
    const [limited] = await fire();
    expect(limited).toMatchObject({ workflow_id: wf.id, status: "failed" });
    expect(data().security_events.some((e) => e.action === "workflow.limit_exceeded")).toBe(true);
  });

  it("test run evaluates steps without side effects and keeps a log", async () => {
    const wf = await insertWorkflow(example("deal_won"));
    const before = data();
    const deal = before.deals.find((d) => d.closed_at === null)!;
    const run = await testRunWorkflow(deps, DEMO_ORG_ID, wf.id, deal.id);
    expect(run.trigger_payload.mode).toBe("test");
    expect(run.status).toBe("success");
    const after = data();
    expect(after.orders.length).toBe(before.orders.length);
    expect(after.notifications.length).toBe(before.notifications.length);
    expect((run.steps as Array<{ output: Record<string, unknown> }>)[0]!.output).toMatchObject({ would_create_order: true });
  });

  it("skips send_email when no provider is configured", async () => {
    await insertWorkflow({ trigger: { type: "record.created", entity: "lead" }, steps: [{ id: "mail", type: "send_email", to: "record_owner", subject: "Hi", body: "" }] });
    const lead = data().leads.find((l) => l.owner_id)!;
    const [run] = await handleEvent(deps, {
      id: randomUUID(), type: "record.created", occurred_at: NOW.toISOString(), organization_id: DEMO_ORG_ID,
      actor: { id: null, role: "service" }, meta, causation: { depth: 0, chain: [] }, payload: { entity: "lead", id: lead.id, after: {} },
    } as DomainEvent);
    expect(run!.status).toBe("skipped");
    expect((run!.steps as Array<{ output: { reason: string } }>)[0]!.output.reason).toContain("No email provider");
  });
});
