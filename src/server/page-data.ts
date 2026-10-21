import "server-only";
import { notFound } from "next/navigation";
import { visibleSettingsSections } from "@/domain/navigation";
import { can, ownerInScope, type Resource } from "@/domain/permissions";
import { getServiceContext } from "@/server/service-action";
import { findVisible, flushSecurityEvents, NotFoundError, type ServiceContext } from "@/server/services/context";
import { activeProfiles, assignableOwners } from "@/server/services/records";
import { companyOptions } from "@/server/services/companies";
import { contactOptions } from "@/server/services/contacts";

/**
 * Runs page data loading with a service context. A record the user may not see renders
 * the 404 page, and any security events raised (for example authz.denied on a guessed id)
 * are recorded afterwards.
 */
export async function loadPage<T>(fn: (ctx: ServiceContext) => Promise<T>): Promise<T> {
  const ctx = await getServiceContext();
  try {
    return await fn(ctx);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  } finally {
    await flushSecurityEvents(ctx);
  }
}

export type PersonOption = { value: string; label: string };

/** People for owner pickers and name lookups. `assignable` is empty when the user cannot reassign. */
export async function peopleFor(ctx: ServiceContext, resource: Resource) {
  return ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const all = await activeProfiles(tx);
    const assignable = ctx.actor.role === "sales_rep" ? [] : await assignableOwners(tx, ctx, resource);
    return {
      names: Object.fromEntries((await tx.find("profiles")).map((p) => [p.id, p.full_name])) as Record<string, string>,
      all: all.map((p) => ({ value: p.id, label: p.full_name })),
      assignable: assignable.map((p) => ({ value: p.id, label: p.full_name })),
    };
  });
}

export function permissionsFor(ctx: ServiceContext, resource: Resource) {
  return {
    canCreate: can(ctx.actor, "create", resource),
    canDelete: can(ctx.actor, "delete", resource),
    isAdmin: ctx.actor.role === "admin",
    settings: visibleSettingsSections(ctx.actor).length,
  };
}

/** Select options for deal forms. */
export async function dealFormOptions(ctx: ServiceContext) {
  const [people, companies, contacts, org] = await Promise.all([
    peopleFor(ctx, "deal"),
    companyOptions(ctx),
    contactOptions(ctx),
    ctx.db.read(ctx.actor.organization_id, (tx) => tx.get("organizations", ctx.actor.organization_id)),
  ]);
  return {
    owners: people.assignable,
    companies: companies.map((c) => ({ value: c.id, label: c.name })),
    contacts: contacts.map((c) => ({ value: c.id, label: c.name, company_id: c.company_id })),
    currency: org?.currency ?? "USD",
  };
}

/** Select options for task forms: assignees in scope plus records the user can link. */
export async function taskFormOptions(ctx: ServiceContext) {
  return ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const [assignable, companies, deals, orders] = await Promise.all([
      ctx.actor.role === "sales_rep" ? Promise.resolve([]) : assignableOwners(tx, ctx, "task"),
      findVisible(tx, ctx, "companies", "company", (r) => r.owner_id, { archived_at: null }),
      findVisible(tx, ctx, "deals", "deal", (r) => r.owner_id, { archived_at: null, closed_at: null }),
      findVisible(tx, ctx, "orders", "order", (r) => r.owner_id, { archived_at: null }),
    ]);
    const byName = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);
    return {
      currentUserId: ctx.actor.id,
      assignees: assignable.map((p) => ({ value: p.id, label: p.full_name })).sort(byName),
      companies: companies.map((c) => ({ value: c.id, label: c.name })).sort(byName),
      deals: deals.map((d) => ({ value: d.id, label: d.name })).sort(byName),
      orders: orders.map((o) => ({ value: o.id, label: o.order_number })).sort(byName),
    };
  });
}

type TitledTable = "companies" | "contacts" | "leads" | "deals" | "orders" | "tasks";
const RESOURCE: Record<TitledTable, Resource> = { companies: "company", contacts: "contact", leads: "lead", deals: "deal", orders: "order", tasks: "task" };

/**
 * The record's name for the browser tab title, or null when it does not exist or is not visible.
 * Read-only and silent: the page itself performs the real access check and logs denials.
 */
export async function recordTitle(table: TitledTable, id: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  try {
    const ctx = await getServiceContext();
    return await ctx.db.read(ctx.actor.organization_id, async (tx) => {
      const row = (await tx.get(table, id)) as Record<string, unknown> | null;
      if (!row) return null;
      const owner = (table === "tasks" ? row.assignee_id : row.owner_id) as string | null;
      if (!ownerInScope(ctx.actor, "view", RESOURCE[table], owner)) return null;
      if (table === "contacts") return `${row.first_name} ${row.last_name}`;
      if (table === "orders") return String(row.order_number);
      return String(row.name ?? row.title);
    });
  } catch {
    return null;
  }
}
