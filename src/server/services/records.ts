/**
 * Shared record operations (archive, restore, hard delete) and lookups used by
 * several services.
 */
import type { Profile, TableName } from "@/domain/entities";
import type { RecordEntity } from "@/domain/events/types";
import { isWithinScope, ownerInScope, actorScope, type Resource } from "@/domain/permissions";
import type { Row, Tx } from "@/server/db/types";
import { emit, getVisible, nowOf, requireCan, type ServiceContext } from "./context";

export type OwnedTable = "companies" | "contacts" | "leads" | "deals" | "orders" | "tasks";

export const OWNED: Record<OwnedTable, { resource: Resource; entity: RecordEntity; label: string; owner: (row: Record<string, unknown>) => string | null }> = {
  companies: { resource: "company", entity: "company", label: "Company", owner: (r) => r.owner_id as string },
  contacts: { resource: "contact", entity: "contact", label: "Contact", owner: (r) => r.owner_id as string },
  leads: { resource: "lead", entity: "lead", label: "Lead", owner: (r) => (r.owner_id as string | null) ?? null },
  deals: { resource: "deal", entity: "deal", label: "Deal", owner: (r) => r.owner_id as string },
  orders: { resource: "order", entity: "order", label: "Order", owner: (r) => r.owner_id as string },
  tasks: { resource: "task", entity: "task", label: "Task", owner: (r) => r.assignee_id as string },
};

export async function getOwned<T extends OwnedTable>(tx: Tx, ctx: ServiceContext, table: T, id: string): Promise<Row<T>> {
  const spec = OWNED[table];
  return getVisible(tx, ctx, table, id, spec.resource, (r) => spec.owner(r as Record<string, unknown>), spec.label);
}

export async function archiveRecord(ctx: ServiceContext, table: OwnedTable, id: string): Promise<void> {
  const spec = OWNED[table];
  await ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const row = (await getOwned(tx, ctx, table, id)) as unknown as { archived_at: string | null };
    requireCan(ctx, "archive", spec.resource, spec.owner(row as Record<string, unknown>), id);
    if (row.archived_at) return;
    await tx.update(table, id, { archived_at: nowOf(ctx).toISOString(), updated_at: nowOf(ctx).toISOString() } as never);
    await emit(tx, ctx, { type: "record.archived", payload: { entity: spec.entity, id } });
  });
}

export async function restoreRecord(ctx: ServiceContext, table: OwnedTable, id: string): Promise<void> {
  const spec = OWNED[table];
  await ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const row = (await getOwned(tx, ctx, table, id)) as unknown as { archived_at: string | null };
    requireCan(ctx, "archive", spec.resource, spec.owner(row as Record<string, unknown>), id);
    if (!row.archived_at) return;
    await tx.update(table, id, { archived_at: null, updated_at: nowOf(ctx).toISOString() } as never);
    await emit(tx, ctx, { type: "record.restored", payload: { entity: spec.entity, id } });
  });
}

/** Admin-only permanent delete. The audit entry keeps a copy of the deleted row. */
export async function hardDeleteRecord(ctx: ServiceContext, table: OwnedTable, id: string): Promise<void> {
  const spec = OWNED[table];
  await ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const row = await getOwned(tx, ctx, table, id);
    requireCan(ctx, "delete", spec.resource, spec.owner(row as unknown as Record<string, unknown>), id);
    await tx.remove(table, id);
    await emit(tx, ctx, { type: "record.deleted", payload: { entity: spec.entity, id, before: row as unknown as Record<string, unknown> } });
  });
}

export async function activeProfiles(tx: Tx): Promise<Profile[]> {
  return (await tx.find("profiles")).filter((p) => p.is_active && !p.archived_at);
}

/** Profiles the actor may assign records of `resource` to. */
export async function assignableOwners(tx: Tx, ctx: ServiceContext, resource: Resource): Promise<Profile[]> {
  const scope = actorScope(ctx.actor, "update", resource);
  if (!scope) return [];
  return (await activeProfiles(tx)).filter((p) => isWithinScope(ctx.actor, scope, p.id));
}

export function byId<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((r) => [r.id, r]));
}

export async function visibleIds(tx: Tx, ctx: ServiceContext, table: OwnedTable): Promise<Set<string>> {
  const spec = OWNED[table];
  const rows = (await tx.find(table as TableName)) as unknown as Array<Record<string, unknown> & { id: string }>;
  return new Set(rows.filter((r) => ownerInScope(ctx.actor, "view", spec.resource, spec.owner(r))).map((r) => r.id));
}

/** Makes sure every linked record id is visible to the actor; otherwise NotFound (no existence leaks). */
export async function assertLinksVisible(
  tx: Tx,
  ctx: ServiceContext,
  links: Partial<Record<"company_id" | "contact_id" | "deal_id" | "order_id" | "lead_id", string | null | undefined>>,
): Promise<void> {
  const map: Record<string, OwnedTable> = { company_id: "companies", contact_id: "contacts", deal_id: "deals", order_id: "orders", lead_id: "leads" };
  for (const [key, value] of Object.entries(links)) {
    if (value) await getOwned(tx, ctx, map[key]!, value);
  }
}
