/**
 * Workflow definitions: data, never code. A definition is JSON validated by these schemas
 * and stored in automation_workflows.definition. There is no eval, no Function() and no
 * user script anywhere in the engine; templates resolve allowlisted variables only.
 */
import { isCountryCode } from "@/lib/countries";
import { z } from "zod";

export const LIMITS = {
  maxSteps: 20,
  maxRunsPerWorkflowPerMinute: 30,
  stepTimeoutMs: 5_000,
  maxDelayHours: 24 * 30,
  maxCausationDepth: 3,
  maxTemplateLength: 500,
} as const;

// ---------------------------------------------------------------------------
// Variables (allowlist for conditions and templates)
// ---------------------------------------------------------------------------

export const TRIGGER_ENTITIES = ["lead", "deal", "task", "company", "order"] as const;
export type TriggerEntity = (typeof TRIGGER_ENTITIES)[number];

/** The only variables conditions and templates may reference, per trigger entity. */
export const VARIABLES: Record<TriggerEntity, string[]> = {
  lead: ["lead.id", "lead.title", "lead.company_name", "lead.contact_name", "lead.source", "lead.status", "lead.qualification", "lead.country", "lead.estimated_value", "lead.owner_id", "lead.owner_name"],
  deal: ["deal.id", "deal.name", "deal.amount", "deal.currency", "deal.stage", "deal.probability", "deal.expected_close_date", "deal.owner_id", "deal.owner_name", "deal.company_name", "deal.source"],
  task: ["task.id", "task.title", "task.type", "task.priority", "task.status", "task.due_at", "task.assignee_id", "task.assignee_name"],
  company: ["company.id", "company.name", "company.industry", "company.country", "company.lifecycle_stage", "company.owner_id", "company.owner_name"],
  order: ["order.id", "order.order_number", "order.status", "order.total", "order.currency", "order.owner_id", "order.owner_name", "order.company_name"],
};
export const COMMON_VARIABLES = ["event.type", "event.occurred_at", "workflow.name"];

export function variablesFor(entity: TriggerEntity): string[] {
  return [...VARIABLES[entity], ...COMMON_VARIABLES];
}

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

export const triggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("record.created"), entity: z.enum(TRIGGER_ENTITIES) }).strict(),
  z.object({ type: z.literal("record.updated"), entity: z.enum(TRIGGER_ENTITIES), fields: z.array(z.string().max(64)).max(10).default([]) }).strict(),
  z.object({ type: z.literal("deal.stage_changed"), entity: z.literal("deal"), to: z.enum(["won", "lost", "any"]) }).strict(),
  z
    .object({
      type: z.literal("date.reached"),
      entity: z.literal("task"),
      field: z.literal("due_at"),
      task_type: z.enum(["follow_up", "call", "email", "meeting", "todo", "any"]).default("any"),
    })
    .strict(),
  z.object({ type: z.literal("webhook.received"), entity: z.enum(TRIGGER_ENTITIES), event_type: z.string().regex(/^[a-z0-9_.-]{1,64}$/) }).strict(),
]);
export type Trigger = z.infer<typeof triggerSchema>;
export const TRIGGER_TYPES = ["record.created", "record.updated", "deal.stage_changed", "date.reached", "webhook.received"] as const;

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

export const CONDITION_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "in", "contains", "is_empty", "not_empty"] as const;
export const conditionSchema = z
  .object({
    field: z.string().regex(/^[a-z_]+\.[a-z_]+$/),
    op: z.enum(CONDITION_OPS),
    value: z.union([z.string().max(200), z.number(), z.boolean(), z.null(), z.array(z.union([z.string().max(100), z.number()])).max(20)]).optional(),
  })
  .strict();
export type Condition = z.infer<typeof conditionSchema>;

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

const stepId = z.string().regex(/^[a-z0-9_-]{1,40}$/, "Step ids use lowercase letters, digits, - and _");
const text = (max: number = LIMITS.maxTemplateLength) => z.string().trim().max(max);
/** A step target: another step id, or "end" to finish the run. */
const target = z.union([stepId, z.literal("end")]);

