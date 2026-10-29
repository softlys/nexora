/**
 * NEXORA automation engine.
 *
 * - Workflows are data (src/domain/automation/schema.ts). Nothing here evaluates code.
 * - Runs act as a service principal with explicit scopes: update_record touches only
 *   allowlisted fields of allowlisted entities; there is no step that can change roles,
 *   API keys, integration settings or permissions.
 * - Every run writes an automation_executions row with the trigger payload, per-step
 *   results, status, duration and error.
 * - Idempotency: key = workflow id + event id; a repeated event returns the earlier run.
 * - Loop protection: events caused by a workflow carry a causation chain; the engine stops
 *   at depth 3 and never runs a workflow for an event its own run caused.
 * - Limits: steps per workflow (schema), runs per workflow per minute, step timeout, delay length.
 *
 * Each step runs in its own unit of work so a step may call other services
 * (convertDealToOrder) without nesting writes.
 */
import type { TelegramSender } from "@/server/integrations/telegram";
import { randomUUID } from "node:crypto";
import { formatDate } from "@/lib/format";
import type { AutomationExecution, AutomationWorkflow, Profile } from "@/domain/entities";
import type { DomainEvent } from "@/domain/events/types";
import { addBusinessDays, evaluateConditions, nextStepId, renderTemplate, validateDefinition, type Vars } from "@/domain/automation/logic";
import { LIMITS, UPDATE_ALLOWLIST, variablesFor, type Step, type TriggerEntity, type WorkflowDefinition } from "@/domain/automation/schema";
import type { Db, Tx } from "@/server/db/types";
import { UniqueViolation } from "@/server/db/types";
import type { RequestMeta } from "@/server/repositories/types";
import { emit, emitSecurity, flushSecurityEvents, type ServiceContext } from "@/server/services/context";
import { convertDealToOrder } from "@/server/services/orders";
import { waNumber, type NotionWriter, type SlackSender, type WhatsAppSender } from "@/server/integrations/messaging";

export const SERVICE_ACTOR_ID = "00000000-0000-4000-8000-00000000a070";

export type EmailMessage = { to: string; subject: string; text: string; /** Where replies go, e.g. the sending user. */ replyTo?: string; /** Message-ID being answered, so the reply joins the customer's thread. */ inReplyTo?: string };
export interface EmailSender {
  readonly configured: boolean;
  send(message: EmailMessage): Promise<{ id: string }>;
}
/** Outbound webhooks, delivered by the integrations module (src/server/integrations/webhooks.ts). */
export interface WebhookSender {
  readonly available: boolean;
  send(input: { organization_id: string; event_id: string; event_type: string; data: Record<string, unknown> }): Promise<{ delivered: number; attempted: number }>;
}

export type EngineDeps = {
  db: Db;
  meta: RequestMeta;
  now?: () => Date;
  email?: EmailSender;
  telegram?: TelegramSender;
  whatsapp?: WhatsAppSender;
  slack?: SlackSender;
  notion?: NotionWriter;
  /** Base URL for links in messages and Notion pages. */
  baseUrl?: string;
  webhooks?: WebhookSender;
  /** Called for every event the engine handles, including events its runs caused (outbound webhooks). */
  onEvent?: (event: DomainEvent) => Promise<void>;
};

type StepResult = {
  step_id: string;
  type: Step["type"];
  name: string | null;
  status: "success" | "failed" | "skipped";
  output?: Record<string, unknown>;
  error?: string;
  started_at: string;
  duration_ms: number;
};

const nowOf = (deps: EngineDeps) => (deps.now ? deps.now() : new Date());

/** Service-principal context for a run. Admin-level visibility, but every step enforces its own scope. */
function serviceContext(deps: EngineDeps, orgId: string, causation: { depth: number; chain: string[] }): ServiceContext {
  return {
    actor: { id: SERVICE_ACTOR_ID, role: "admin", organization_id: orgId, team_member_ids: [] },
    principal: "service",
    meta: deps.meta,
    db: deps.db,
    now: deps.now,
    causation,
    deferred: [],
    pendingEvents: [],
  };
}

// ---------------------------------------------------------------------------
// Trigger matching and record context
// ---------------------------------------------------------------------------

type Target = { entity: TriggerEntity; id: string };

function targetOf(event: DomainEvent): Target | null {
  const p = event.payload as Record<string, unknown>;
  switch (event.type) {
    case "record.created":
    case "record.updated":
    case "date.reached":
      return ["lead", "deal", "task", "company", "order"].includes(p.entity as string) ? { entity: p.entity as TriggerEntity, id: p.id as string } : null;
    case "deal.stage_changed":
      return { entity: "deal", id: p.deal_id as string };
    case "webhook.received": {
      const data = (p.data ?? {}) as Record<string, unknown>;
      return typeof data.entity === "string" && typeof data.id === "string" ? { entity: data.entity as TriggerEntity, id: data.id } : null;
    }
    default:
      return null;
  }
}

