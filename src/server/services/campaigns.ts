import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { renderEmail, type EmailVars } from "@/domain/email-templates";
import { campaignSegmentSchema, type Campaign, type CampaignSegment, type Contact } from "@/domain/entities";
import type { EmailSender } from "@/server/automation/engine";
import type { Tx } from "@/server/db/types";
import { smsNumber, type SmsSender } from "@/server/integrations/sms";
import { DomainError } from "@/server/repositories/types";
import { emit, findVisible, newId, nowOf, type ServiceContext } from "./context";

/**
 * Mass mailings (рассылки): an e-mail or SMS to the contacts of a segment (tags, company lifecycle
 * stage, country, owner). Contacts tagged "unsubscribed" never receive one; every e-mail carries an
 * unsubscribe link. Each delivery is logged on the contact's timeline. In demo mode without a
 * provider a campaign is recorded as simulated: nothing leaves the server.
 */

export const UNSUBSCRIBED_TAG = "unsubscribed";
/** At most this many recipients per campaign in one run. */
export const MAX_RECIPIENTS = 2000;

const ensureRole = (ctx: ServiceContext) => {
  if (ctx.actor.role !== "admin" && ctx.actor.role !== "manager") throw new DomainError("Only admins and managers run mailings.", "conflict");
};

export const campaignInput = z
  .object({
    id: z.uuid().optional(),
    name: z.string().trim().min(1, "Required").max(120),
    channel: z.enum(["email", "sms"]),
    subject: z.string().trim().max(200).default(""),
    body: z.string().trim().min(1, "Required").max(10000),
    segment: campaignSegmentSchema,
  })
  .strict()
  .refine((c) => c.channel === "sms" || c.subject.length > 0, { path: ["subject"], message: "Required" });

/** Contacts the actor can see that match the segment and can be reached on the channel. */
export async function segmentContacts(tx: Tx, ctx: ServiceContext, segment: CampaignSegment, channel: Campaign["channel"]): Promise<{ reachable: Contact[]; skipped: number }> {
  const [contacts, companies] = await Promise.all([findVisible(tx, ctx, "contacts", "contact", (r) => r.owner_id, { archived_at: null }), tx.find("companies")]);
  const company = new Map(companies.map((c) => [c.id, c]));
  const tags = segment.tags.map((t) => t.toLowerCase());
  const matched = contacts.filter((c) => {
    if (c.tags.some((t) => t.toLowerCase() === UNSUBSCRIBED_TAG)) return false;
    if (tags.length && !c.tags.some((t) => tags.includes(t.toLowerCase()))) return false;
    const co = c.company_id ? company.get(c.company_id) : undefined;
    if (segment.lifecycle.length && !(co && segment.lifecycle.includes(co.lifecycle_stage))) return false;
    if (segment.countries.length && !(co && segment.countries.includes(co.country))) return false;
    if (segment.owner_ids.length && !segment.owner_ids.includes(c.owner_id)) return false;
    return true;
  });
  const reachable = matched.filter((c) => (channel === "email" ? Boolean(c.email) : smsNumber(c.phone) !== null));
  return { reachable: reachable.slice(0, MAX_RECIPIENTS), skipped: matched.length - reachable.slice(0, MAX_RECIPIENTS).length };
}

export async function listCampaigns(ctx: ServiceContext): Promise<Campaign[]> {
  return ctx.db.read(ctx.actor.organization_id, async (tx) => (await tx.find("campaigns")).sort((a, b) => b.created_at.localeCompare(a.created_at)));
}

/** How many contacts a segment reaches (for the editor). */
export async function previewSegment(ctx: ServiceContext, segment: CampaignSegment, channel: Campaign["channel"]): Promise<{ reachable: number; skipped: number; sample: string[] }> {
  return ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const { reachable, skipped } = await segmentContacts(tx, ctx, segment, channel);
    return { reachable: reachable.length, skipped, sample: reachable.slice(0, 5).map((c) => `${c.first_name} ${c.last_name}`) };
  });
}

export async function saveCampaign(ctx: ServiceContext, input: z.output<typeof campaignInput>): Promise<Campaign> {
  ensureRole(ctx);
  return ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const at = nowOf(ctx).toISOString();
    if (input.id) {
      const current = await tx.get("campaigns", input.id);
      if (!current) throw new DomainError("Campaign not found.", "not_found");
      if (current.status === "sent") throw new DomainError("A sent campaign cannot be changed. Copy it instead.", "conflict");
      const { id, ...fields } = input;
      return tx.update("campaigns", id, { ...fields, updated_at: at });
    }
    const campaign: Campaign = { id: newId(), organization_id: ctx.actor.organization_id, ...input, status: "draft", total: 0, sent: 0, failed: 0, skipped: 0, simulated: false, created_by: ctx.actor.id, sent_at: null, created_at: at, updated_at: at };
    await tx.insert("campaigns", campaign);
    await emit(tx, ctx, { type: "record.created", payload: { entity: "campaign", id: campaign.id, after: campaign } });
    return campaign;
  });
}

