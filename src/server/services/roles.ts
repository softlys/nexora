import { z } from "zod";
import { RESTRICTABLE_ACTIONS, RESTRICTABLE_RESOURCES, restrictedScope, scopeFor, type RoleRestriction, type Scope } from "@/domain/permissions";
import { DomainError } from "@/server/repositories/types";
import { emitSecurity, requireCan, type ServiceContext } from "./context";

/**
 * Settings → Roles: admins take rights away from managers and sales reps per record type —
 * a narrower scope ("own" instead of "team") or none at all. Rights are never widened beyond the
 * built-in matrix, which database RLS also enforces.
 */

export const RESTRICTABLE_ROLES = ["manager", "sales_rep"] as const;
export type RestrictableRole = (typeof RESTRICTABLE_ROLES)[number];

export const roleRestrictionInput = z
  .object({
    role: z.enum(RESTRICTABLE_ROLES),
    grants: z.partialRecord(z.enum(RESTRICTABLE_RESOURCES), z.partialRecord(z.enum(RESTRICTABLE_ACTIONS), z.enum(["own", "team", "all", "none"]))),
  })
  .strict();

export type RoleMatrixCell = { base: Scope | null; value: Scope | "none" | null };
export type RoleMatrix = Record<RestrictableRole, Record<string, Record<string, RoleMatrixCell>>>;

/** For each role, resource and action: the built-in scope and the organization's current setting. */
export async function roleMatrix(ctx: ServiceContext): Promise<RoleMatrix> {
  requireCan(ctx, "manage", "organization");
  const org = await ctx.db.read(ctx.actor.organization_id, (tx) => tx.get("organizations", ctx.actor.organization_id));
  const saved = (org?.settings.role_restrictions ?? {}) as Record<string, RoleRestriction>;
  return Object.fromEntries(
    RESTRICTABLE_ROLES.map((role) => [
      role,
      Object.fromEntries(
        RESTRICTABLE_RESOURCES.map((resource) => [
          resource,
          Object.fromEntries(
            RESTRICTABLE_ACTIONS.map((action) => {
              const base = scopeFor(role, action, resource);
              const set = saved[role]?.[resource]?.[action];
              return [action, { base, value: set === undefined ? base : restrictedScope(base, set) === null ? "none" : restrictedScope(base, set) }];
            }),
          ),
        ]),
      ),
    ]),
  ) as RoleMatrix;
}

/** Saves a role's restrictions; values that would not narrow the built-in scope are dropped. */
export async function saveRoleRestrictions(ctx: ServiceContext, input: z.output<typeof roleRestrictionInput>): Promise<RoleRestriction> {
  requireCan(ctx, "manage", "organization");
  const restriction: RoleRestriction = {};
  for (const [resource, actions] of Object.entries(input.grants) as Array<[(typeof RESTRICTABLE_RESOURCES)[number], Record<string, Scope | "none">]>) {
    for (const [action, value] of Object.entries(actions) as Array<[(typeof RESTRICTABLE_ACTIONS)[number], Scope | "none"]>) {
      const base = scopeFor(input.role, action, resource);
      if (!base) continue;
      const effective = restrictedScope(base, value);
      if (effective === base) continue;
      (restriction[resource] ??= {})[action] = effective ?? "none";
    }
  }
  await ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const org = await tx.get("organizations", ctx.actor.organization_id);
    if (!org) throw new DomainError("Organization not found.", "not_found");
    const all = { ...(org.settings.role_restrictions ?? {}), [input.role]: restriction } as Record<string, Record<string, Record<string, Scope | "none">>>;
    if (Object.keys(restriction).length === 0) delete all[input.role];
    await tx.update("organizations", org.id, { settings: { ...org.settings, role_restrictions: all }, updated_at: new Date().toISOString() });
  });
  emitSecurity(ctx, { type: "settings.changed", payload: { target: { type: "organization", id: ctx.actor.organization_id }, fields: [`role_restrictions.${input.role}`] } });
  return restriction;
}
