"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createRobot, removeRobot, robotInput, setRobotEnabled } from "@/server/automation/robots";
import { serviceAction } from "@/server/service-action";

function refresh() {
  revalidatePath("/pipeline/robots");
  revalidatePath("/automation");
}

export async function createRobotAction(input: unknown) {
  return serviceAction({ name: "createRobot", schema: robotInput, bucket: "create" }, input, async (ctx, data) => {
    const workflow = await createRobot(ctx, data);
    refresh();
    return { id: workflow.id };
  });
}

export async function setRobotEnabledAction(input: unknown) {
  return serviceAction({ name: "setRobotEnabled", schema: z.object({ id: z.uuid(), enabled: z.boolean() }).strict() }, input, async (ctx, { id, enabled }) => {
    await setRobotEnabled(ctx, id, enabled);
    refresh();
    return undefined;
  });
}

export async function removeRobotAction(input: unknown) {
  return serviceAction({ name: "removeRobot", schema: z.object({ id: z.uuid() }).strict() }, input, async (ctx, { id }) => {
    await removeRobot(ctx, id);
    refresh();
    return undefined;
  });
}
