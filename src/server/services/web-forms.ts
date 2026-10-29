import { z } from "zod";
import { WEB_FORM_FIELDS, type Lead, type WebForm } from "@/domain/entities";
import { leadInput } from "@/domain/inputs";
import { tr } from "@/lib/i18n";
import type { Tx } from "@/server/db/types";
import { recordActivity } from "@/server/integrations/inbound";
import { DomainError } from "@/server/repositories/types";
import { newId, nowOf, requireCan, type ServiceContext } from "./context";
import { insertLead } from "./leads";

/**
 * CRM forms (Settings → Website forms). An admin sets up a form and pastes its embed code on the
 * website; each submission becomes a lead (source "website") with the message on its timeline.
 * The public side is src/app/api/forms/[id]/route.ts.
 */

const fieldMode = z.enum(["off", "optional", "required"]);
export const webFormInput = z
  .object({
    id: z.uuid().optional(),
    name: z.string().trim().min(1, "Required").max(120),
    title: z.string().trim().min(1, "Required").max(160),
    button_text: z.string().trim().min(1, "Required").max(60),
    success_text: z.string().trim().min(1, "Required").max(500),
    fields: z.object(Object.fromEntries(WEB_FORM_FIELDS.map((f) => [f, fieldMode])) as Record<(typeof WEB_FORM_FIELDS)[number], typeof fieldMode>).strict(),
    owner_id: z.uuid().nullable(),
    is_active: z.boolean(),
  })
  .strict()
  .refine((f) => f.fields.phone !== "off" || f.fields.email !== "off", { path: ["fields"], message: "Ask for a phone or an e-mail, or there is no way to reach the customer." });

export async function listWebForms(ctx: ServiceContext): Promise<WebForm[]> {
  requireCan(ctx, "manage", "organization");
  return ctx.db.read(ctx.actor.organization_id, async (tx) => (await tx.find("web_forms")).sort((a, b) => a.created_at.localeCompare(b.created_at)));
}

/** Creates or updates a form. */
export async function saveWebForm(ctx: ServiceContext, input: z.output<typeof webFormInput>): Promise<WebForm> {
  requireCan(ctx, "manage", "organization");
  return ctx.db.write(ctx.actor.organization_id, async (tx) => {
    if (input.owner_id) {
      const owner = await tx.get("profiles", input.owner_id);
      if (!owner || !owner.is_active) throw new DomainError("Choose an active user.");
    }
    const at = nowOf(ctx).toISOString();
    const { id, ...values } = input;
    if (id) {
      if (!(await tx.get("web_forms", id))) throw new DomainError("Form not found.", "not_found");
      return tx.update("web_forms", id, { ...values, updated_at: at });
    }
    const form: WebForm = { ...values, id: newId(), organization_id: ctx.actor.organization_id, submissions: 0, created_at: at, updated_at: at };
    await tx.insert("web_forms", form);
    return form;
  });
}

/** What a visitor typed; checked against the form's own field settings by submitWebForm. */
export const submissionInput = z.object({
  name: z.string().trim().max(120).default(""),
  phone: z.string().trim().max(40).default(""),
  email: z.string().trim().max(254).default(""),
  company: z.string().trim().max(160).default(""),
  message: z.string().trim().max(3000).default(""),
  utm: z.partialRecord(z.enum(["source", "medium", "campaign", "content", "term"]), z.string().trim().max(200)).optional(),
});

const PHONE = /^\+?[0-9 ()-]{6,24}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Field errors for a submission (keys are field names), empty when it can be accepted. */
export function submissionErrors(form: WebForm, data: z.output<typeof submissionInput>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!data.name) errors.name = "Required";
  for (const f of WEB_FORM_FIELDS) if (form.fields[f] === "required" && !data[f]) errors[f] = "Required";
  if (data.phone && form.fields.phone !== "off" && !PHONE.test(data.phone)) errors.phone = "Enter a phone number";
  if (data.email && form.fields.email !== "off" && !EMAIL.test(data.email)) errors.email = "Enter a valid e-mail";
  return errors;
}

/** Turns an accepted submission into a lead (run with an inbound context, inside its transaction). */
export async function submitWebForm(tx: Tx, ctx: ServiceContext, form: WebForm, data: z.output<typeof submissionInput>): Promise<Lead> {
  const on = (f: (typeof WEB_FORM_FIELDS)[number]) => form.fields[f] !== "off";
  const company = (on("company") && data.company) || data.name;
  const lead = await insertLead(
    tx,
    ctx,
    leadInput.parse({
      title: `${form.name}: ${company}`.slice(0, 160),
      company_name: company.slice(0, 160),
      contact_name: data.name.slice(0, 160),
      email: on("email") ? data.email : "",
      phone: on("phone") ? data.phone : "",
      country: "",
      source: "website",
      status: "new",
      qualification: "cold",
      next_action: tr("Call back"),
      next_action_at: "",
      estimated_value: 0,
      owner_id: form.owner_id,
      utm: data.utm ?? null,
    }),
  );
  const message = on("message") ? data.message : "";
  await recordActivity(tx, ctx, {
    type: "note",
    subject: `${tr("Form “{p0}”", { p0: form.name })}${message ? `: ${message.replace(/\s+/g, " ").slice(0, 120)}` : ""}`.slice(0, 200),
    body: message || tr("Submitted the form “{p0}”.", { p0: form.name }),
    occurred_at: nowOf(ctx).toISOString(),
    contact_id: null,
    lead_id: lead.id,
    deal_id: null,
  });
  await tx.update("web_forms", form.id, { submissions: form.submissions + 1 });
  return lead;
}