export function triggerMatches(def: WorkflowDefinition, event: DomainEvent): boolean {
  const t = def.trigger;
  if (t.type !== event.type) return false;
  const p = event.payload as Record<string, unknown>;
  switch (t.type) {
    case "record.created":
      return p.entity === t.entity;
    case "record.updated": {
      if (p.entity !== t.entity) return false;
      const changed = Object.keys((p.changes ?? {}) as Record<string, unknown>);
      return t.fields.length === 0 || t.fields.some((f) => changed.includes(f));
    }
    case "deal.stage_changed":
      return t.to === "any" || (t.to === "won" && p.is_won === true) || (t.to === "lost" && p.is_lost === true) || (t.to === "stage" && !!t.stage_id && p.to_stage_id === t.stage_id);
    case "date.reached":
      return p.entity === "task" && p.field === "due_at" && (t.task_type === "any" || p.task_type === t.task_type);
    case "webhook.received":
      return p.event_type === t.event_type;
  }
}

async function profileName(tx: Tx, id: string | null): Promise<string | null> {
  if (!id) return null;
  return (await tx.get("profiles", id))?.full_name ?? null;
}

/** Builds the allowlisted variables for a record. Returns null when the record no longer exists. */
export async function recordVars(tx: Tx, target: Target): Promise<{ vars: Vars; ownerId: string | null; record: Record<string, unknown> } | null> {
  switch (target.entity) {
    case "lead": {
      const r = await tx.get("leads", target.id);
      if (!r) return null;
      return {
        record: r,
        ownerId: r.owner_id,
        vars: {
          "lead.id": r.id, "lead.title": r.title, "lead.company_name": r.company_name, "lead.contact_name": r.contact_name, "lead.source": r.source,
          "lead.status": r.status, "lead.qualification": r.qualification, "lead.country": r.country, "lead.estimated_value": r.estimated_value,
          "lead.owner_id": r.owner_id, "lead.owner_name": await profileName(tx, r.owner_id),
        },
      };
    }
    case "deal": {
      const r = await tx.get("deals", target.id);
      if (!r) return null;
      const [stage, company] = await Promise.all([tx.get("pipeline_stages", r.stage_id), tx.get("companies", r.company_id)]);
      return {
        record: r,
        ownerId: r.owner_id,
        vars: {
          "deal.id": r.id, "deal.name": r.name, "deal.amount": r.amount, "deal.currency": r.currency, "deal.stage": stage?.name ?? null,
          "deal.probability": r.probability, "deal.expected_close_date": r.expected_close_date, "deal.owner_id": r.owner_id,
          "deal.owner_name": await profileName(tx, r.owner_id), "deal.company_name": company?.name ?? null, "deal.source": r.source,
        },
      };
    }
    case "task": {
      const r = await tx.get("tasks", target.id);
      if (!r) return null;
      return {
        record: r,
        ownerId: r.assignee_id,
        vars: {
          "task.id": r.id, "task.title": r.title, "task.type": r.type, "task.priority": r.priority, "task.status": r.status,
          "task.due_at": r.due_at ? r.due_at.slice(0, 10) : null, "task.assignee_id": r.assignee_id, "task.assignee_name": await profileName(tx, r.assignee_id),
        },
      };
    }
    case "company": {
      const r = await tx.get("companies", target.id);
      if (!r) return null;
      return {
        record: r,
        ownerId: r.owner_id,
        vars: {
          "company.id": r.id, "company.name": r.name, "company.industry": r.industry, "company.country": r.country,
          "company.lifecycle_stage": r.lifecycle_stage, "company.owner_id": r.owner_id, "company.owner_name": await profileName(tx, r.owner_id),
        },
      };
    }
    case "order": {
      const r = await tx.get("orders", target.id);
      if (!r) return null;
      const company = await tx.get("companies", r.company_id);
      return {
        record: r,
        ownerId: r.owner_id,
        vars: {
          "order.id": r.id, "order.order_number": r.order_number, "order.status": r.status, "order.total": r.total, "order.currency": r.currency,
          "order.owner_id": r.owner_id, "order.owner_name": await profileName(tx, r.owner_id), "order.company_name": company?.name ?? null,
        },
      };
    }
  }
}

const RECORD_PATH: Record<TriggerEntity, string> = { lead: "/leads", deal: "/deals", task: "/tasks", company: "/companies", order: "/orders" };

// ---------------------------------------------------------------------------
// Step execution
// ---------------------------------------------------------------------------

type RunState = {
  workflow: AutomationWorkflow;
  definition: WorkflowDefinition;
  target: Target;
  event: DomainEvent;
  mode: "live" | "test";
};

type StepOutcome = { status: StepResult["status"]; output?: Record<string, unknown>; error?: string; conditionResult?: boolean; resumeAt?: string };

