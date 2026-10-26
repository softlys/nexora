"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  changeRoleInput,
  deletePipelineInput,
  pipelineInput,
  pipelineStageInput,
  reorderStagesInput,
  updateOrganizationInput,
  updateProfileInput,
} from "@/domain/entities";
import { assertCan } from "@/domain/permissions";
import { getRepoContext } from "@/server/auth";
import { runAction } from "@/server/action-result";
import { getDataMode } from "@/server/env";
import { DomainError, getRepositories } from "@/server/repositories";
import { recordSecurity } from "@/server/security/record";
import { tr } from "@/lib/i18n";

export async function updateOrganizationAction(input: unknown) {
  return runAction(async () => {
    const { ctx } = await getRepoContext();
    assertCan(ctx.actor, "update", "organization");
    const parsed = updateOrganizationInput.parse(input);
    const before = await getRepositories().organizations.current(ctx);
    await getRepositories().organizations.update(ctx, {
      name: parsed.name,
      currency: parsed.currency,
      locale: parsed.locale,
      settings: { order_conversion_mode: parsed.order_conversion_mode },
    });
    const changed = [
      before.name !== parsed.name && "name",
      before.currency !== parsed.currency && "currency",
      before.locale !== parsed.locale && "locale",
      before.settings.order_conversion_mode !== parsed.order_conversion_mode && "order_conversion_mode",
    ].filter(Boolean);
    if (changed.length) await recordSecurity({ type: "settings.changed", payload: { target: { type: "organization", id: ctx.actor.organization_id }, fields: changed } });
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
    const before = await getRepositories().profiles.get(ctx, parsed.profile_id);
    await getRepositories().profiles.changeRole(ctx, parsed.profile_id, parsed.role);
    if (before && before.role !== parsed.role) {
      await recordSecurity({ type: "role.changed", payload: { target: { type: "profile", id: parsed.profile_id }, from_role: before.role, to_role: parsed.role } });
    }
    revalidatePath("/", "layout");
    return undefined;
  });
}

export async function savePipelineStageAction(input: unknown) {
  return runAction(async () => {
    const { ctx } = await getRepoContext();
    assertCan(ctx.actor, "manage", "pipeline_stage");
    const { id, pipeline_id, ...stage } = pipelineStageInput.parse(input);
    const repo = getRepositories().pipelineStages;
    if (!id && !pipeline_id) throw new DomainError("Choose the pipeline for the new stage.");
    const saved = id ? await repo.update(ctx, id, stage) : await repo.create(ctx, pipeline_id!, stage);
    await recordSecurity({
      type: "pipeline.stages_changed",
      payload: { target: { type: "pipeline_stage", id: saved.id }, change: id ? "updated" : "created", name: stage.name, probability: stage.probability, is_won: stage.is_won, is_lost: stage.is_lost },
    });
    revalidatePath("/settings/pipeline");
    return { id: saved.id };
  });
}

export async function reorderPipelineStagesAction(input: unknown) {
  return runAction(async () => {
    const { ctx } = await getRepoContext();
    assertCan(ctx.actor, "manage", "pipeline_stage");
    const parsed = reorderStagesInput.parse(input);
    await getRepositories().pipelineStages.reorder(ctx, parsed.pipeline_id, parsed.ordered_ids);
    await recordSecurity({ type: "pipeline.stages_changed", payload: { target: { type: "pipeline_stage", id: null }, change: "reordered", order: parsed.ordered_ids } });
    revalidatePath("/settings/pipeline");
    return undefined;
  });
}

/** The stages a new pipeline starts with; admins rename and add stages afterwards. */
function defaultStages() {
  return [
    { name: tr("Qualification"), probability: 10, is_won: false, is_lost: false },
    { name: tr("Proposal"), probability: 50, is_won: false, is_lost: false },
    { name: tr("Negotiation"), probability: 75, is_won: false, is_lost: false },
    { name: tr("Won"), probability: 100, is_won: true, is_lost: false },
    { name: tr("Lost"), probability: 0, is_won: false, is_lost: true },
  ];
}

/** Admin: create a pipeline (with default stages) or rename one. */
export async function savePipelineAction(input: unknown) {
  return runAction(async () => {
    const { ctx } = await getRepoContext();
    assertCan(ctx.actor, "manage", "pipeline_stage");
    const { id, name } = pipelineInput.parse(input);
    const repo = getRepositories().pipelines;
    const saved = id ? await repo.rename(ctx, id, name) : await repo.create(ctx, { name, stages: defaultStages() });
    await recordSecurity({ type: "pipeline.stages_changed", payload: { target: { type: "pipeline", id: saved.id }, change: id ? "pipeline_renamed" : "pipeline_created", name } });
    revalidatePath("/settings/pipeline");
    revalidatePath("/pipeline");
    return { id: saved.id };
  });
}

/** Admin: delete an empty pipeline. */
export async function deletePipelineAction(input: unknown) {
  return runAction(async () => {
    const { ctx } = await getRepoContext();
    assertCan(ctx.actor, "manage", "pipeline_stage");
    const { id } = deletePipelineInput.parse(input);
    await getRepositories().pipelines.remove(ctx, id);
    await recordSecurity({ type: "pipeline.stages_changed", payload: { target: { type: "pipeline", id }, change: "pipeline_deleted" } });
    revalidatePath("/settings/pipeline");
    revalidatePath("/pipeline");
    return undefined;
  });
}

const memberInput = z.object({ profile_id: z.uuid(), active: z.boolean() }).strict();

/** Admin: disable or re-enable a team member. Disabled members cannot act; the last admin cannot be disabled. */
export async function setMemberActiveAction(input: unknown) {
  return runAction(async () => {
    const { ctx } = await getRepoContext();
    assertCan(ctx.actor, "manage", "team");
    const parsed = memberInput.parse(input);
    if (parsed.profile_id === ctx.actor.id && !parsed.active) throw new DomainError("You cannot disable your own account.");
    const profile = await getRepositories().profiles.setActive(ctx, parsed.profile_id, parsed.active);
    await recordSecurity({ type: parsed.active ? "user.enabled" : "user.disabled", payload: { target: { type: "profile", id: profile.id }, role: profile.role } });
    revalidatePath("/", "layout");
    return undefined;
  });
}

const inviteInput = z
  .object({ email: z.email().max(254), full_name: z.string().trim().min(1).max(120), role: z.enum(["admin", "manager", "sales_rep"]) })
  .strict();

/** Admin: invite a member by email (Supabase mode). Demo mode has no real accounts to invite. */
export async function inviteMemberAction(input: unknown) {
  return runAction(async () => {
    const { ctx } = await getRepoContext();
    assertCan(ctx.actor, "manage", "team");
    const parsed = inviteInput.parse(input);
    if (getDataMode() !== "supabase") throw new DomainError("Invitations send real emails, so they are available only in Supabase mode.");
    const profile = await getRepositories().profiles.invite(ctx, parsed);
    await recordSecurity({ type: "user.invited", payload: { target: { type: "profile", id: profile.id }, role: parsed.role } });
    revalidatePath("/settings/team");
    return undefined;
  });
}
