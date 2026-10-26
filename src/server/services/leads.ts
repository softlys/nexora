import { formatAmount } from "@/lib/format";
import type { z } from "zod";
import type { Company, Contact, Lead } from "@/domain/entities";
import { diffFields } from "@/domain/diff";
import type { convertLeadInput, leadInput, leadUpdateInput } from "@/domain/inputs";
import { applyListQuery, type ListQuery } from "@/domain/list";
import { buildTimeline } from "@/domain/timeline";
import { UniqueViolation } from "@/server/db/types";
import { DomainError } from "@/server/repositories/types";
import { emit, findVisible, trackRead, newId, nowOf, requireCan, resolveOwner, type ServiceContext } from "./context";
import { createDeal } from "./deals";
import { byId, getOwned } from "./records";
import type { Tx } from "@/server/db/types";
import { withCustom } from "./custom-fields";

export type LeadFilters = { status?: Lead["status"]; source?: Lead["source"]; qualification?: Lead["qualification"]; owner?: string };

export async function listLeads(ctx: ServiceContext, query: ListQuery, filters: LeadFilters) {
  return ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const [rows, profiles] = await Promise.all([findVisible(tx, ctx, "leads", "lead", (r) => r.owner_id), tx.find("profiles")]);
    const profileById = byId(profiles);
    const filtered = rows
      .filter(
        (l) =>
          (query.archived === "1" ? l.archived_at !== null : l.archived_at === null) &&
          (!filters.status || l.status === filters.status) &&
          (!filters.source || l.source === filters.source) &&
          (!filters.qualification || l.qualification === filters.qualification) &&
          (!filters.owner || l.owner_id === filters.owner),
      )
      .map((l) => ({ ...l, owner_name: l.owner_id ? (profileById.get(l.owner_id)?.full_name ?? null) : null }));
    const page = applyListQuery(filtered, query, {
      searchText: (l) => `${l.title} ${l.company_name} ${l.contact_name} ${l.email ?? ""}`,
      sorters: {
        title: (l) => l.title.toLowerCase(),
        company: (l) => l.company_name.toLowerCase(),
        value: (l) => l.estimated_value,
        status: (l) => l.status,
        next: (l) => l.next_action_at,
        created: (l) => l.created_at,
      },
      defaultSort: { key: "created", dir: "desc" },
    });
    await trackRead(ctx, "lead", page.rows.length);
    return page;
  });
}

export async function getLead(ctx: ServiceContext, id: string) {
  return ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const lead = await getOwned(tx, ctx, "leads", id);
    const [activities, comments] = await Promise.all([tx.find("activities", { lead_id: id }), tx.find("comments", { entity_type: "lead", entity_id: id })]);
    return { lead, timeline: buildTimeline({ activities, comments }) };
  });
}

export async function createLead(ctx: ServiceContext, input: z.output<typeof leadInput>): Promise<Lead> {
  requireCan(ctx, "create", "lead");
  return ctx.db.write(ctx.actor.organization_id, (tx) => insertLead(tx, ctx, input));
}

/** createLead inside an existing transaction (inbound integrations claim the external id in the same one). */
export async function insertLead(tx: Tx, ctx: ServiceContext, input: z.output<typeof leadInput>): Promise<Lead> {
  requireCan(ctx, "create", "lead");
  const owner = await resolveOwner(tx, ctx, "lead", input.owner_id === undefined ? ctx.actor.id : input.owner_id, ctx.actor.id, null);
  const at = nowOf(ctx).toISOString();
  const org = await tx.get("organizations", ctx.actor.organization_id);
  const { owner_id: _o, ...raw } = input;
  const fields = await withCustom(tx, "lead", raw);
  void _o;
  const lead: Lead = {
    id: newId(),
    organization_id: ctx.actor.organization_id,
    ...fields,
    owner_id: owner,
    currency: org?.currency ?? "USD",
    company_id: null,
    contact_id: null,
    converted_deal_id: null,
    converted_at: null,
    created_at: at,
    updated_at: at,
    archived_at: null,
  };
  await tx.insert("leads", lead);
  await emit(tx, ctx, { type: "record.created", payload: { entity: "lead", id: lead.id, after: lead } });
  return lead;
}

export async function updateLead(ctx: ServiceContext, input: z.output<typeof leadUpdateInput>): Promise<Lead> {
  return ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const current = await getOwned(tx, ctx, "leads", input.id);
    requireCan(ctx, "update", "lead", current.owner_id, current.id);
    if (current.status === "converted") throw new DomainError("Converted leads are read-only.", "conflict");
    const owner = await resolveOwner(tx, ctx, "lead", input.owner_id, current.owner_id, current.id);
    const { id, owner_id: _o, ...raw } = input;
    const fields = await withCustom(tx, "lead", raw, current.custom);
    void _o;
    const patch = { ...fields, owner_id: owner };
    const changes = diffFields(current as unknown as Record<string, unknown>, patch);
    if (Object.keys(changes).length === 0) return current;
    const updated = await tx.update("leads", id, { ...patch, updated_at: nowOf(ctx).toISOString() });
    await emit(tx, ctx, { type: "record.updated", payload: { entity: "lead", id, changes } });
    if (changes.owner_id) await emit(tx, ctx, { type: "record.owner_changed", payload: { entity: "lead", id, from: current.owner_id, to: owner } });
    return updated;
  });
}

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0]!, last: "-" };
  return { first: parts.slice(0, -1).join(" "), last: parts.at(-1)! };
}

