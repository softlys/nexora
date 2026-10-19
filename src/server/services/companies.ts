import type { Company } from "@/domain/entities";
import { diffFields } from "@/domain/diff";
import type { z } from "zod";
import type { companyInput, companyUpdateInput } from "@/domain/inputs";
import { applyListQuery, type ListQuery } from "@/domain/list";
import { buildTimeline } from "@/domain/timeline";
import { emit, findVisible, newId, nowOf, requireCan, resolveOwner, type ServiceContext } from "./context";
import { getOwned, visibleIds } from "./records";

export type CompanyFilters = {
  industry?: string;
  size?: Company["size"];
  country?: string;
  owner?: string;
  lifecycle?: Company["lifecycle_stage"];
};

export async function listCompanies(ctx: ServiceContext, query: ListQuery, filters: CompanyFilters) {
  return ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const rows = await findVisible(tx, ctx, "companies", "company", (r) => r.owner_id);
    const filtered = rows.filter(
      (c) =>
        (query.archived === "1" ? c.archived_at !== null : c.archived_at === null) &&
        (!filters.industry || c.industry === filters.industry) &&
        (!filters.size || c.size === filters.size) &&
        (!filters.country || c.country === filters.country) &&
        (!filters.owner || c.owner_id === filters.owner) &&
        (!filters.lifecycle || c.lifecycle_stage === filters.lifecycle),
    );
    const [deals, contacts] = await Promise.all([tx.find("deals", { archived_at: null }), tx.find("contacts", { archived_at: null })]);
    const openDeals = new Map<string, number>();
    for (const d of deals) if (!d.closed_at) openDeals.set(d.company_id, (openDeals.get(d.company_id) ?? 0) + 1);
    const contactCount = new Map<string, number>();
    for (const c of contacts) if (c.company_id) contactCount.set(c.company_id, (contactCount.get(c.company_id) ?? 0) + 1);

    const page = applyListQuery(filtered, query, {
      searchText: (c) => `${c.name} ${c.industry} ${c.city} ${c.country} ${c.website ?? ""}`,
      sorters: {
        name: (c) => c.name.toLowerCase(),
        industry: (c) => c.industry,
        country: (c) => c.country,
        lifecycle: (c) => c.lifecycle_stage,
        created: (c) => c.created_at,
      },
      defaultSort: { key: "name", dir: "asc" },
    });
    return {
      ...page,
      rows: page.rows.map((c) => ({ ...c, open_deals: openDeals.get(c.id) ?? 0, contacts: contactCount.get(c.id) ?? 0 })),
      facets: {
        industries: [...new Set(rows.map((c) => c.industry))].sort(),
        countries: [...new Set(rows.map((c) => c.country))].sort(),
      },
    };
  });
}

export async function getCompany(ctx: ServiceContext, id: string) {
  return ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const company = await getOwned(tx, ctx, "companies", id);
    const [contacts, deals, orders, tasks, activities, comments, stages, history] = await Promise.all([
      findVisible(tx, ctx, "contacts", "contact", (r) => r.owner_id, { company_id: id }),
      findVisible(tx, ctx, "deals", "deal", (r) => r.owner_id, { company_id: id }),
      findVisible(tx, ctx, "orders", "order", (r) => r.owner_id, { company_id: id }),
      findVisible(tx, ctx, "tasks", "task", (r) => r.assignee_id, { company_id: id }),
      tx.find("activities", { company_id: id }),
      tx.find("comments", { entity_type: "company", entity_id: id }),
      tx.find("pipeline_stages"),
      tx.find("deal_stage_history"),
    ]);
    const dealIds = new Set(deals.map((d) => d.id));
    return {
      company,
      contacts: contacts.filter((c) => !c.archived_at),
      deals: deals.filter((d) => !d.archived_at),
      orders: orders.filter((o) => !o.archived_at),
      tasks: tasks.filter((t) => !t.archived_at),
      stages,
      timeline: buildTimeline({
        activities,
        tasks: tasks.filter((t) => !t.archived_at),
        stageHistory: history.filter((h) => dealIds.has(h.deal_id)),
        comments,
        stages,
      }),
    };
  });
}

type CompanyCreate = z.output<typeof companyInput>;
type CompanyUpdate = z.output<typeof companyUpdateInput>;

export async function createCompany(ctx: ServiceContext, input: CompanyCreate): Promise<Company> {
  requireCan(ctx, "create", "company");
  return ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const owner = (await resolveOwner(tx, ctx, "company", input.owner_id ?? ctx.actor.id, ctx.actor.id, null))!;
    const at = nowOf(ctx).toISOString();
    const { owner_id: _o, ...fields } = input;
    void _o;
    const company: Company = {
      id: newId(),
      organization_id: ctx.actor.organization_id,
      ...fields,
      owner_id: owner,
      created_at: at,
      updated_at: at,
      archived_at: null,
    };
    await tx.insert("companies", company);
    await emit(tx, ctx, { type: "record.created", payload: { entity: "company", id: company.id, after: company } });
    return company;
  });
}

export async function updateCompany(ctx: ServiceContext, input: CompanyUpdate): Promise<Company> {
  return ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const current = await getOwned(tx, ctx, "companies", input.id);
    requireCan(ctx, "update", "company", current.owner_id, current.id);
    const owner = (await resolveOwner(tx, ctx, "company", input.owner_id, current.owner_id, current.id))!;
    const { id, owner_id: _o, ...fields } = input;
    void _o;
    const patch = { ...fields, owner_id: owner };
    const changes = diffFields(current as unknown as Record<string, unknown>, patch);
    if (Object.keys(changes).length === 0) return current;
    const updated = await tx.update("companies", id, { ...patch, updated_at: nowOf(ctx).toISOString() });
    await emit(tx, ctx, { type: "record.updated", payload: { entity: "company", id, changes } });
    if (changes.owner_id) await emit(tx, ctx, { type: "record.owner_changed", payload: { entity: "company", id, from: current.owner_id, to: owner } });
    return updated;
  });
}

/** Company options for selects (visible, active). */
export async function companyOptions(ctx: ServiceContext) {
  return ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const ids = await visibleIds(tx, ctx, "companies");
    return (await tx.find("companies", { archived_at: null }))
      .filter((c) => ids.has(c.id))
      .map((c) => ({ id: c.id, name: c.name, country: c.country }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });
}