class StepTimeout extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new StepTimeout(`Step timed out after ${ms / 1000}s`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

async function resolveRecipients(tx: Tx, kinds: readonly string[], ownerId: string | null, record: Record<string, unknown>): Promise<string[]> {
  const profiles = (await tx.find("profiles")).filter((p: Profile) => p.is_active && !p.archived_at);
  const out = new Set<string>();
  for (const kind of kinds) {
    if (kind === "record_owner" && ownerId) out.add(ownerId);
    if (kind === "assignee" && typeof record.assignee_id === "string") out.add(record.assignee_id);
    if (kind === "managers") profiles.filter((p) => p.role === "manager").forEach((p) => out.add(p.id));
    if (kind === "admins") profiles.filter((p) => p.role === "admin").forEach((p) => out.add(p.id));
  }
  return [...out].filter((id) => profiles.some((p) => p.id === id));
}

async function executeStep(deps: EngineDeps, svc: ServiceContext, state: RunState, step: Step): Promise<StepOutcome> {
  const orgId = state.workflow.organization_id;
  const entity = state.target.entity;
  const allowed = variablesFor(entity);
  const test = state.mode === "test";
  const now = nowOf(deps);

  const load = () =>
    deps.db.read(orgId, async (tx) => {
      const ctx = await recordVars(tx, state.target);
      if (!ctx) throw new Error(`The ${entity} no longer exists.`);
      ctx.vars["event.type"] = state.event.type;
      ctx.vars["event.occurred_at"] = state.event.occurred_at;
      ctx.vars["workflow.name"] = state.workflow.name;
      return ctx;
    });
  // Conditions compare raw ISO dates; text shown to people uses the app's date format.
  const display = (vars: Vars): Vars =>
    Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, typeof v === "string" && /(_at|_date)$/.test(k) && /^\d{4}-\d{2}-\d{2}/.test(v) ? formatDate(v) : v])) as Vars;
  const render = (template: string, vars: Vars) => renderTemplate(template, display(vars), allowed);

  switch (step.type) {
    case "condition": {
      const { vars } = await load();
      const result = evaluateConditions(step.conditions, step.match, vars);
      return { status: "success", conditionResult: result, output: { result, next: result ? step.then : step.else } };
    }

    case "assign_owner": {
      const { record } = await load();
      if (step.only_if_unassigned && record.owner_id) return { status: "skipped", output: { reason: "Lead already has an owner", owner_id: record.owner_id } };
      return deps.db[test ? "read" : "write"](orgId, async (tx) => {
        const reps = (await tx.find("profiles")).filter((p) => p.role === "sales_rep" && p.is_active && !p.archived_at).sort((a, b) => a.full_name.localeCompare(b.full_name));
        if (reps.length === 0) return { status: "failed" as const, error: "No active sales reps to assign" };
        let ownerId: string | undefined;
        let rule: string = step.rule;
        const country = record.country as string | null;
        if (step.rule === "by_country" && country && step.country_map[country]) {
          const mapped = reps.find((r) => r.id === step.country_map[country]);
          if (mapped) ownerId = mapped.id;
        }
        if (!ownerId) {
          rule = "round_robin";
          const leads = (await tx.find("leads")).filter((l) => l.id !== state.target.id && l.owner_id && reps.some((r) => r.id === l.owner_id)).sort((a, b) => b.created_at.localeCompare(a.created_at));
          const last = leads[0]?.owner_id;
          const idx = last ? reps.findIndex((r) => r.id === last) : -1;
          ownerId = reps[(idx + 1) % reps.length]!.id;
        }
        const owner = reps.find((r) => r.id === ownerId)!;
        if (test) return { status: "success" as const, output: { would_assign: owner.full_name, rule } };
        await tx.update("leads", state.target.id, { owner_id: owner.id, updated_at: now.toISOString() });
        await emit(tx, svc, { type: "record.updated", payload: { entity: "lead", id: state.target.id, changes: { owner_id: { before: record.owner_id ?? null, after: owner.id } } } });
        await emit(tx, svc, { type: "record.owner_changed", payload: { entity: "lead", id: state.target.id, from: (record.owner_id as string | null) ?? null, to: owner.id } });
        return { status: "success" as const, output: { assigned_to: owner.full_name, owner_id: owner.id, rule } };
      });
    }

    case "create_task": {
      const { vars, ownerId, record } = await load();
      const assignee = step.assignee === "assignee" ? (record.assignee_id as string | null) : ownerId;
      if (!assignee) return { status: "failed", error: "The record has no owner to assign the task to" };
      const title = render(step.title, vars);
      const due = addBusinessDays(now, step.due_in_business_days).toISOString();
      if (test) return { status: "success", output: { would_create: title, assignee_id: assignee, due_at: due } };
      return deps.db.write(orgId, async (tx) => {
        const links = {
          company_id: entity === "company" ? state.target.id : ((record.company_id as string | null) ?? null),
          contact_id: entity === "lead" ? ((record.contact_id as string | null) ?? null) : ((record.contact_id as string | null) ?? (record.primary_contact_id as string | null) ?? null),
          deal_id: entity === "deal" ? state.target.id : ((record.deal_id as string | null) ?? null),
          order_id: entity === "order" ? state.target.id : ((record.order_id as string | null) ?? null),
        };
        const at = now.toISOString();
        const task = {
          id: randomUUID(),
          organization_id: orgId,
          title,
          description: `Created by automation "${state.workflow.name}".`,
          type: step.task_type,
          assignee_id: assignee,
          created_by: null,
          due_at: due,
          priority: step.priority,
          status: "todo" as const,
          completed_at: null,
          ...links,
          created_at: at,
          updated_at: at,
          archived_at: null,
        };
        await tx.insert("tasks", task);
        await emit(tx, svc, { type: "record.created", payload: { entity: "task", id: task.id, after: task } });
        return { status: "success" as const, output: { task_id: task.id, title, assignee_id: assignee, due_at: due } };
      });
    }

    case "update_record": {
      const allowlist = UPDATE_ALLOWLIST[entity];
      if (!allowlist) return { status: "failed", error: `${entity} records cannot be updated by automations` };
      const patch: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(step.fields)) {
        const schema = allowlist[field];
        if (!schema) {
          emitSecurity(svc, { type: "authz.denied", payload: { action: "update", resource: entity, target_id: state.target.id, reason: "forbidden_field" } });
          return { status: "failed", error: `Field "${field}" is not allowed` };
        }
        const parsed = schema.safeParse(value);
        if (!parsed.success) return { status: "failed", error: `Invalid value for "${field}"` };
        patch[field] = parsed.data;
      }
      const { record } = await load();
      if (test) return { status: "success", output: { would_update: patch } };
      const table = ({ lead: "leads", deal: "deals", task: "tasks", company: "companies", order: "orders" } as const)[entity];
      return deps.db.write(orgId, async (tx) => {
        const changes = Object.fromEntries(Object.entries(patch).filter(([k, v]) => record[k] !== v).map(([k, v]) => [k, { before: record[k] ?? null, after: v }]));
        if (Object.keys(changes).length === 0) return { status: "skipped" as const, output: { reason: "Already up to date" } };
        await tx.update(table, state.target.id, { ...patch, updated_at: now.toISOString() } as never);
        await emit(tx, svc, { type: "record.updated", payload: { entity, id: state.target.id, changes } });
        return { status: "success" as const, output: { updated: Object.keys(changes) } };
      });
    }

    case "create_activity": {
      const { vars, record } = await load();
      const subject = render(step.subject, vars);
      const body = render(step.body, vars);
      if (test) return { status: "success", output: { would_log: subject } };
      return deps.db.write(orgId, async (tx) => {
        const at = now.toISOString();
        const activity = {
          id: randomUUID(),
          organization_id: orgId,
          type: step.activity_type,
          subject,
          body,
          occurred_at: at,
          actor_id: null,
          company_id: entity === "company" ? state.target.id : ((record.company_id as string | null) ?? null),
          contact_id: (record.contact_id as string | null) ?? (record.primary_contact_id as string | null) ?? null,
          lead_id: entity === "lead" ? state.target.id : null,
          deal_id: entity === "deal" ? state.target.id : ((record.deal_id as string | null) ?? null),
          order_id: entity === "order" ? state.target.id : ((record.order_id as string | null) ?? null),
          created_at: at,
          updated_at: at,
        };
        await tx.insert("activities", activity);
        await emit(tx, svc, { type: "record.created", payload: { entity: "activity", id: activity.id, after: { subject } } });
        return { status: "success" as const, output: { activity_id: activity.id, subject } };
      });
    }

    case "create_notification": {
      const { vars, ownerId, record } = await load();
      const title = render(step.title, vars);
      const body = render(step.body, vars);
      const link = step.link === "record" ? `${RECORD_PATH[entity]}/${state.target.id}` : null;
      return deps.db[test ? "read" : "write"](orgId, async (tx) => {
        const recipients = await resolveRecipients(tx, step.recipients, ownerId, record);
        if (recipients.length === 0) return { status: "skipped" as const, output: { reason: "No recipients" } };
        if (test) return { status: "success" as const, output: { would_notify: recipients.length, title } };
        let sent = 0;
        let duplicates = 0;
        for (const recipient of recipients) {
          try {
            await tx.insert("notifications", {
              id: randomUUID(),
              organization_id: orgId,
              recipient_id: recipient,
              type: `automation.${state.event.type}`,
              title,
              body,
              link,
              read_at: null,
              dedupe_key: step.once_per_record ? `wf:${state.workflow.id}:${state.target.id}:${recipient}` : null,
              created_at: now.toISOString(),
            });
            sent += 1;
          } catch (error) {
            if (error instanceof UniqueViolation) duplicates += 1;
            else throw error;
          }
        }
        return { status: sent === 0 ? ("skipped" as const) : ("success" as const), output: { sent, already_notified: duplicates } };
      });
    }

    case "convert_deal_to_order": {
      if (entity !== "deal") return { status: "failed", error: "Create order needs a deal trigger" };
      if (test) {
        const existing = await deps.db.read(orgId, (tx) => tx.find("orders", { source_deal_id: state.target.id }));
        return { status: "success", output: existing[0] ? { would_reuse: existing[0].order_number } : { would_create_order: true } };
      }
      const { order, created } = await convertDealToOrder(svc, state.target.id);
      return { status: "success", output: { order_id: order.id, order_number: order.order_number, created } };
    }

    case "send_email": {
      if (!deps.email?.configured) return { status: "skipped", output: { reason: "No email provider is configured, so nothing was sent" } };
      const { vars, ownerId, record } = await load();
      const to = step.to === "assignee" ? (record.assignee_id as string | null) : ownerId;
      const profile = to ? await deps.db.read(orgId, (tx) => tx.get("profiles", to)) : null;
      if (!profile) return { status: "skipped", output: { reason: "No recipient" } };
      if (test) return { status: "success", output: { would_email: profile.full_name } };
      const result = await deps.email.send({ to: profile.email, subject: render(step.subject, vars), text: render(step.body, vars) });
      return { status: "success", output: { provider_id: result.id } };
    }

    case "send_telegram": {
      if (!deps.telegram?.configured) return { status: "skipped", output: { reason: "Telegram is not configured (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID), so nothing was sent" } };
      const { vars } = await load();
      const text = render(step.text, vars);
      if (test) return { status: "success", output: { would_send: text.slice(0, 200) } };
      const result = await deps.telegram.send(text);
      return { status: "success", output: { message_id: result.message_id } };
    }

    case "send_whatsapp": {
      if (!deps.whatsapp?.configured) return { status: "skipped", output: { reason: "WhatsApp is not configured (WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID), so nothing was sent" } };
      const { vars, record } = await load();
      let phone = (record.messengers as Record<string, string> | undefined)?.whatsapp ?? (record.phone as string | null) ?? null;
      if (!phone && typeof record.primary_contact_id === "string") {
        const contact = await deps.db.read(orgId, (tx) => tx.get("contacts", record.primary_contact_id as string));
        phone = contact?.messengers?.whatsapp ?? contact?.phone ?? null;
      }
      if (!phone && typeof record.contact_id === "string") {
        const contact = await deps.db.read(orgId, (tx) => tx.get("contacts", record.contact_id as string));
        phone = contact?.messengers?.whatsapp ?? contact?.phone ?? null;
      }
      const to = waNumber(phone);
      if (!to) return { status: "skipped", output: { reason: "The record has no phone or WhatsApp number" } };
      const message = render(step.text, vars);
      if (test) return { status: "success", output: { would_send_to: `+${to}`, text: message.slice(0, 200) } };
      const result = await deps.whatsapp.send({ to, text: message, template: step.template_name ? { name: step.template_name, language: step.template_language } : null });
      return { status: "success", output: { message_id: result.message_id } };
    }

    case "send_slack": {
      if (!deps.slack?.configured) return { status: "skipped", output: { reason: "Slack is not configured (SLACK_WEBHOOK_URL), so nothing was sent" } };
      const { vars } = await load();
      const message = render(step.text, vars);
      if (test) return { status: "success", output: { would_send: message.slice(0, 200) } };
      await deps.slack.send(message);
      return { status: "success", output: { sent: true } };
    }

    case "create_notion_page": {
      if (!deps.notion?.configured) return { status: "skipped", output: { reason: "Notion is not configured (NOTION_TOKEN, NOTION_DATABASE_ID), so no page was created" } };
      const { vars } = await load();
      const title = render(step.title, vars);
      if (test) return { status: "success", output: { would_create: title } };
      const entityPath = ({ lead: "leads", deal: "deals", company: "companies", contact: "contacts", order: "orders", task: "tasks" } as Record<string, string>)[entity] ?? null;
      const page = await deps.notion.createPage({ title, body: render(step.body, vars), url: deps.baseUrl && entityPath ? `${deps.baseUrl}/${entityPath}/${state.target.id}` : undefined });
      return { status: "success", output: { notion_page: page.url || page.id } };
    }

    case "send_webhook": {
      if (!deps.webhooks?.available) return { status: "skipped", output: { reason: "Outbound webhooks are not available; nothing was sent" } };
      const { vars } = await load();
      if (test) return { status: "success", output: { would_send: step.event_type } };
      // Stable id per workflow, triggering event and step: a retried run resends the same event id.
      const result = await deps.webhooks.send({ organization_id: orgId, event_id: `${state.workflow.id}:${state.event.id}:${step.id}`, event_type: step.event_type, data: vars });
      if (result.attempted === 0) return { status: "skipped", output: { reason: "No enabled integration subscribes to workflow.webhook" } };
      if (result.delivered === 0) return { status: "failed", error: "Every webhook delivery failed; failed attempts are retried by the scheduler (see the delivery log)", output: result };
      return { status: "success", output: result };
    }

    case "delay": {
      const resumeAt = new Date(now.getTime() + step.hours * 3_600_000).toISOString();
      if (test) return { status: "success", output: { would_wait_until: resumeAt } };
      return { status: "success", output: { resume_at: resumeAt }, resumeAt };
    }
  }
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

