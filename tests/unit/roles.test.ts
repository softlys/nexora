import { beforeEach, describe, expect, it } from "vitest";
import type { Dataset } from "@/domain/entities";
import { can, restrictedScope, roleRestrictionFor, visibleOwnerIds } from "@/domain/permissions";
import type { Db } from "@/server/db/types";
import { listDeals } from "@/server/services/deals";
import { roleMatrix, roleRestrictionInput, saveRoleRestrictions } from "@/server/services/roles";
import { createTestDb, ctxFor, DEMO_USER_IDS } from "./helpers/services";

const query = { q: "", page: 1, size: 100, sort: undefined, dir: undefined, archived: undefined } as never;

describe("role restrictions", () => {
  it("only ever narrow the built-in scope", () => {
    expect(restrictedScope("team", "own")).toBe("own");
    expect(restrictedScope("own", "all")).toBe("own");
    expect(restrictedScope("all", "none")).toBeNull();
    expect(restrictedScope(null, "all")).toBeNull();
    expect(roleRestrictionFor("admin", { role_restrictions: { admin: { deal: { view: "none" } } } })).toEqual({});
  });

  let db: Db;
  let data: () => Dataset;
  beforeEach(() => {
    ({ db, data } = createTestDb());
  });
  const admin = () => ctxFor(db, data(), DEMO_USER_IDS.admin);
  /** A context as a fresh request would build it, with the organization's saved restrictions. */
  const fresh = (userId: string) => {
    const ctx = ctxFor(db, data(), userId);
    return { ...ctx, actor: { ...ctx.actor, ...roleRestrictionFor(ctx.actor.role, data().organizations[0]!.settings) } };
  };

  it("lets an admin narrow managers to their own deals and forbid deleting for reps", async () => {
    await saveRoleRestrictions(admin(), roleRestrictionInput.parse({ role: "manager", grants: { deal: { view: "own", update: "own" }, company: { view: "all" } } }));
    await saveRoleRestrictions(admin(), roleRestrictionInput.parse({ role: "sales_rep", grants: { deal: { archive: "none", create: "none" } } }));
    expect(data().organizations[0]!.settings.role_restrictions).toEqual({ manager: { deal: { view: "own", update: "own" } }, sales_rep: { deal: { archive: "none", create: "none" } } });

    const manager = fresh(DEMO_USER_IDS.manager);
    expect(visibleOwnerIds(manager.actor, "deal")).toEqual([DEMO_USER_IDS.manager]);
    const rows = (await listDeals(manager, query, {})).rows;
    expect(rows.every((d) => d.owner_id === DEMO_USER_IDS.manager)).toBe(true);

    const rep = fresh(DEMO_USER_IDS.repDaniel);
    expect(can(rep.actor, "create", "deal")).toBe(false);
    expect(can(rep.actor, "view", "deal")).toBe(true);
    const matrix = await roleMatrix(admin());
    expect(matrix.sales_rep.deal!.create).toEqual({ base: "own", value: "none" });
    expect(matrix.manager.company!.view).toEqual({ base: "team", value: "team" });
  });

  it("is for admins only", async () => {
    await expect(saveRoleRestrictions(ctxFor(db, data(), DEMO_USER_IDS.manager), roleRestrictionInput.parse({ role: "sales_rep", grants: {} }))).rejects.toThrow();
  });
});
