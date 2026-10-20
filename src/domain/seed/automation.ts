/**
 * Seeds the three example automations (enabled) and a realistic execution history:
 * successful runs, a few skipped runs (conditions not met) and failed runs that can be retried.
 * Uses its own PRNG stream so adding it does not change the rest of the seed.
 */
import type { AutomationExecution, AutomationWorkflow, Dataset, Notification } from "../entities";
import { EXAMPLE_WORKFLOWS } from "../automation/examples";
import { addBusinessDays } from "../automation/logic";
import { createRng } from "./random";

const DAY = 86_400_000;

export function seedAutomation(data: Dataset, now: Date, adminId: string): Pick<Dataset, "automation_workflows" | "automation_executions"> & { notifications: Notification[] } {
  const rng = createRng(4242);
  const org = data.organizations[0]!.id;
  const created = new Date(now.getTime() - 60 * DAY).toISOString();
  const workflows: AutomationWorkflow[] = EXAMPLE_WORKFLOWS.map((w) => ({
    id: rng.uuid(),
    organization_id: org,
    name: w.name,
    description: w.description,
    trigger_type: w.definition.trigger.type,
    definition: w.definition as unknown as Record<string, unknown>,
    enabled: true,
    version: 1,
    created_by: adminId,
    updated_by: adminId,
    created_at: created,
    updated_at: created,
    archived_at: null,
  }));
  const [newLead, dealWon, overdue] = workflows as [AutomationWorkflow, AutomationWorkflow, AutomationWorkflow];
  const executions: AutomationExecution[] = [];
  const notifications: Notification[] = [];
  const nowIso = now.toISOString();

  const run = (
    wf: AutomationWorkflow,
    eventId: string,
    eventType: string,
    payload: Record<string, unknown>,
    at: string,
    status: AutomationExecution["status"],
    steps: Array<Record<string, unknown>>,
    error: string | null = null,
  ) => {
    const duration = rng.int(40, 900);
    executions.push({
      id: rng.uuid(),
      organization_id: org,
      workflow_id: wf.id,
      workflow_version: 1,
      event_id: eventId,
      idempotency_key: `${wf.id}:${eventId}`,
      trigger_payload: { event: { id: eventId, type: eventType, occurred_at: at, payload, causation: { depth: 0, chain: [] } }, mode: "live" },
      status,
      steps,
      causation_depth: 0,
      retry_of: null,
      error,
      started_at: at,
      finished_at: new Date(Date.parse(at) + duration).toISOString(),
      duration_ms: duration,
      resume_at: null,
      resume_step_id: null,
      created_at: at,
    });
  };
  const step = (step_id: string, type: string, name: string, status: string, at: string, output: Record<string, unknown> = {}, error?: string) => ({
    step_id,
    type,
    name,
    status,
    output,
    ...(error ? { error } : {}),
    started_at: at,
    duration_ms: rng.int(5, 220),
  });

  // New lead: recent leads that already have an owner (assignment skipped) or got one.
  const recentLeads = data.leads.filter((l) => l.status !== "converted" && Date.parse(l.created_at) > now.getTime() - 45 * DAY).slice(0, 8);
  for (const lead of recentLeads) {
    const at = lead.created_at;
    const due = addBusinessDays(new Date(at), 1).toISOString();
    run(newLead, rng.uuid(), "record.created", { entity: "lead", id: lead.id }, at, "success", [
      lead.owner_id
        ? step("assign", "assign_owner", "Assign owner", "skipped", at, { reason: "Lead already has an owner", owner_id: lead.owner_id })
        : step("assign", "assign_owner", "Assign owner", "success", at, { assigned_to: "Round robin", rule: "round_robin" }),
      step("follow-up", "create_task", "Create follow-up task", "success", at, { title: `Follow up with ${lead.contact_name} at ${lead.company_name}`, due_at: due }),
      step("log", "create_activity", "Log activity", "success", at, { subject: "Lead received and assigned" }),
    ]);
  }

  // Deal won: won deals closed in the last 90 days. Ones with an order succeeded; one timed out.
  const won = data.deals.filter((d) => d.closed_at && d.lost_reason === null && data.pipeline_stages.find((s) => s.id === d.stage_id)?.is_won && Date.parse(d.closed_at) > now.getTime() - 90 * DAY);
  won.forEach((deal, i) => {
    const order = data.orders.find((o) => o.source_deal_id === deal.id);
    const at = deal.closed_at!;
    const payload = { deal_id: deal.id, is_won: true, is_lost: false };
    if (order) {
      run(dealWon, rng.uuid(), "deal.stage_changed", payload, at, "success", [
        step("order", "convert_deal_to_order", "Create order", "success", at, { order_id: order.id, order_number: order.order_number, created: true }),
        step("notify", "create_notification", "Notify owner and managers", "success", at, { sent: 2, already_notified: 0 }),
      ]);
    } else if (i % 2 === 0) {
      run(
        dealWon,
        rng.uuid(),
        "deal.stage_changed",
        payload,
        at,
        "failed",
        [step("order", "convert_deal_to_order", "Create order", "failed", at, {}, "Step timed out after 5s")],
        'Step "Create order" failed: Step timed out after 5s',
      );
    }
  });

  // Overdue follow-ups: open ones were notified; ones completed by the time the scheduler ran were skipped.
  const followUps = data.tasks.filter((t) => t.type === "follow_up" && t.due_at && t.due_at < nowIso).slice(0, 14);
  for (const task of followUps) {
    const eventId = `date.reached:task:${task.id}:${task.due_at}`;
    const at = new Date(Math.min(Date.parse(task.due_at!) + rng.int(1, 6) * 3_600_000, now.getTime() - 60_000)).toISOString();
    const open = task.status === "todo" || task.status === "in_progress";
    if (open) {
      run(overdue, eventId, "date.reached", { entity: "task", id: task.id, field: "due_at", task_type: "follow_up" }, at, "success", [
        step("still-open", "condition", "Still open?", "success", at, { result: true, next: "notify" }),
        step("notify", "create_notification", "Notify assignee", "success", at, { sent: 1, already_notified: 0 }),
        step("log", "create_activity", "Log activity", "success", at, { subject: "Follow-up overdue" }),
      ]);
      notifications.push({
        id: rng.uuid(),
        organization_id: org,
        recipient_id: task.assignee_id,
        type: "automation.date.reached",
        title: `Follow-up overdue: ${task.title}`,
        body: `It was due ${task.due_at!.slice(0, 10)}.`,
        link: `/tasks/${task.id}`,
        read_at: rng.chance(0.4) ? at : null,
        dedupe_key: `wf:${overdue.id}:${task.id}:${task.assignee_id}`,
        created_at: at,
      });
    } else if (task.status === "done") {
      // Completed by the time the scheduler looked: the condition ended the run, nothing was sent.
      run(overdue, eventId, "date.reached", { entity: "task", id: task.id, field: "due_at", task_type: "follow_up" }, at, "skipped", [
        step("still-open", "condition", "Still open?", "success", at, { result: false, next: "end" }),
      ]);
    }
  }

  return { automation_workflows: workflows, automation_executions: executions.sort((a, b) => a.started_at.localeCompare(b.started_at)), notifications };
}