export type RunOptions = {
  mode?: "live" | "test";
  idempotencyKey?: string;
  retryOf?: AutomationExecution;
  /** Resume an existing execution (delay steps) from this step. */
  resume?: { execution: AutomationExecution; stepId: string };
};

function baseExecution(workflow: AutomationWorkflow, event: DomainEvent, key: string, at: string, opts: RunOptions): AutomationExecution {
  return {
    id: randomUUID(),
    organization_id: workflow.organization_id,
    workflow_id: workflow.id,
    workflow_version: workflow.version,
    event_id: event.id,
    idempotency_key: key,
    trigger_payload: { event: { id: event.id, type: event.type, occurred_at: event.occurred_at, payload: event.payload, causation: event.causation }, mode: opts.mode ?? "live" },
    status: "running",
    steps: [],
    causation_depth: event.causation.depth,
    retry_of: opts.retryOf?.id ?? null,
    error: null,
    started_at: at,
    finished_at: null,
    duration_ms: null,
    resume_at: null,
    resume_step_id: null,
    created_at: at,
  };
}

async function finish(deps: EngineDeps, execution: AutomationExecution, patch: Partial<AutomationExecution>): Promise<AutomationExecution> {
  const finishedAt = nowOf(deps).toISOString();
  const full = { ...patch, finished_at: patch.status === "running" ? null : finishedAt, duration_ms: patch.status === "running" ? null : Math.max(0, Date.parse(finishedAt) - Date.parse(execution.started_at)) };
  return deps.db.write(execution.organization_id, (tx) => tx.update("automation_executions", execution.id, full));
}

