import type { z } from "zod";
import type { Contact } from "@/domain/entities";
import { diffFields } from "@/domain/diff";
import type { contactInput, contactUpdateInput } from "@/domain/inputs";
import { applyListQuery, type ListQuery } from "@/domain/list";
import { buildTimeline, lastInteraction } from "@/domain/timeline";
import { emit, findVisible, trackRead, newId, nowOf, requireCan, resolveOwner, type ServiceContext } from "./context";
import { assertLinksVisible, byId, getOwned, visibleIds } from "./records";

export type ContactFilters = { owner?: string; company?: string };

export async function listContacts(ctx: ServiceContext, query: ListQuery, filters: ContactFilters) {
  return ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const [rows, companies, activities] = await Promise.all([
      findVisible(tx, ctx, "contacts", "contact", (r) => r.owner_id),
      tx.find("companies"),
      tx.find("activities"),
    ]);
    const companyById = byId(companies);
    const enriched = rows
      .filter(
        (c) =>
          (query.archived === "1" ? c.archived_at !== null : c.archived_at === null) &&
          (!filters.owner || c.owner_id === filters.owner) &&
          (!filters.company || c.company_id === filters.company),
      )
      .map((c) => ({
        ...c,
        company_name: c.company_id ? (companyById.get(c.company_id)?.name ?? null) : null,
        last_interaction: lastInteraction(activities, c.id),
      }));
    const page = applyListQuery(enriched, query, {
      searchText: (c) => `${c.first_name} ${c.last_name} ${c.email ?? ""} ${c.job_title} ${c.company_name ?? ""} ${c.tags.join(" ")}`,
      sorters: {
        name: (c) => `${c.last_name} ${c.first_name}`.toLowerCase(),
        company: (c) => c.company_name?.toLowerCase() ?? null,
        last_interaction: (c) => c.last_interaction,
        created: (c) => c.created_at,
      },
      defaultSort: { key: "name", dir: "asc" },
    });
    trackRead(ctx, "contact", page.rows.length);
    return page;
  });
}

export async function getContact(ctx: ServiceContext, id: string) {
  return ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const contact = await getOwned(tx, ctx, "contacts", id);
    const [company, activities, tasks, deals, comments] = await Promise.all([
      contact.company_id ? tx.get("companies", contact.company_id) : Promise.resolve(null),
      tx.find("activities", { contact_id: id }),
      findVisible(tx, ctx, "tasks", "task", (r) => r.assignee_id, { contact_id: id }),
      findVisible(tx, ctx, "deals", "deal", (r) => r.owner_id, { primary_contact_id: id }),
      tx.find("comments", { entity_type: "contact", entity_id: id }),
    ]);
    const companyVisible = company ? (await visibleIds(tx, ctx, "companies")).has(company.id) : false;
    return {
      contact,
      company: companyVisible ? company : null,
      deals: deals.filter((d) => !d.archived_at),
      tasks: tasks.filter((t) => !t.archived_at),
      last_interaction: lastInteraction(activities, id),
      timeline: buildTimeline({ activities, tasks: tasks.filter((t) => !t.archived_at), comments }),
    };
  });
}

export async function createContact(ctx: ServiceContext, input: z.output<typeof contactInput>): Promise<Contact> {
  requireCan(ctx, "create", "contact");
  return ctx.db.write(ctx.actor.organization_id, async (tx) => {
    await assertLinksVisible(tx, ctx, { company_id: input.company_id });
    const owner = (await resolveOwner(tx, ctx, "contact", input.owner_id ?? ctx.actor.id, ctx.actor.id, null))!;
    const at = nowOf(ctx).toISOString();
    const { owner_id: _o, ...fields } = input;
    void _o;
    const contact: Contact = { id: newId(), organization_id: ctx.actor.organization_id, ...fields, owner_id: owner, created_at: at, updated_at: at, archived_at: null };
    await tx.insert("contacts", contact);
    await emit(tx, ctx, { type: "record.created", payload: { entity: "contact", id: contact.id, after: contact } });
    return contact;
  });
}

export async function updateContact(ctx: ServiceContext, input: z.output<typeof contactUpdateInput>): Promise<Contact> {
  return ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const current = await getOwned(tx, ctx, "contacts", input.id);
    requireCan(ctx, "update", "contact", current.owner_id, current.id);
    if (input.company_id !== current.company_id) await assertLinksVisible(tx, ctx, { company_id: input.company_id });
    const owner = (await resolveOwner(tx, ctx, "contact", input.owner_id, current.owner_id, current.id))!;
    const { id, owner_id: _o, ...fields } = input;
    void _o;
    const patch = { ...fields, owner_id: owner };
    const changes = diffFields(current as unknown as Record<string, unknown>, patch);
    if (Object.keys(changes).length === 0) return current;
    const updated = await tx.update("contacts", id, { ...patch, updated_at: nowOf(ctx).toISOString() });
    await emit(tx, ctx, { type: "record.updated", payload: { entity: "contact", id, changes } });
    if (changes.owner_id) await emit(tx, ctx, { type: "record.owner_changed", payload: { entity: "contact", id, from: current.owner_id, to: owner } });
    return updated;
  });
}

export async function contactOptions(ctx: ServiceContext, companyId?: string) {
  return ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const rows = await findVisible(tx, ctx, "contacts", "contact", (r) => r.owner_id, companyId ? { company_id: companyId, archived_at: null } : { archived_at: null });
    return rows
      .map((c) => ({ id: c.id, name: `${c.first_name} ${c.last_name}`, company_id: c.company_id }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });
}
