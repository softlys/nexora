"use server";

import { revalidatePath } from "next/cache";
import {
  changeRoleInput,
  pipelineStageInput,
  reorderStagesInput,
  updateOrganizationInput,
  updateProfileInput,
} from "@/domain/entities";
import { assertCan } from "@/domain/permissions";
import { getRepoContext } from "@/server/auth";
import { runAction } from "@/server/action-result";
import { getRepositories } from "@/server/repositories";

export async function updateOrganizationAction(input: unknown) {
  return runAction(async () => {
    const { ctx } = await getRepoContext();
    assertCan(ctx.actor, "update", "organization");
    const parsed = updateOrganizationInput.parse(input);
    await getRepositories().organizations.update(ctx, {
      name: parsed.name,
      currency: parsed.currency,
      locale: parsed.locale,
      settings: { order_conversion_mode: parsed.order_conversion_mode },
    });
    revalidatePath("/", "layout");
    return undefined;
  });
}

export async function updateProfileAction(input: unknown) {
  return runAction(async () => {
    const { ctx } = await getRepoContext();
    assertCan(ctx.actor, "update", "profile", { organization_id: ctx.actor.organization_id, owner_id: ctx.actor.id });
    const parsed = updateProfileInput.parse(input);
    await getRepositories().profiles.updateOwn(ctx, parsed);
    revalidatePath("/", "layout");
    return undefined;
  });
}

export async function changeRoleAction(input: unknown) {
  return runAction(async () => {
    const { ctx } = await getRepoContext();
    assertCan(ctx.actor, "manage", "team");
    const parsed = changeRoleInput.parse(input);
    await getRepositories().profiles.changeRole(ctx, parsed.profile_id, parsed.role);
    revalidatePath("/", "layout");
    return undefined;
  });
}

export async function savePipelineStageAction(input: unknown) {
  return runAction(async () => {
    const { ctx } = await getRepoContext();
    assertCan(ctx.actor, "manage", "pipeline_stage");
    const { id, ...stage } = pipelineStageInput.parse(input);
    const repo = getRepositories().pipelineStages;
    const saved = id ? await repo.update(ctx, id, stage) : await repo.create(ctx, stage);
    revalidatePath("/settings/pipeline");
    return { id: saved.id };
  });
}

export async function reorderPipelineStagesAction(input: unknown) {
  return runAction(async () => {
    const { ctx } = await getRepoContext();
    assertCan(ctx.actor, "manage", "pipeline_stage");
    const parsed = reorderStagesInput.parse(input);
    await getRepositories().pipelineStages.reorder(ctx, parsed.ordered_ids);
    revalidatePath("/settings/pipeline");
    return undefined;
  });
}