/**
 * Runs one workflow for one event. Returns the execution (an earlier one when the same
 * event was already handled).
 */
export async function runWorkflow(deps: EngineDeps, workflow: AutomationWorkflow, event: DomainEvent, opts: RunOptions = {}): Promise<{ execution: AutomationExecution; caused: DomainEvent[] }> {
  const orgId = workflow.organization_id;
  const mode = opts.mode ?? "live";
  const now = nowOf(deps);
  const key = opts.idempotencyKey ?? `${workflow.id}:${event.id}`;
  const causation = { depth: event.causation.depth + 1, chain: [...event.causation.chain, workflow.id] };
  const svc = serviceContext(deps, orgId, causation);

  let execution: AutomationExecution;
  let previousSteps: StepResult[] = [];
  if (opts.resume) {
    execution = opts.resume.execution;
    previousSteps = execution.steps as StepResult[];
  } else {
    // Idempotency: one execution per workflow and event.
    const existing = await deps.db.read(orgId, (tx) => tx.find("automation_executions", { idempotency_key: key }));
    if (existing[0]) return { execution: existing[0], caused: [] };

    // Rate limit per workflow (live runs only).
    if (mode === "live") {
      const since = new Date(now.getTime() - 60_000).toISOString();
      const recent = await deps.db.read(orgId, (tx) => tx.find("automation_executions", { workflow_id: workflow.id }));
      if (recent.filter((e) => e.started_at >= since).length >= LIMITS.maxRunsPerWorkflowPerMinute) {
        const failed = baseExecution(workflow, event, key, now.toISOString(), opts);
        failed.status = "failed";
        failed.error = `Limit exceeded: more than ${LIMITS.maxRunsPerWorkflowPerMinute} runs per minute`;
        failed.finished_at = failed.started_at;
        failed.duration_ms = 0;
        await deps.db.write(orgId, async (tx) => {
          await tx.insert("automation_executions", failed);
          await emit(tx, svc, { type: "workflow.limit_exceeded", payload: { target: { type: "workflow", id: workflow.id }, limit: "runs_per_minute", value: LIMITS.maxRunsPerWorkflowPerMinute } });
        });
        return { execution: failed, caused: [] };
      }
    }

    execution = baseExecution(workflow, event, key, now.toISOString(), opts);
    try {
      await deps.db.write(orgId, (tx) => tx.insert("automation_executions", execution));
    } catch (error) {
      if (error instanceof UniqueViolation) {
        const earlier = await deps.db.read(orgId, (tx) => tx.find("automation_executions", { idempotency_key: key }));
        if (earlier[0]) return { execution: earlier[0], caused: [] };
      }
      throw error;
    }
  }

  // Validate before every run: a workflow edited into an invalid state never executes.
  const validation = validateDefinition(workflow.definition);
  if (!validation.ok) {
    const done = await finish(deps, execution, { status: "failed", error: `Invalid workflow: ${validation.issues[0]?.message ?? "unknown issue"}` });
    return { execution: done, caused: [] };
  }
  const definition = validation.definition;
  const target = targetOf(event);
  if (!target || target.entity !== definition.trigger.entity) {
    const done = await finish(deps, execution, { status: "skipped", error: "The event does not refer to a record this workflow handles" });
    return { execution: done, caused: [] };
  }

  const state: RunState = { workflow, definition, target, event, mode };
  const steps = definition.steps;
  const results: StepResult[] = [...previousSteps];
  // Steps that already succeeded in the run being retried are not repeated.
  const alreadyDone = new Set((opts.retryOf?.steps as StepResult[] | undefined)?.filter((s) => s.status !== "failed").map((s) => s.step_id) ?? []);
  let currentId: string | "end" = opts.resume?.stepId ?? steps[0]!.id;
  let failure: string | null = null;
  let resumeAt: string | null = null;
  let resumeStep: string | null = null;

  while (currentId !== "end") {
    const index = steps.findIndex((s) => s.id === currentId);
    if (index < 0) {
      failure = `Unknown step "${currentId}"`;
      break;
    }
    const step = steps[index]!;
    const startedAt = nowOf(deps).toISOString();
    const t0 = Date.now();

    if (alreadyDone.has(step.id) && step.type !== "condition") {
      const prior = (opts.retryOf!.steps as StepResult[]).find((s) => s.step_id === step.id)!;
      results.push({ ...prior, output: { ...prior.output, reused_from_run: opts.retryOf!.id } });
      currentId = nextStepId(steps, index);
      continue;
    }

    let outcome: StepOutcome;
    try {
      outcome = await withTimeout(executeStep(deps, svc, state, step), LIMITS.stepTimeoutMs);
    } catch (error) {
      if (error instanceof StepTimeout) {
        emitSecurity(svc, { type: "workflow.limit_exceeded", payload: { target: { type: "workflow", id: workflow.id }, limit: "step_timeout", step_id: step.id } });
      }
      outcome = { status: "failed", error: error instanceof Error ? error.message : "Step failed" };
    }
    results.push({ step_id: step.id, type: step.type, name: step.name ?? null, status: outcome.status, output: outcome.output, error: outcome.error, started_at: startedAt, duration_ms: Date.now() - t0 });

    if (outcome.status === "failed") {
      failure = `Step "${step.name ?? step.id}" failed: ${outcome.error ?? "unknown error"}`;
      break;
    }
    const next = nextStepId(steps, index, outcome.conditionResult);
    if (outcome.resumeAt) {
      resumeAt = outcome.resumeAt;
      resumeStep = next === "end" ? null : next;
      break;
    }
    currentId = next;
  }

  let status: AutomationExecution["status"];
  if (failure) status = "failed";
  else if (resumeAt && resumeStep) status = "running";
  else {
    // Skipped when nothing acted: every action step was skipped, or conditions ended the run first.
    const actions = results.filter((r) => r.type !== "condition");
    status = actions.length === 0 || actions.every((r) => r.status === "skipped") ? "skipped" : "success";
  }

  const done = await finish(deps, execution, {
    status,
    steps: results as unknown as Record<string, unknown>[],
    error: failure,
    resume_at: status === "running" ? resumeAt : null,
    resume_step_id: status === "running" ? resumeStep : null,
  });
  await flushSecurityEvents(svc);
  return { execution: done, caused: mode === "live" ? (svc.pendingEvents ?? []) : [] };
}

