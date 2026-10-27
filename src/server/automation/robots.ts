/**
 * Robots on pipeline stages (роботы, as in Bitrix24): a one-step workflow that runs when a deal
 * enters a stage — create a task, notify people, e-mail the owner, message the customer on
 * WhatsApp or the team on Telegram, or change the probability. Robots are ordinary Automation
 * Studio workflows (trigger "deal.stage_changed" with to: "stage"), so their runs, history and
 * advanced editing live there.
 */
import { z } from "zod";
import type { Step, WorkflowDefinition } from "@/domain/automation/schema";
import { validateDefinition } from "@/domain/automation/logic";
import { DomainError } from "@/server/repositories/types";
import { tr } from "@/lib/i18n";
import { requireCan, type ServiceContext } from "@/server/services/context";
import { sortedPipelines, sortedStages } from "@/server/services/deals";
import { archiveWorkflow, createWorkflow, listWorkflows, setWorkflowEnabled } from "./workflows";

export const ROBOT_KINDS = ["task", "notify", "email_owner", "whatsapp", "telegram", "probability"] as const;
export type RobotKind = (typeof ROBOT_KINDS)[number];

/** English UI names (translated where shown). */
export const ROBOT_LABELS: Record<RobotKind, string> = {
  task: "Create a task",
  notify: "Notify",
  email_owner: "E-mail the deal owner",
  whatsapp: "WhatsApp to the customer",
  telegram: "Message the team in Telegram",
  probability: "Set the probability",
};

export const robotInput = z
  .object({
    stage_id: z.uuid(),
    kind: z.enum(ROBOT_KINDS),
    text: z.string().trim().max(1000).default(""),
    due_days: z.coerce.number().int().min(0).max(60).default(1),
    task_type: z.enum(["follow_up", "call", "email", "meeting", "todo"]).default("call"),
    recipients: z.enum(["record_owner", "managers", "admins"]).default("record_owner"),
    probability: z.coerce.number().int().min(0).max(100).default(50),
  })
  .strict();

function robotStep(input: z.output<typeof robotInput>): Step {
  const text = input.text || undefined;
  switch (input.kind) {
    case "task":
      return { id: "robot", type: "create_task", title: text ?? tr("Call {{deal.company_name}} about {{deal.name}}"), task_type: input.task_type, priority: "medium", due_in_business_days: input.due_days, assignee: "record_owner" };
    case "notify":
      return { id: "robot", type: "create_notification", recipients: [input.recipients], title: text ?? tr("{{deal.name}} moved to {{deal.stage}}"), body: "{{deal.company_name}}, {{deal.amount}} {{deal.currency}}", link: "record", once_per_record: true };
    case "email_owner":
      return { id: "robot", type: "send_email", to: "record_owner", subject: text ?? tr("{{deal.name}}: {{deal.stage}}"), body: "{{deal.company_name}}, {{deal.amount}} {{deal.currency}}." };
    case "whatsapp":
      return { id: "robot", type: "send_whatsapp", text: text ?? tr("Hello! Your order {{deal.name}} is now at the stage: {{deal.stage}}."), template_name: "", template_language: "ru" };
    case "telegram":
      return { id: "robot", type: "send_telegram", text: text ?? tr("{{deal.name}} ({{deal.company_name}}, {{deal.amount}} {{deal.currency}}) → {{deal.stage}}") };
    case "probability":
      return { id: "robot", type: "update_record", fields: { probability: input.probability } };
  }
}

export function robotDefinition(input: z.output<typeof robotInput>): WorkflowDefinition {
  return { trigger: { type: "deal.stage_changed", entity: "deal", to: "stage", stage_id: input.stage_id }, steps: [robotStep(input)] };
}

/** Adds a robot to a stage and turns it on. */
export async function createRobot(ctx: ServiceContext, input: z.output<typeof robotInput>) {
  requireCan(ctx, "create", "automation");
  const stage = await ctx.db.read(ctx.actor.organization_id, (tx) => tx.get("pipeline_stages", input.stage_id));
  if (!stage) throw new DomainError("Stage not found.", "not_found");
  const definition = robotDefinition(input);
  const checked = validateDefinition(definition);
  if (!checked.ok) throw new DomainError(`The robot is not valid: ${checked.issues[0]?.message ?? "unknown issue"}`);
  const workflow = await createWorkflow(ctx, { name: `${tr(ROBOT_LABELS[input.kind])} · ${tr(stage.name)}`.slice(0, 120), description: tr("Robot on a pipeline stage."), definition });
  return setWorkflowEnabled(ctx, workflow.id, true);
}

export type RobotView = { id: string; name: string; enabled: boolean; kind: Step["type"]; summary: string; runs: number; failed: number };
export type RobotBoard = { pipeline: { id: string; name: string }; pipelines: Array<{ id: string; name: string }>; stages: Array<{ id: string; name: string; is_won: boolean; is_lost: boolean; robots: RobotView[] }> };

const summaryOf = (step: Step): string => {
  switch (step.type) {
    case "create_task":
      return step.title;
    case "create_notification":
      return step.title;
    case "send_email":
      return step.subject;
    case "send_whatsapp":
    case "send_telegram":
      return step.text;
    case "update_record":
      return Object.entries(step.fields)
        .map(([k, v]) => `${k} = ${String(v)}`)
        .join(", ");
    default:
      return "";
  }
};

/** The stages of one pipeline with the robots on each (the robots view of the board). */
export async function robotBoard(ctx: ServiceContext, pipelineId?: string): Promise<RobotBoard> {
  requireCan(ctx, "view", "automation");
  const [workflows, { pipelines, stages }] = await Promise.all([
    listWorkflows(ctx),
    ctx.db.read(ctx.actor.organization_id, async (tx) => ({ pipelines: await sortedPipelines(tx), stages: await sortedStages(tx) })),
  ]);
  const pipeline = pipelines.find((p) => p.id === pipelineId) ?? pipelines[0];
  if (!pipeline) throw new DomainError("Pipeline not found.", "not_found");
  const robots = workflows.flatMap((w) => {
    const parsed = validateDefinition(w.definition);
    if (!parsed.ok || parsed.definition.trigger.type !== "deal.stage_changed" || parsed.definition.trigger.to !== "stage") return [];
    const step = parsed.definition.steps[0]!;
    return [{ stage_id: parsed.definition.trigger.stage_id!, view: { id: w.id, name: w.name, enabled: w.enabled, kind: step.type, summary: summaryOf(step), runs: w.stats.runs, failed: w.stats.failed } }];
  });
  return {
    pipeline: { id: pipeline.id, name: pipeline.name },
    pipelines: pipelines.map((p) => ({ id: p.id, name: p.name })),
    stages: stages.filter((s) => s.pipeline_id === pipeline.id).map((s) => ({ id: s.id, name: s.name, is_won: s.is_won, is_lost: s.is_lost, robots: robots.filter((r) => r.stage_id === s.id).map((r) => r.view) })),
  };
}

export { archiveWorkflow as removeRobot, setWorkflowEnabled as setRobotEnabled };
