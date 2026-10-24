/**
 * Pure workflow logic: validation, flow resolution, condition evaluation, templates
 * and business-day math. No I/O, no dynamic code execution.
 */
import { z } from "zod";
import {
  definitionSchema,
  LIMITS,
  UPDATE_ALLOWLIST,
  variablesFor,
  type Condition,
  type Step,
  type TriggerEntity,
  type WorkflowDefinition,
} from "./schema";

export type ValidationIssue = { path: string; message: string };

/**
 * Validates a definition before save and before every run: schema (unknown fields, missing
 * config), step ids, targets, forward-only flow (no loops), reachability, allowlisted
 * variables and update fields, and steps that need a specific trigger entity.
 */
export function validateDefinition(input: unknown): { ok: true; definition: WorkflowDefinition } | { ok: false; issues: ValidationIssue[] } {
  const parsed = definitionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.map((i) => ({ path: i.path.join(".") || "definition", message: i.message })) };
  const def = parsed.data;
  const issues: ValidationIssue[] = [];
  const index = new Map<string, number>();
  def.steps.forEach((s, i) => {
    if (index.has(s.id)) issues.push({ path: `steps.${i}.id`, message: `Duplicate step id "${s.id}"` });
    index.set(s.id, i);
  });

  const entity = def.trigger.entity;
  const allowedVars = new Set(variablesFor(entity));
  const checkTarget = (from: number, field: string, value: string | undefined) => {
    if (value === undefined || value === "end") return;
    const to = index.get(value);
    if (to === undefined) issues.push({ path: `steps.${from}.${field}`, message: `Unknown step "${value}"` });
    else if (to <= from) issues.push({ path: `steps.${from}.${field}`, message: `Steps can only jump forward (to avoid loops)` });
  };
  const checkTemplate = (i: number, field: string, value: string) => {
    for (const name of templateVariables(value)) if (!allowedVars.has(name)) issues.push({ path: `steps.${i}.${field}`, message: `Unknown variable {{${name}}}` });
  };

  def.steps.forEach((s, i) => {
    checkTarget(i, "next", s.next);
    switch (s.type) {
      case "condition":
        checkTarget(i, "then", s.then);
        checkTarget(i, "else", s.else);
        s.conditions.forEach((c, ci) => {
          if (!allowedVars.has(c.field)) issues.push({ path: `steps.${i}.conditions.${ci}.field`, message: `"${c.field}" is not available for ${entity} triggers` });
          if (!["is_empty", "not_empty"].includes(c.op) && c.value === undefined) issues.push({ path: `steps.${i}.conditions.${ci}.value`, message: "A value is required" });
        });
        break;
      case "assign_owner":
        if (entity !== "lead") issues.push({ path: `steps.${i}.type`, message: "Assign owner works on lead triggers only" });
        break;
      case "convert_deal_to_order":
        if (entity !== "deal") issues.push({ path: `steps.${i}.type`, message: "Create order works on deal triggers only" });
        break;
      case "update_record": {
        const allowed = UPDATE_ALLOWLIST[entity];
        if (!allowed) {
          issues.push({ path: `steps.${i}.fields`, message: `${entity} records cannot be updated by automations` });
          break;
        }
        const keys = Object.keys(s.fields);
        if (keys.length === 0) issues.push({ path: `steps.${i}.fields`, message: "Choose at least one field" });
        for (const key of keys) {
          const schema = allowed[key];
          if (!schema) issues.push({ path: `steps.${i}.fields.${key}`, message: `"${key}" is not an allowed field` });
          else if (!(schema as z.ZodType).safeParse(s.fields[key]).success) issues.push({ path: `steps.${i}.fields.${key}`, message: `Invalid value for "${key}"` });
        }
        break;
      }
      case "create_task":
        checkTemplate(i, "title", s.title);
        if (s.assignee === "assignee" && entity !== "task") issues.push({ path: `steps.${i}.assignee`, message: "Assignee is only available on task triggers" });
        break;
      case "create_activity":
        checkTemplate(i, "subject", s.subject);
        checkTemplate(i, "body", s.body);
        break;
      case "create_notification":
        checkTemplate(i, "title", s.title);
        checkTemplate(i, "body", s.body);
        if (s.recipients.includes("assignee") && entity !== "task") issues.push({ path: `steps.${i}.recipients`, message: "Assignee is only available on task triggers" });
        break;
      case "send_email":
        checkTemplate(i, "subject", s.subject);
        checkTemplate(i, "body", s.body);
        break;
      case "send_telegram":
      case "send_whatsapp":
      case "send_slack":
        checkTemplate(i, "text", s.text);
        break;
      case "create_notion_page":
        checkTemplate(i, "title", s.title);
        checkTemplate(i, "body", s.body);
        break;
      default:
        break;
    }
  });

  // Reachability from the first step.
  const reachable = new Set<number>();
  const visit = (i: number) => {
    if (i < 0 || i >= def.steps.length || reachable.has(i)) return;
    reachable.add(i);
    for (const t of successors(def.steps, i)) if (t !== "end") visit(index.get(t) ?? -1);
  };
  visit(0);
  def.steps.forEach((s, i) => {
    if (!reachable.has(i)) issues.push({ path: `steps.${i}`, message: `Step "${s.id}" can never run` });
  });

  return issues.length ? { ok: false, issues } : { ok: true, definition: def };
}