async function enabledWorkflows(deps: EngineDeps, orgId: string): Promise<AutomationWorkflow[]> {
  return deps.db.read(orgId, async (tx) => (await tx.find("automation_workflows", { enabled: true, archived_at: null })).sort((a, b) => a.created_at.localeCompare(b.created_at)));
}

/**
 * Runs every enabled workflow whose trigger matches the event, then the events those runs
 * caused, breadth-first, until the causation depth limit.
 */
export async function handleEvent(deps: EngineDeps, event: DomainEvent): Promise<AutomationExecution[]> {
  const out: AutomationExecution[] = [];
  const queue: DomainEvent[] = [event];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (deps.onEvent) {
      try {
        await deps.onEvent(current);
      } catch (error) {
        console.error(`[automation] onEvent failed for ${current.type}`, error);
      }
    }
    const workflows = await enabledWorkflows(deps, current.organization_id);
    for (const workflow of workflows) {
      const parsed = validateDefinition(workflow.definition);
      if (!parsed.ok || !triggerMatches(parsed.definition, current)) continue;
      if (current.causation.chain.includes(workflow.id)) continue; // never retrigger itself
      if (current.causation.depth >= LIMITS.maxCausationDepth) {
        const key = `${workflow.id}:${current.id}`;
        const exists = await deps.db.read(current.organization_id, (tx) => tx.find("automation_executions", { idempotency_key: key }));
        if (exists[0]) continue;
        const skipped = baseExecution(workflow, current, key, nowOf(deps).toISOString(), {});
        skipped.status = "skipped";
        skipped.error = `Stopped: causation depth ${current.causation.depth} reached the limit of ${LIMITS.maxCausationDepth}`;
        skipped.finished_at = skipped.started_at;
        skipped.duration_ms = 0;
        await deps.db.write(current.organization_id, (tx) => tx.insert("automation_executions", skipped));
        out.push(skipped);
        continue;
      }
      const { execution, caused } = await runWorkflow(deps, workflow, current);
      out.push(execution);
      queue.push(...caused);
    }
  }
  return out;
}