export const RECIPIENTS = ["record_owner", "assignee", "managers", "admins"] as const;
export const UPDATE_ALLOWLIST: Partial<Record<TriggerEntity, Record<string, z.ZodType>>> = {
  lead: {
    status: z.enum(["new", "contacted", "qualified", "unqualified"]),
    qualification: z.enum(["cold", "warm", "hot"]),
    next_action: text(255),
  },
  deal: { next_activity: text(255), probability: z.number().int().min(0).max(100) },
  task: { priority: z.enum(["low", "medium", "high", "urgent"]), status: z.enum(["todo", "in_progress", "done", "cancelled"]) },
  company: { lifecycle_stage: z.enum(["prospect", "customer", "partner", "churned"]) },
};

const base = { id: stepId, name: text(80).optional(), next: target.optional() };

export const stepSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("condition"), match: z.enum(["all", "any"]).default("all"), conditions: z.array(conditionSchema).min(1).max(10), then: target, else: target }).strict(),
  z
    .object({
      ...base,
      type: z.literal("assign_owner"),
      rule: z.enum(["round_robin", "by_country"]),
      only_if_unassigned: z.boolean().default(true),
      country_map: z.record(z.string().refine(isCountryCode, "Unknown country code"), z.uuid()).default({}),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("create_task"),
      title: text(200).min(1),
      task_type: z.enum(["follow_up", "call", "email", "meeting", "todo"]).default("follow_up"),
      priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
      due_in_business_days: z.number().int().min(0).max(60).default(1),
      assignee: z.enum(["record_owner", "assignee"]).default("record_owner"),
    })
    .strict(),
  z.object({ ...base, type: z.literal("update_record"), fields: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ ...base, type: z.literal("create_activity"), activity_type: z.enum(["call", "meeting", "email", "note", "follow_up", "system"]).default("system"), subject: text(200).min(1), body: text().default("") }).strict(),
  z
    .object({
      ...base,
      type: z.literal("create_notification"),
      recipients: z.array(z.enum(RECIPIENTS)).min(1).max(4),
      title: text(200).min(1),
      body: text().default(""),
      link: z.enum(["record", "none"]).default("record"),
      /** One notification per workflow, record and recipient. */
      once_per_record: z.boolean().default(true),
    })
    .strict(),
  z.object({ ...base, type: z.literal("convert_deal_to_order") }).strict(),
  z.object({ ...base, type: z.literal("send_email"), to: z.enum(["record_owner", "assignee"]), subject: text(200).min(1), body: text(2000).default("") }).strict(),
  z.object({ ...base, type: z.literal("send_webhook"), event_type: z.string().regex(/^[a-z0-9_.-]{1,64}$/) }).strict(),
  // Team notification to the configured Telegram chat (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID), plain text.
  z.object({ ...base, type: z.literal("send_telegram"), text: text(3500).min(1) }).strict(),
  z
    .object({ ...base, type: z.literal("delay"), hours: z.number().int().min(1).max(LIMITS.maxDelayHours) })
    .strict(),
]);
export type Step = z.infer<typeof stepSchema>;
export type StepType = Step["type"];
export const STEP_TYPES: StepType[] = ["condition", "assign_owner", "create_task", "update_record", "create_activity", "create_notification", "convert_deal_to_order", "send_email", "send_telegram", "send_webhook", "delay"];

export const definitionSchema = z
  .object({
    trigger: triggerSchema,
    steps: z.array(stepSchema).min(1).max(LIMITS.maxSteps, `A workflow can have at most ${LIMITS.maxSteps} steps`),
  })
  .strict();
export type WorkflowDefinition = z.infer<typeof definitionSchema>;

export const STEP_LABELS: Record<StepType, string> = {
  condition: "Condition",
  assign_owner: "Assign owner",
  create_task: "Create task",
  update_record: "Update record",
  create_activity: "Log activity",
  create_notification: "Notify",
  convert_deal_to_order: "Create order from deal",
  send_email: "Send email",
  send_telegram: "Send to Telegram",
  send_webhook: "Send webhook",
  delay: "Wait",
};

export const TRIGGER_LABELS: Record<Trigger["type"], string> = {
  "record.created": "Record created",
  "record.updated": "Record updated",
  "deal.stage_changed": "Deal stage changed",
  "date.reached": "Date reached",
  "webhook.received": "Webhook received",
};
