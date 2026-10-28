import { requisitesSchema, type Requisites } from "@/domain/entities";
import { DomainError } from "@/server/repositories/types";
import { emitSecurity, requireCan, type ServiceContext } from "./context";

export const EMPTY_REQUISITES: Requisites = { legal_name: "", inn: "", kpp: "", ogrn: "", address: "", bank_name: "", bik: "", account: "", corr_account: "", director: "", accountant: "", vat_note: "", stamp: null, signature: null };

/** The organization's legal details for documents (empty values when not filled in yet). */
export async function getRequisites(ctx: ServiceContext): Promise<Requisites> {
  const org = await ctx.db.read(ctx.actor.organization_id, (tx) => tx.get("organizations", ctx.actor.organization_id));
  return { ...EMPTY_REQUISITES, ...(org?.settings.requisites ?? {}) };
}

export const requisitesInput = requisitesSchema;

/** Admin: saves the legal details, stamp and signature. */
export async function saveRequisites(ctx: ServiceContext, input: Requisites): Promise<void> {
  requireCan(ctx, "manage", "organization");
  await ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const org = await tx.get("organizations", ctx.actor.organization_id);
    if (!org) throw new DomainError("Organization not found.", "not_found");
    await tx.update("organizations", org.id, { settings: { ...org.settings, requisites: input }, updated_at: new Date().toISOString() });
  });
  emitSecurity(ctx, { type: "settings.changed", payload: { target: { type: "organization", id: ctx.actor.organization_id }, fields: ["requisites"] } });
}
