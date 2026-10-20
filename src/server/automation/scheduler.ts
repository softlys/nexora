/**
 * The scheduler handles everything time-based:
 *   1. date.reached triggers (e.g. a follow-up task passing its due date), once per task and due date
 *   2. resuming runs that waited on a delay step
 *   3. retrying failed webhook deliveries whose backoff has elapsed
 *   4. a system.heartbeat security event at most every five minutes
 * It is called from the "Run scheduler" button and from POST /api/cron/scheduler.
 * Without an external cron calling that endpoint, nothing time-based happens on its own.
 */
import type { DomainEvent } from "@/domain/events/types";
import { validateDefinition } from "@/domain/automation/logic";
import { emit } from "@/server/services/context";
import { processDueRetries } from "@/server/integrations/webhooks";
import { handleEvent, runWorkflow, SERVICE_ACTOR_ID, type EngineDeps } from "./engine";

export const HEARTBEAT_INTERVAL_MS = 5 * 60_000;

export type SchedulerResult = { dateEvents: number; executions: number; resumed: number; webhookRetries: number; heartbeat: boolean };

export async function runScheduler(deps: EngineDeps, orgId: string): Promise<SchedulerResult> {
  const now = deps.now ? deps.now() : new Date();
  const nowIso = now.toISOString();
  const result: SchedulerResult = { dateEvents: 0, executions: 0, resumed: 0, webhookRetries: 0, heartbeat: false };
  const known = new Set((await deps.db.read(orgId, (tx) => tx.find("automation_executions"))).map((e) => e.id));

  // 1. Date triggers
  const { workflows, tasks, overdueWebhooks } = await deps.db.read(orgId, async (tx) => ({
    workflows: (await tx.find("automation_workflows", { enabled: true, archived_at: null })).filter((w) => {
      const parsed = validateDefinition(w.definition);
      return parsed.ok && parsed.definition.trigger.type === "date.reached";
    }),
    tasks: await tx.find("tasks", { archived_at: null, status: ["todo", "in_progress"] }),
    // Integrations subscribed to task.overdue need the same date events (sent through deps.onEvent).
    overdueWebhooks: (await tx.find("integration_settings", { enabled: true })).some((i) => i.subscribed_events.includes("task.overdue")),
  }));
  if (workflows.length > 0 || (overdueWebhooks && deps.onEvent)) {
    const types = new Set(
      workflows.map((w) => {
        const parsed = validateDefinition(w.definition);
        return parsed.ok && parsed.definition.trigger.type === "date.reached" ? parsed.definition.trigger.task_type : "any";
      }),
    );
    const due = tasks.filter((t) => t.due_at && t.due_at <= nowIso && (overdueWebhooks || types.has("any") || types.has(t.type)));
    for (const task of due) {
      // Deterministic id: the same task and due date is handled once, however often the scheduler runs.
      const event = {
        id: `date.reached:task:${task.id}:${task.due_at}`,
        type: "date.reached",
        occurred_at: nowIso,
        organization_id: orgId,
        actor: { id: null, role: "service" },
        meta: deps.meta,
        causation: { depth: 0, chain: [] },
        payload: { entity: "task", id: task.id, field: "due_at", at: task.due_at!, task_type: task.type },
      } as DomainEvent<"date.reached">;
      result.dateEvents += 1;
      const executions = await handleEvent(deps, event);
      // Earlier runs for the same task and due date are returned, not repeated; count only new ones.
      result.executions += executions.filter((e) => !known.has(e.id)).length;
      executions.forEach((e) => known.add(e.id));
    }
  }

  // 2. Delayed runs
  const waiting = await deps.db.read(orgId, async (tx) => (await tx.find("automation_executions", { status: "running" })).filter((e) => e.resume_at && e.resume_at <= nowIso && e.resume_step_id));
  for (const execution of waiting) {
    const workflow = await deps.db.read(orgId, (tx) => tx.get("automation_workflows", execution.workflow_id));
    if (!workflow) continue;
    const stored = execution.trigger_payload.event as Partial<DomainEvent>;
    const event = { ...stored, organization_id: orgId, actor: { id: null, role: "service" }, meta: deps.meta } as DomainEvent;
    await deps.db.write(orgId, (tx) => tx.update("automation_executions", execution.id, { resume_at: null }));
    const { caused } = await runWorkflow(deps, workflow, event, { resume: { execution, stepId: execution.resume_step_id! } });
    for (const e of caused) await handleEvent(deps, e);
    result.resumed += 1;
  }

  // 3. Webhook retries (exponential backoff, stored per attempt in webhook_deliveries)
  result.webhookRetries = await processDueRetries({ db: deps.db, meta: deps.meta, now: deps.now }, orgId);

  // 4. Heartbeat
  const lastHeartbeat = await deps.db.read(orgId, async (tx) =>
    (await tx.find("security_events", { action: "system.heartbeat" })).reduce<string | null>((a, e) => (!a || e.occurred_at > a ? e.occurred_at : a), null),
  );
  if (!lastHeartbeat || now.getTime() - Date.parse(lastHeartbeat) >= HEARTBEAT_INTERVAL_MS - 30_000) {
    await deps.db.write(orgId, (tx) =>
      emit(
        tx,
        { actor: { id: SERVICE_ACTOR_ID, role: "admin", organization_id: orgId, team_member_ids: [] }, principal: "service", meta: deps.meta, db: deps.db, now: deps.now, deferred: [] },
        { type: "system.heartbeat", payload: { component: "scheduler", date_events: result.dateEvents, resumed: result.resumed } },
      ),
    );
    result.heartbeat = true;
  }
  return result;
}