/**
 * Manually retries a failed run. Steps that succeeded before are reused, not repeated, and
 * side effects keep their own idempotency (one order per deal, notification dedupe keys).
 */
export async function retryExecution(deps: EngineDeps, orgId: string, executionId: string): Promise<AutomationExecution> {
  const { original, workflow, retries } = await deps.db.read(orgId, async (tx) => {
    const original = await tx.get("automation_executions", executionId);
    const workflow = original ? await tx.get("automation_workflows", original.workflow_id) : null;
    const retries = original ? (await tx.find("automation_executions", { retry_of: original.id })).length : 0;
    return { original, workflow, retries };
  });
  if (!original || !workflow) throw new Error("Execution not found");
  if (original.status !== "failed") throw new Error("Only failed runs can be retried");
  const stored = (original.trigger_payload.event ?? {}) as Partial<DomainEvent>;
  const event = {
    id: stored.id ?? original.event_id,
    type: stored.type,
    occurred_at: stored.occurred_at ?? original.started_at,
    organization_id: orgId,
    actor: { id: null, role: "service" },
    meta: deps.meta,
    causation: stored.causation ?? { depth: original.causation_depth, chain: [] },
    payload: stored.payload,
  } as DomainEvent;
  const { execution, caused } = await runWorkflow(deps, workflow, event, { retryOf: original, idempotencyKey: `${original.idempotency_key}:retry:${retries + 1}` });
  for (const e of caused) await handleEvent(deps, e);
  return execution;
}

