import { z } from "zod";
import { unknownVariables, type EmailVars } from "@/domain/email-templates";
import type { EmailTemplate } from "@/domain/entities";
import { activityInput } from "@/domain/inputs";
import { formatAmount } from "@/lib/format";
import type { EmailSender } from "@/server/automation/engine";
import { DomainError } from "@/server/repositories/types";
import { emit, newId, nowOf, requireCan, type ServiceContext } from "./context";
import { assertLinksVisible, getOwned } from "./records";
import { logActivity } from "./tasks";

/**
 * Writing to customers from record pages: templates (admins manage them in Settings → E-mail
 * templates), the data a composer needs, and sending. A sent e-mail is logged as an activity on
 * the records it concerns; replies go to the sender's own address.
 */

export async function listEmailTemplates(ctx: ServiceContext): Promise<EmailTemplate[]> {
  return ctx.db.read(ctx.actor.organization_id, async (tx) => (await tx.find("email_templates", { archived_at: null })).sort((a, b) => a.name.localeCompare(b.name)));
}

export const emailTemplateInput = z
  .object({
    id: z.uuid().optional(),
    name: z.string().trim().min(1, "Required").max(80),
    subject: z.string().trim().min(1, "Required").max(200),
    body: z.string().trim().min(1, "Required").max(10000),
  })
  .strict()
  .superRefine((t, issue) => {
    for (const field of ["subject", "body"] as const) {
      const unknown = unknownVariables(t[field]);
      if (unknown.length) issue.addIssue({ code: "custom", path: [field], message: `Unknown variable {{${unknown[0]}}}` });
    }
  });

/** Admin: add or change a template. */
export async function saveEmailTemplate(ctx: ServiceContext, input: z.output<typeof emailTemplateInput>): Promise<EmailTemplate> {
  requireCan(ctx, "manage", "organization");
  return ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const at = nowOf(ctx).toISOString();
    if (input.id) {
      const current = await tx.get("email_templates", input.id);
      if (!current || current.archived_at) throw new DomainError("Template not found.", "not_found");
      const updated = await tx.update("email_templates", input.id, { name: input.name, subject: input.subject, body: input.body, updated_at: at });
      await emit(tx, ctx, { type: "record.updated", payload: { entity: "email_template", id: input.id, changes: { name: { before: current.name, after: input.name } } } });
      return updated;
    }
    const template: EmailTemplate = { id: newId(), organization_id: ctx.actor.organization_id, name: input.name, subject: input.subject, body: input.body, created_at: at, updated_at: at, archived_at: null };
    await tx.insert("email_templates", template);
    await emit(tx, ctx, { type: "record.created", payload: { entity: "email_template", id: template.id, after: template } });
    return template;
  });
}

/** Admin: remove a template from the composer (archived, not deleted). */
export async function archiveEmailTemplate(ctx: ServiceContext, id: string): Promise<void> {
  requireCan(ctx, "manage", "organization");
  await ctx.db.write(ctx.actor.organization_id, async (tx) => {
    if (!(await tx.get("email_templates", id))) throw new DomainError("Template not found.", "not_found");
    await tx.update("email_templates", id, { archived_at: nowOf(ctx).toISOString(), updated_at: nowOf(ctx).toISOString() });
    await emit(tx, ctx, { type: "record.archived", payload: { entity: "email_template", id } });
  });
}

export type EmailTarget = { contact_id?: string | null; company_id?: string | null; deal_id?: string | null; lead_id?: string | null };
export type EmailRecipient = { email: string; label: string; contact_id: string | null };
export type EmailComposer = {
  recipients: EmailRecipient[];
  vars: EmailVars;
  templates: Array<{ id: string; name: string; subject: string; body: string }>;
  links: EmailTarget;
  configured: boolean;
};