/**
 * Converts a lead into a deal in one unit of work: creates or links the company and contact,
 * creates the deal in the first open stage, marks the lead converted and logs an activity.
 * A lead converts only once: the status check plus the unique deals.lead_id and
 * leads.converted_deal_id constraints make a second conversion impossible, even concurrently.
 */
export async function convertLead(ctx: ServiceContext, input: z.output<typeof convertLeadInput>) {
  try {
    return await ctx.db.write(ctx.actor.organization_id, async (tx) => {
      const lead = await getOwned(tx, ctx, "leads", input.lead_id);
      requireCan(ctx, "update", "lead", lead.owner_id, lead.id);
      requireCan(ctx, "create", "deal");
      if (lead.archived_at) throw new DomainError("Restore the lead before converting it.");
      if (lead.status === "converted" || lead.converted_deal_id) throw new DomainError("This lead has already been converted.", "conflict");
      if (lead.status === "unqualified") throw new DomainError("Unqualified leads cannot be converted.");

      const at = nowOf(ctx).toISOString();
      const owner = lead.owner_id ?? ctx.actor.id;

      let company: Company;
      if (input.company.mode === "existing") {
        company = await getOwned(tx, ctx, "companies", input.company.company_id);
      } else {
        requireCan(ctx, "create", "company");
        company = {
          id: newId(),
          organization_id: ctx.actor.organization_id,
          name: input.company.name,
          website: null,
          industry: input.company.industry,
          size: input.company.size,
          country: input.company.country,
          city: "",
          address: "",
          phone: null,
          lifecycle_stage: "prospect",
          owner_id: owner,
          notes: "",
          created_at: at,
          updated_at: at,
          archived_at: null,
        };
        await tx.insert("companies", company);
        await emit(tx, ctx, { type: "record.created", payload: { entity: "company", id: company.id, after: company } });
      }

      let contact: Contact | null = null;
      if (input.contact.mode === "existing") {
        contact = await getOwned(tx, ctx, "contacts", input.contact.contact_id);
      } else if (input.contact.mode === "new") {
        requireCan(ctx, "create", "contact");
        const { first, last } = splitName(lead.contact_name);
        contact = {
          id: newId(),
          organization_id: ctx.actor.organization_id,
          company_id: company.id,
          first_name: first,
          last_name: last,
          email: lead.email,
          phone: lead.phone,
          job_title: "",
          owner_id: owner,
          tags: [],
          messengers: {},
          created_at: at,
          updated_at: at,
          archived_at: null,
        };
        await tx.insert("contacts", contact);
        await emit(tx, ctx, { type: "record.created", payload: { entity: "contact", id: contact.id, after: contact } });
      }

      const deal = await createDeal(
        ctx,
        {
          name: input.deal.name,
          company_id: company.id,
          primary_contact_id: contact?.id ?? null,
          amount: input.deal.amount,
          currency: lead.currency,
          expected_close_date: input.deal.expected_close_date,
          source: lead.source,
          next_activity: "",
          notes: "",
          owner_id: owner,
        },
        tx,
      );
      await tx.update("deals", deal.id, { lead_id: lead.id });
      await tx.update("leads", lead.id, {
        status: "converted",
        converted_deal_id: deal.id,
        converted_at: at,
        company_id: company.id,
        contact_id: contact?.id ?? null,
        updated_at: at,
      });
      await tx.insert("activities", {
        id: newId(),
        organization_id: ctx.actor.organization_id,
        type: "system",
        subject: "Lead converted to deal",
        // The deal usually keeps the lead's title; say what was created instead of "X became X".
        body: deal.name === lead.title ? `Deal created for ${company.name} (${formatAmount(deal.amount, deal.currency)}).` : `Deal "${deal.name}" created for ${company.name} (${formatAmount(deal.amount, deal.currency)}).`,
        occurred_at: at,
        actor_id: ctx.actor.id,
        company_id: company.id,
        contact_id: contact?.id ?? null,
        lead_id: lead.id,
        deal_id: deal.id,
        order_id: null,
        created_at: at,
        updated_at: at,
      });
      await emit(tx, ctx, { type: "lead.converted", payload: { lead_id: lead.id, deal_id: deal.id, company_id: company.id, contact_id: contact?.id ?? null } });
      return { deal_id: deal.id, company_id: company.id, contact_id: contact?.id ?? null };
    });
  } catch (error) {
    if (error instanceof UniqueViolation) throw new DomainError("This lead has already been converted.", "conflict");
    throw error;
  }
}