/** Dry run with a sample or chosen record: evaluates every step, changes nothing, keeps a log. */
export async function testRunWorkflow(deps: EngineDeps, orgId: string, workflowId: string, recordId: string | null): Promise<AutomationExecution> {
  const { workflow, sampleId } = await deps.db.read(orgId, async (tx) => {
    const workflow = await tx.get("automation_workflows", workflowId);
    if (!workflow) throw new Error("Workflow not found");
    const parsed = validateDefinition(workflow.definition);
    if (!parsed.ok) return { workflow, sampleId: null };
    const entity = parsed.definition.trigger.entity;
    const table = ({ lead: "leads", deal: "deals", task: "tasks", company: "companies", order: "orders" } as const)[entity];
    const rows = (await tx.find(table)) as unknown as Array<{ id: string; created_at: string; archived_at: string | null }>;
    const sample = rows.filter((r) => !r.archived_at).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    return { workflow, sampleId: sample?.id ?? null };
  });
  const parsed = validateDefinition(workflow.definition);
  const entity = parsed.ok ? parsed.definition.trigger.entity : "lead";
  const id = recordId ?? sampleId ?? randomUUID();
  const type = parsed.ok ? parsed.definition.trigger.type : "record.created";
  const payload =
    type === "deal.stage_changed"
      ? { deal_id: id, from_stage_id: null, to_stage_id: "", is_won: true, is_lost: false, lost_reason: null }
      : type === "date.reached"
        ? { entity, id, field: "due_at", at: nowOf(deps).toISOString() }
        : type === "webhook.received"
          ? { event_type: parsed.ok && parsed.definition.trigger.type === "webhook.received" ? parsed.definition.trigger.event_type : "test", data: { entity, id } }
          : type === "record.updated"
            ? { entity, id, changes: {} }
            : { entity, id, after: {} };
  const event = {
    id: `test-${randomUUID()}`,
    type,
    occurred_at: nowOf(deps).toISOString(),
    organization_id: orgId,
    actor: { id: null, role: "service" },
    meta: deps.meta,
    causation: { depth: 0, chain: [] },
    payload,
  } as DomainEvent;
  const { execution } = await runWorkflow(deps, workflow, event, { mode: "test", idempotencyKey: `test:${workflow.id}:${event.id}` });
  return execution;
}