/** What the composer on a record page needs: addresses to write to, template variables and templates. */
export async function emailComposer(ctx: ServiceContext, target: EmailTarget, configured: boolean): Promise<EmailComposer> {
  return ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const deal = target.deal_id ? await getOwned(tx, ctx, "deals", target.deal_id) : null;
    const lead = target.lead_id ? await getOwned(tx, ctx, "leads", target.lead_id) : null;
    const contactId = target.contact_id ?? deal?.primary_contact_id ?? lead?.contact_id ?? null;
    const contact = contactId ? await tx.get("contacts", contactId) : null;
    const companyId = target.company_id ?? deal?.company_id ?? contact?.company_id ?? lead?.company_id ?? null;
    const company = companyId ? await getOwned(tx, ctx, "companies", companyId) : null;
    const me = await tx.get("profiles", ctx.actor.id);

    const recipients: EmailRecipient[] = [];
    const add = (email: string | null | undefined, label: string, contact_id: string | null) => {
      if (email && !recipients.some((r) => r.email.toLowerCase() === email.toLowerCase())) recipients.push({ email, label, contact_id });
    };
    if (contact) add(contact.email, `${contact.first_name} ${contact.last_name}`, contact.id);
    if (lead) add(lead.email, lead.contact_name || lead.title, null);
    if (company) {
      for (const c of await tx.find("contacts", { company_id: company.id, archived_at: null })) add(c.email, `${c.first_name} ${c.last_name}`, c.id);
    }
    const first = contact?.first_name ?? lead?.contact_name.split(" ")[0] ?? "";
    const vars: EmailVars = {
      "contact.first_name": first,
      "contact.last_name": contact?.last_name ?? "",
      "contact.full_name": contact ? `${contact.first_name} ${contact.last_name}` : (lead?.contact_name ?? ""),
      "contact.job_title": contact?.job_title ?? "",
      "company.name": company?.name ?? lead?.company_name ?? "",
      "company.city": company?.city ?? "",
      "deal.name": deal?.name ?? "",
      "deal.amount": deal ? formatAmount(deal.amount, deal.currency) : "",
      "lead.title": lead?.title ?? "",
      "me.name": me?.full_name ?? "",
      "me.title": me?.title ?? "",
      "me.email": me?.email ?? "",
    };
    const templates = (await tx.find("email_templates", { archived_at: null })).sort((a, b) => a.name.localeCompare(b.name)).map(({ id, name, subject, body }) => ({ id, name, subject, body }));
    return { recipients, vars, templates, links: { contact_id: contact?.id ?? null, company_id: company?.id ?? null, deal_id: deal?.id ?? null, lead_id: lead?.id ?? null }, configured };
  });
}

export const sendEmailInput = z
  .object({
    to: z.email("Enter a valid e-mail address").max(254),
    subject: z.string().trim().min(1, "Required").max(200),
    body: z.string().trim().min(1, "Required").max(10000),
    contact_id: z.uuid().nullable().optional(),
    company_id: z.uuid().nullable().optional(),
    deal_id: z.uuid().nullable().optional(),
    lead_id: z.uuid().nullable().optional(),
  })
  .strict()
  .refine((m) => m.contact_id || m.company_id || m.deal_id || m.lead_id, { message: "Link the e-mail to a record" });

/** Sends an e-mail from a record page and logs it on the records (after the provider accepted it). */
export async function sendRecordEmail(ctx: ServiceContext, sender: EmailSender, input: z.output<typeof sendEmailInput>): Promise<{ id: string; activity_id: string }> {
  requireCan(ctx, "create", "activity");
  if (!sender.configured) throw new DomainError("E-mail sending is not set up. Use “Open in mail app”, or ask an admin to configure the e-mail provider.");
  // The user must be able to see every linked record before anything is sent.
  const me = await ctx.db.read(ctx.actor.organization_id, async (tx) => {
    await assertLinksVisible(tx, ctx, { company_id: input.company_id ?? null, contact_id: input.contact_id ?? null, deal_id: input.deal_id ?? null, lead_id: input.lead_id ?? null });
    return tx.get("profiles", ctx.actor.id);
  });
  const activity = activityInput.parse({
    type: "email",
    subject: input.subject,
    body: `To: ${input.to}\n\n${input.body}`.slice(0, 5000),
    company_id: input.company_id ?? null,
    contact_id: input.contact_id ?? null,
    deal_id: input.deal_id ?? null,
    lead_id: input.lead_id ?? null,
    order_id: null,
    occurred_at: null,
  });
  const sent = await sender.send({ to: input.to, subject: input.subject, text: input.body, replyTo: me?.email });
  const logged = await logActivity(ctx, activity);
  return { id: sent.id, activity_id: logged.id };
}