/** Possible next targets of a step ("end" finishes the run). */
export function successors(steps: Step[], i: number): string[] {
  const s = steps[i]!;
  const fallthrough = s.next ?? steps[i + 1]?.id ?? "end";
  if (s.type === "condition") return [s.then, s.else];
  return [fallthrough];
}

/** The step that runs after step `i`, given a condition result for condition steps. */
export function nextStepId(steps: Step[], i: number, conditionResult?: boolean): string | "end" {
  const s = steps[i]!;
  if (s.type === "condition") return conditionResult ? s.then : s.else;
  return s.next ?? steps[i + 1]?.id ?? "end";
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

export type Vars = Record<string, string | number | boolean | null>;

function empty(v: unknown) {
  return v === null || v === undefined || v === "";
}

export function evaluateCondition(c: Condition, vars: Vars): boolean {
  const actual = vars[c.field];
  const expected = c.value;
  switch (c.op) {
    case "is_empty":
      return empty(actual);
    case "not_empty":
      return !empty(actual);
    case "eq":
      return String(actual ?? "") === String(expected ?? "");
    case "neq":
      return String(actual ?? "") !== String(expected ?? "");
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = Number(actual);
      const b = Number(expected);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      return c.op === "gt" ? a > b : c.op === "gte" ? a >= b : c.op === "lt" ? a < b : a <= b;
    }
    case "in":
      return Array.isArray(expected) && expected.map(String).includes(String(actual ?? ""));
    case "contains":
      return String(actual ?? "").toLowerCase().includes(String(expected ?? "").toLowerCase());
  }
}

export function evaluateConditions(conditions: Condition[], match: "all" | "any", vars: Vars): boolean {
  return match === "all" ? conditions.every((c) => evaluateCondition(c, vars)) : conditions.some((c) => evaluateCondition(c, vars));
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const VAR = /\{\{\s*([a-z_]+\.[a-z_]+)\s*\}\}/g;

export function templateVariables(template: string): string[] {
  return [...template.matchAll(VAR)].map((m) => m[1]!);
}

/**
 * Replaces {{entity.field}} with allowlisted values only. Unknown variables render empty.
 * Output is plain text: control characters are removed and length is capped; the UI
 * renders it as text, never as HTML.
 */
export function renderTemplate(template: string, vars: Vars, allowed: string[]): string {
  const allow = new Set(allowed);
  const out = template.replace(VAR, (_, name: string) => {
    if (!allow.has(name)) return "";
    const v = vars[name];
    return v === null || v === undefined ? "" : String(v);
  });
  return out.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, LIMITS.maxTemplateLength);
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** Adds business days (Mon–Fri) to a date; the time of day is kept. */
export function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from.getTime());
  let added = 0;
  while (added < days) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) added += 1;
  }
  return d;
}

export function entityOfTrigger(def: WorkflowDefinition): TriggerEntity {
  return def.trigger.entity;
}
