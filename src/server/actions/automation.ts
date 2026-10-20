"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { engineDeps } from "@/server/automation/runtime";
import {
  archiveWorkflow,
  createFromTemplate,
  createWorkflow,
  retryRun,
  runSchedulerNow,
  setWorkflowEnabled,
  testWorkflow,
  updateWorkflow,
  workflowInput,
  workflowUpdateInput,
  WorkflowValidationError,
} from "@/server/automation/workflows";
import { serviceAction } from "@/server/service-action";

type Issues = Array<{ path: string; message: string }>;

function refresh(id?: string) {
  revalidatePath("/automation");
  if (id) revalidatePath(`/automation/${id}`);
}

export async function createWorkflowAction(input: unknown) {
  return serviceAction({ name: "createWorkflow", schema: workflowInput, bucket: "create" }, input, async (ctx, data): Promise<{ id: string } | { issues: Issues }> => {
    try {
      const wf = await createWorkflow(ctx, data);
      refresh();
      return { id: wf.id };
    } catch (error) {
      if (error instanceof WorkflowValidationError) return { issues: error.issues };
      throw error;
    }
  });
}

export async function createFromTemplateAction(input: unknown) {
  return serviceAction({ name: "createWorkflowFromTemplate", schema: z.object({ key: z.enum(["new_lead", "deal_won", "overdue_follow_up"]) }).strict(), bucket: "create" }, input, async (ctx, data) => {
    const wf = await createFromTemplate(ctx, data.key);
    refresh();
    return { id: wf.id };
  });
}

export async function updateWorkflowAction(input: unknown) {
  return serviceAction({ name: "updateWorkflow", schema: workflowUpdateInput }, input, async (ctx, data): Promise<{ id: string; version: number } | { issues: Issues }> => {
    try {
      const wf = await updateWorkflow(ctx, data);
      refresh(wf.id);
      return { id: wf.id, version: wf.version };
    } catch (error) {
      if (error instanceof WorkflowValidationError) return { issues: error.issues };
      throw error;
    }
  });
}

export async function setWorkflowEnabledAction(input: unknown) {
  return serviceAction({ name: "setWorkflowEnabled", schema: z.object({ id: z.uuid(), enabled: z.boolean() }).strict() }, input, async (ctx, data) => {
    const wf = await setWorkflowEnabled(ctx, data.id, data.enabled);
    refresh(wf.id);
    return { enabled: wf.enabled };
  });
}

export async function archiveWorkflowAction(input: unknown) {
  return serviceAction({ name: "archiveWorkflow", schema: z.object({ id: z.uuid() }).strict() }, input, async (ctx, data) => {
    await archiveWorkflow(ctx, data.id);
    refresh();
    return { id: data.id };
  });
}

export async function testRunAction(input: unknown) {
  return serviceAction({ name: "testWorkflow", schema: z.object({ id: z.uuid(), record_id: z.uuid().nullable() }).strict() }, input, async (ctx, data) => {
    const execution = await testWorkflow(ctx, engineDeps(ctx.meta), data.id, data.record_id);
    refresh(data.id);
    return execution;
  });
}

export async function retryRunAction(input: unknown) {
  return serviceAction({ name: "retryRun", schema: z.object({ execution_id: z.uuid() }).strict() }, input, async (ctx, data) => {
    const execution = await retryRun(ctx, engineDeps(ctx.meta), data.execution_id);
    refresh(execution.workflow_id);
    revalidatePath("/", "layout");
    return { id: execution.id, status: execution.status };
  });
}

export async function runSchedulerAction(input: unknown) {
  return serviceAction({ name: "runScheduler", schema: z.object({}).strict() }, input, async (ctx) => {
    const result = await runSchedulerNow(ctx, engineDeps(ctx.meta));
    refresh();
    revalidatePath("/", "layout");
    return result;
  });
}
