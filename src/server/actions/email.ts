"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { emailSender } from "@/server/automation/runtime";
import { serviceAction } from "@/server/service-action";
import { archiveEmailTemplate, emailTemplateInput, saveEmailTemplate, sendEmailInput, sendRecordEmail } from "@/server/services/email";

/** Sends an e-mail from a record page; the e-mail is logged on the record's timeline. */
export async function sendEmailAction(input: unknown) {
  return serviceAction({ name: "sendEmail", schema: sendEmailInput, bucket: "create" }, input, async (ctx, data) => {
    const result = await sendRecordEmail(ctx, emailSender(), data);
    revalidatePath("/", "layout");
    return result;
  });
}

/** Admin: add or change an e-mail template. */
export async function saveEmailTemplateAction(input: unknown) {
  return serviceAction({ name: "saveEmailTemplate", schema: emailTemplateInput }, input, async (ctx, data) => {
    const template = await saveEmailTemplate(ctx, data);
    revalidatePath("/settings/email-templates");
    return { id: template.id };
  });
}

/** Admin: remove an e-mail template. */
export async function archiveEmailTemplateAction(input: unknown) {
  return serviceAction({ name: "archiveEmailTemplate", schema: z.object({ id: z.uuid() }).strict() }, input, async (ctx, { id }) => {
    await archiveEmailTemplate(ctx, id);
    revalidatePath("/settings/email-templates");
    return undefined;
  });
}