/** Signed unsubscribe token for a contact: the link works without signing in and cannot be forged. */
export function unsubscribeToken(contactId: string, secret: string): string {
  return createHmac("sha256", secret).update(`unsubscribe:${contactId}`).digest("hex").slice(0, 32);
}
export function unsubscribeTokenValid(contactId: string, token: string, secret: string): boolean {
  const expected = unsubscribeToken(contactId, secret);
  return token.length === expected.length && timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

export type CampaignDeps = { email: EmailSender; sms: SmsSender; simulate: boolean; baseUrl: string; secret: string };

/** Sends a draft campaign to its segment, once. */
export async function sendCampaign(ctx: ServiceContext, id: string, deps: CampaignDeps): Promise<Campaign> {
  ensureRole(ctx);
  const { campaign, recipients, skipped, vars } = await ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const campaign = await tx.get("campaigns", id);
    if (!campaign) throw new DomainError("Campaign not found.", "not_found");
    if (campaign.status === "sent") throw new DomainError("This campaign was already sent.", "conflict");
    const { reachable, skipped } = await segmentContacts(tx, ctx, campaign.segment, campaign.channel);
    const companies = new Map((await tx.find("companies")).map((c) => [c.id, c]));
    const me = await tx.get("profiles", ctx.actor.id);
    const vars = (c: Contact): EmailVars => ({ "contact.first_name": c.first_name, "contact.last_name": c.last_name, "contact.full_name": `${c.first_name} ${c.last_name}`, "contact.job_title": c.job_title, "company.name": c.company_id ? (companies.get(c.company_id)?.name ?? "") : "", "company.city": c.company_id ? (companies.get(c.company_id)?.city ?? "") : "", "me.name": me?.full_name ?? "", "me.title": me?.title ?? "", "me.email": me?.email ?? "" });
    return { campaign, recipients: reachable, skipped, vars };
  });
  const sender = campaign.channel === "email" ? deps.email : deps.sms;
  const simulated = !sender.configured && deps.simulate;
  if (!sender.configured && !simulated) throw new DomainError(campaign.channel === "email" ? "E-mail sending is not set up (Integrations → Email provider)." : "SMS is not set up (SMSRU_API_ID).");

  let sent = 0;
  let failed = 0;
  const delivered: Contact[] = [];
  for (const c of recipients) {
    const text = renderEmail(campaign.body, vars(c));
    try {
      if (!simulated) {
        if (campaign.channel === "email") {
          const link = `${deps.baseUrl}/api/unsubscribe?c=${c.id}&t=${unsubscribeToken(c.id, deps.secret)}`;
          await deps.email.send({ to: c.email!, subject: renderEmail(campaign.subject, vars(c)), text: `${text}\n\n—\n${link}` });
        } else {
          await deps.sms.send(smsNumber(c.phone)!, text);
        }
      }
      sent++;
      delivered.push(c);
    } catch {
      failed++;
    }
  }
  return ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const at = nowOf(ctx).toISOString();
    for (const c of delivered) {
      await tx.insert("activities", {
        id: newId(),
        organization_id: ctx.actor.organization_id,
        type: campaign.channel === "email" ? "email" : "message",
        subject: `${simulated ? "Mailing (simulated)" : "Mailing"}: ${campaign.name}`.slice(0, 200),
        body: renderEmail(campaign.body, vars(c)).slice(0, 5000),
        occurred_at: at,
        actor_id: ctx.actor.id,
        company_id: c.company_id,
        contact_id: c.id,
        lead_id: null,
        deal_id: null,
        order_id: null,
        created_at: at,
        updated_at: at,
      });
    }
    const updated = await tx.update("campaigns", id, { status: "sent", total: recipients.length, sent, failed, skipped, simulated, sent_at: at, updated_at: at });
    await emit(tx, ctx, { type: "record.updated", payload: { entity: "campaign", id, changes: { status: { before: "draft", after: "sent" } } } });
    return updated;
  });
}

/** The unsubscribe link: tags the contact so no further mailing reaches them. */
export async function unsubscribe(ctx: ServiceContext, contactId: string, token: string, secret: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/.test(contactId) || !unsubscribeTokenValid(contactId, token, secret)) return false;
  return ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const contact = await tx.get("contacts", contactId);
    if (!contact) return false;
    if (!contact.tags.includes(UNSUBSCRIBED_TAG)) await tx.update("contacts", contactId, { tags: [...contact.tags.slice(0, 9), UNSUBSCRIBED_TAG], updated_at: new Date().toISOString() });
    return true;
  });
}
