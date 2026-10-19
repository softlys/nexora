import { describe, expect, it } from "vitest";
import { NAV_ITEMS, SETTINGS_SECTIONS, visibleNavGroups, visibleSettingsSections } from "@/domain/navigation";
import { ACTIONS, assertCan, can, PERMISSION_MATRIX, PermissionError, RESOURCES, visibleOwnerIds, type Actor } from "@/domain/permissions";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER_ORG = "00000000-0000-4000-8000-000000000999";

const admin: Actor = { id: "a", role: "admin", organization_id: ORG, team_member_ids: [] };
const manager: Actor = { id: "m", role: "manager", organization_id: ORG, team_member_ids: ["r1", "r2"] };
const rep: Actor = { id: "r1", role: "sales_rep", organization_id: ORG, team_member_ids: [] };

const rec = (owner_id: string | null, organization_id = ORG) => ({ organization_id, owner_id });

describe("permission matrix", () => {
  it("defines only known actions and resources", () => {
    for (const grants of Object.values(PERMISSION_MATRIX)) {
      for (const [resource, actions] of Object.entries(grants)) {
        expect(RESOURCES).toContain(resource);
        for (const action of Object.keys(actions ?? {})) expect(ACTIONS).toContain(action);
      }
    }
  });

  it("lets admins do everything on business records", () => {
    for (const resource of ["company", "contact", "lead", "deal", "order", "task"] as const) {
      for (const action of ["view", "create", "update", "archive", "delete"] as const) {
        expect(can(admin, action, resource, rec("someone-else"))).toBe(true);
      }
    }
  });

  it("limits sales reps to their own records", () => {
    expect(can(rep, "view", "deal", rec("r1"))).toBe(true);
    expect(can(rep, "update", "deal", rec("r1"))).toBe(true);
    expect(can(rep, "view", "deal", rec("r2"))).toBe(false);
    expect(can(rep, "update", "deal", rec("m"))).toBe(false);
    expect(can(rep, "update", "company", rec(null))).toBe(false);
  });

  it("lets managers act on their team, not on other teams", () => {
    expect(can(manager, "update", "deal", rec("m"))).toBe(true);
    expect(can(manager, "update", "deal", rec("r2"))).toBe(true);
    expect(can(manager, "update", "deal", rec("r3"))).toBe(false);
    expect(can(manager, "view", "order", rec("a"))).toBe(false);
  });

  it("never allows hard delete for managers or reps", () => {
    for (const actor of [manager, rep]) {
      for (const resource of RESOURCES) expect(can(actor, "delete", resource)).toBe(false);
    }
  });

  it("rejects records from another organization for every role", () => {
    for (const actor of [admin, manager, rep]) {
      expect(can(actor, "view", "company", rec(actor.id, OTHER_ORG))).toBe(false);
    }
  });

  it("keeps admin-only configuration away from other roles", () => {
    for (const [action, resource] of [
      ["manage", "pipeline_stage"],
      ["manage", "team"],
      ["manage", "demo"],
      ["update", "organization"],
      ["view", "audit_log"],
      ["manage", "api_key"],
    ] as const) {
      expect(can(admin, action, resource)).toBe(true);
      expect(can(manager, action, resource)).toBe(false);
      expect(can(rep, action, resource)).toBe(false);
    }
  });

  it("lets only admins and managers work with automations", () => {
    expect(can(manager, "update", "automation")).toBe(true);
    expect(can(rep, "view", "automation")).toBe(false);
  });

  it("returns the owner ids a list query must filter by", () => {
    expect(visibleOwnerIds(admin, "deal")).toBe("all");
    expect(visibleOwnerIds(manager, "deal")).toEqual(["m", "r1", "r2"]);
    expect(visibleOwnerIds(rep, "deal")).toEqual(["r1"]);
    expect(visibleOwnerIds(rep, "automation")).toEqual([]);
  });

  it("assertCan throws a PermissionError", () => {
    expect(() => assertCan(rep, "manage", "pipeline_stage")).toThrow(PermissionError);
    expect(() => assertCan(admin, "manage", "pipeline_stage")).not.toThrow();
  });
});

describe("navigation follows the matrix", () => {
  it("hides automation, integrations and admin settings from sales reps", () => {
    const hrefs = visibleNavGroups(rep).flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).not.toContain("/automation");
    expect(hrefs).not.toContain("/integrations");
    expect(hrefs).toContain("/deals");
    const settings = visibleSettingsSections(rep).map((s) => s.href);
    expect(settings).toEqual(["/settings/profile"]);
  });

  it("shows every route to admins", () => {
    const hrefs = visibleNavGroups(admin).flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toEqual(NAV_ITEMS.map((i) => i.href));
    expect(visibleSettingsSections(admin)).toHaveLength(SETTINGS_SECTIONS.length);
  });

  it("gives managers read access to team settings but not pipeline or demo settings", () => {
    const settings = visibleSettingsSections(manager).map((s) => s.href);
    expect(settings).toContain("/settings/team");
    expect(settings).not.toContain("/settings/pipeline");
    expect(settings).not.toContain("/settings/demo");
  });
});
