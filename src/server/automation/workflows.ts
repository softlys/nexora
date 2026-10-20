/**
 * Automation Studio service: managing workflows and reading their runs.
 * Only admins and managers may create, edit, enable or test workflows (permission matrix);
 * every change bumps the version and is written to audit_logs with a diff plus a security event.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AutomationExecution, AutomationWorkflow } from "@/domain/entities";
import { diffFields } from "@/domain/diff";
import { EXAMPLE_WORKFLOWS } from "@/domain/automation/examples";
import { validateDefinition } from "@/domain/automation/logic";
import { DomainError } from "@/server/repositories/types";
import { emit, NotFoundError, nowOf, requireCan, type ServiceContext } from "@/server/services/context";
import { retryExecution, testRunWorkflow, type EngineDeps } from "./engine";
import { runScheduler } from "./scheduler";

export const workflowInput = z
  .object({
    name: z.string().trim().min(1, "Required").max(120),
    description: z.string().trim().max(1000),
    definition: z.unknown(),
  })
  .strict();
export const workflowUpdateInput = workflowInput.extend({ id: z.uuid() }).strict();

export class WorkflowValidationError extends DomainError {
  constructor(public readonly issues: Array<{ path: string; message: string }>) {
    super(`The workflow is not valid: ${issues[0]?.message ?? "unknown issue"}`);
  }
}

export type WorkflowStats = { runs: number; success: number; failed: number; skipped: number; last_run_at: string | null; last_status: AutomationExecution["status"] | null; success_rate: number | null };

function stats(executions: AutomationExecution[]): WorkflowStats {
  const live = executions.filter((e) => e.trigger_payload.mode !== "test");
  const last = [...live].sort((a, b) => b.started_at.localeCompare(a.started_at))[0];
  const success = live.filter((e) => e.status === "success").length;
  const failed = live.filter((e) => e.status === "failed").length;
  const finished = success + failed;
  return {
    runs: live.length,
    success,
    failed,
    skipped: live.filter((e) => e.status === "skipped").length,
    last_run_at: last?.started_at ?? null,
    last_status: last?.status ?? null,
    success_rate: finished === 0 ? null : success / finished,
  };
}

export async function listWorkflows(ctx: ServiceContext) {
  requireCan(ctx, "view", "automation");
  return ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const [workflows, executions] = await Promise.all([tx.find("automation_workflows", { archived_at: null }), tx.find("automation_executions")]);
    return workflows
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((w) => ({ ...w, stats: stats(executions.filter((e) => e.workflow_id === w.id)) }));
  });
}

export type ExecutionFilters = { status?: AutomationExecution["status"]; mode?: "live" | "test" };

export async function getWorkflow(ctx: ServiceContext, id: string, filters: ExecutionFilters = {}) {
  requireCan(ctx, "view", "automation");
  return ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const workflow = await tx.get("automation_workflows", id);
    if (!workflow || workflow.archived_at) throw new NotFoundError("Workflow");
    const executions = (await tx.find("automation_executions", { workflow_id: id })).sort((a, b) => b.started_at.localeCompare(a.started_at));
    const versions = (await tx.find("audit_logs", { target_type: "workflow", target_id: id })).sort((a, b) => b.created_at.localeCompare(a.created_at));
    return {
      workflow,
      stats: stats(executions),
      executions: executions
        .filter((e) => (!filters.status || e.status === filters.status) && (!filters.mode || (e.trigger_payload.mode ?? "live") === filters.mode))
        .slice(0, 100),
      history: versions.map((v) => ({ id: v.id, at: v.created_at, actor_id: v.actor_id, action: v.action, changes: v.changes })),
    };
  });
}

export async function getExecution(ctx: ServiceContext, id: string) {
  requireCan(ctx, "view", "automation");
  return ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const execution = await tx.get("automation_executions", id);
    if (!execution) throw new NotFoundError("Run");
    return execution;
  });
}

function checkDefinition(definition: unknown) {
  const result = validateDefinition(definition);
  if (!result.ok) throw new WorkflowValidationError(result.issues);
  return result.definition;
}

export async function createWorkflow(ctx: ServiceContext, input: z.output<typeof workflowInput>): Promise<AutomationWorkflow> {
  requireCan(ctx, "create", "automation");
  const definition = checkDefinition(input.definition);
  return ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const at = nowOf(ctx).toISOString();
    const workflow: AutomationWorkflow = {
      id: randomUUID(),
      organization_id: ctx.actor.organization_id,
      name: input.name,
      description: input.description,
      trigger_type: definition.trigger.type,
      definition: definition as unknown as Record<string, unknown>,
      enabled: false,
      version: 1,
      created_by: ctx.actor.id,
      updated_by: ctx.actor.id,
      created_at: at,
      updated_at: at,
      archived_at: null,
    };
    await tx.insert("automation_workflows", workflow);
    await emit(
      tx,
      ctx,
      { type: "record.created", payload: { entity: "workflow", id: workflow.id, after: { name: workflow.name, version: 1, definition } } },
      { type: "workflow.created", payload: { target: { type: "workflow", id: workflow.id }, name: workflow.name, trigger: definition.trigger.type, steps: definition.steps.length } },
    );
    return workflow;
  });
}

export async function createFromTemplate(ctx: ServiceContext, key: string): Promise<AutomationWorkflow> {
  const template = EXAMPLE_WORKFLOWS.find((w) => w.key === key);
  if (!template) throw new NotFoundError("Template");
  return createWorkflow(ctx, { name: `${template.name} (copy)`, description: template.description, definition: template.definition });
}

export async function updateWorkflow(ctx: ServiceContext, input: z.output<typeof workflowUpdateInput>): Promise<AutomationWorkflow> {
  requireCan(ctx, "update", "automation");
  const definition = checkDefinition(input.definition);
  return ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const current = await tx.get("automation_workflows", input.id);
    if (!current || current.archived_at) throw new NotFoundError("Workflow");
    const patch = { name: input.name, description: input.description, trigger_type: definition.trigger.type, definition: definition as unknown as Record<string, unknown> };
    const changes = diffFields(current as unknown as Record<string, unknown>, patch);
    if (Object.keys(changes).length === 0) return current;
    // Captured before the update so the audit diff records the old version.
    const previousVersion = current.version;
    const version = previousVersion + 1;
    const updated = await tx.update("automation_workflows", current.id, { ...patch, version, updated_by: ctx.actor.id, updated_at: nowOf(ctx).toISOString() });
    await emit(
      tx,
      ctx,
      { type: "record.updated", payload: { entity: "workflow", id: current.id, changes: { ...changes, version: { before: previousVersion, after: version } } } },
      { type: "workflow.updated", payload: { target: { type: "workflow", id: current.id }, version, fields: Object.keys(changes) } },
    );
    return updated;
  });
}

export async function setWorkflowEnabled(ctx: ServiceContext, id: string, enabled: boolean): Promise<AutomationWorkflow> {
  requireCan(ctx, "manage", "automation");
  return ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const current = await tx.get("automation_workflows", id);
    if (!current || current.archived_at) throw new NotFoundError("Workflow");
    if (current.enabled === enabled) return current;
    if (enabled) checkDefinition(current.definition);
    const updated = await tx.update("automation_workflows", id, { enabled, updated_by: ctx.actor.id, updated_at: nowOf(ctx).toISOString() });
    await emit(
      tx,
      ctx,
      { type: "record.updated", payload: { entity: "workflow", id, changes: { enabled: { before: !enabled, after: enabled } } } },
      { type: enabled ? "workflow.enabled" : "workflow.disabled", payload: { target: { type: "workflow", id }, name: current.name } },
    );
    return updated;
  });
}

export async function archiveWorkflow(ctx: ServiceContext, id: string): Promise<void> {
  requireCan(ctx, "manage", "automation");
  await ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const current = await tx.get("automation_workflows", id);
    if (!current || current.archived_at) throw new NotFoundError("Workflow");
    await tx.update("automation_workflows", id, { archived_at: nowOf(ctx).toISOString(), enabled: false, updated_by: ctx.actor.id });
    await emit(
      tx,
      ctx,
      { type: "record.archived", payload: { entity: "workflow", id } },
      { type: "workflow.disabled", payload: { target: { type: "workflow", id }, name: current.name, archived: true } },
    );
  });
}

export async function testWorkflow(ctx: ServiceContext, deps: EngineDeps, id: string, recordId: string | null) {
  requireCan(ctx, "update", "automation");
  return testRunWorkflow(deps, ctx.actor.organization_id, id, recordId);
}

export async function retryRun(ctx: ServiceContext, deps: EngineDeps, executionId: string) {
  requireCan(ctx, "update", "automation");
  try {
    return await retryExecution(deps, ctx.actor.organization_id, executionId);
  } catch (error) {
    if (error instanceof Error && /not found|Only failed/.test(error.message)) throw new DomainError(error.message);
    throw error;
  }
}

export async function runSchedulerNow(ctx: ServiceContext, deps: EngineDeps) {
  requireCan(ctx, "manage", "automation");
  return runScheduler(deps, ctx.actor.organization_id);
}
