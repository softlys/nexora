/**
 * Applies supabase/migrations to a real PostgreSQL engine (PGlite), loads the seed,
 * and checks that row-level security gives each role exactly what src/domain/permissions.ts says.
 */
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import type { Profile } from "@/domain/entities";
import { visibleOwnerIds, type Actor, type Resource } from "@/domain/permissions";
import { DEMO_USER_IDS, generateSeed } from "@/domain/seed/generate";
import { asUser, createDatabase, loadDataset } from "./helpers/pglite";

const seed = generateSeed(new Date("2026-10-19T12:00:00Z"));
let db: PGlite;

function actorFor(profile: Profile): Actor {
  return {
    id: profile.id,
    role: profile.role,
    organization_id: profile.organization_id,
    team_member_ids: seed.profiles.filter((p) => p.manager_id === profile.id).map((p) => p.id),
  };
}

function expectedCount(actor: Actor, resource: Resource, rows: Array<{ owner: string | null }>) {
  const owners = visibleOwnerIds(actor, resource);
  return rows.filter((r) => owners === "all" || (r.owner !== null && owners.includes(r.owner))).length;
}

async function count(userId: string, sql: string) {
  return asUser(db, userId, async (tx) => Number((await tx.query<{ n: number }>(`select count(*)::int as n from ${sql}`)).rows[0]!.n));
}

beforeAll(async () => {
  db = await createDatabase();
  await loadDataset(db, seed);
}, 120_000);

describe("migrations", () => {
  it("apply cleanly and accept the full seed", async () => {
    const { rows } = await db.query<{ n: number }>("select count(*)::int as n from public.deals");
    expect(rows[0]!.n).toBe(seed.deals.length);
  });

  it("enable row-level security on every public table", async () => {
    const { rows } = await db.query<{ relname: string }>(
      "select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity",
    );
    expect(rows).toEqual([]);
  });

  it("enforce one order per deal", async () => {
    const order = seed.orders.find((o) => o.source_deal_id)!;
    await expect(
      db.query("insert into public.orders (organization_id, order_number, company_id, source_deal_id, owner_id) values ($1, 'NX-2099-9999', $2, $3, $4)", [
        order.organization_id,
        order.company_id,
        order.source_deal_id,
        order.owner_id,
      ]),
    ).rejects.toThrow(/duplicate key/);
  });

  it("reject non-simulated payments", async () => {
    const p = seed.payments[0]!;
    await expect(
      db.query("insert into public.payments (organization_id, order_id, amount, method, is_simulated) values ($1, $2, 10, 'card', false)", [p.organization_id, p.order_id]),
    ).rejects.toThrow(/check constraint/);
  });

  it("reject cross-organization references", async () => {
    await db.query("insert into public.organizations (id, name, slug) values ('00000000-0000-4000-8000-0000000000ff', 'Other', 'other-org')");
    const company = seed.companies[0]!;
    await expect(
      db.query(
        "insert into public.contacts (organization_id, company_id, first_name, last_name, owner_id) values ('00000000-0000-4000-8000-0000000000ff', $1, 'A', 'B', $2)",
        [company.id, company.owner_id],
      ),
    ).rejects.toThrow(/foreign key/);
  });
});

describe("row-level security matches the permission matrix", () => {
  const cases: Array<[string, Resource, (s: typeof seed) => Array<{ owner: string | null }>]> = [
    ["public.companies", "company", (s) => s.companies.map((r) => ({ owner: r.owner_id }))],
    ["public.contacts", "contact", (s) => s.contacts.map((r) => ({ owner: r.owner_id }))],
    ["public.deals", "deal", (s) => s.deals.map((r) => ({ owner: r.owner_id }))],
    ["public.orders", "order", (s) => s.orders.map((r) => ({ owner: r.owner_id }))],
    ["public.tasks", "task", (s) => s.tasks.map((r) => ({ owner: r.assignee_id }))],
  ];

  for (const profile of seed.profiles) {
    for (const [table, resource, rows] of cases) {
      it(`${profile.full_name} (${profile.role}) sees the right ${table}`, async () => {
        const actor = actorFor(profile);
        expect(await count(profile.id, table)).toBe(expectedCount(actor, resource, rows(seed)));
      });
    }
  }

  it("shows leads in scope plus unassigned leads to managers", async () => {
    const manager = seed.profiles.find((p) => p.id === DEMO_USER_IDS.manager)!;
    const actor = actorFor(manager);
    const owners = visibleOwnerIds(actor, "lead") as string[];
    const expected = seed.leads.filter((l) => l.owner_id === null || owners.includes(l.owner_id)).length;
    expect(await count(manager.id, "public.leads")).toBe(expected);
  });

  it("hides other users' notifications, even from admins", async () => {
    const mine = seed.notifications.filter((n) => n.recipient_id === DEMO_USER_IDS.admin).length;
    expect(await count(DEMO_USER_IDS.admin, "public.notifications")).toBe(mine);
  });

  it("returns nothing to an unknown user", async () => {
    expect(await count("00000000-0000-4000-8000-00000000dead", "public.companies")).toBe(0);
  });

  it("prevents a sales rep from updating another rep's deal", async () => {
    const other = seed.deals.find((d) => d.owner_id === DEMO_USER_IDS.repSofia)!;
    const updated = await asUser(db, DEMO_USER_IDS.repDaniel, async (tx) => {
      const r = await tx.query("update public.deals set amount = 1 where id = $1", [other.id]);
      return r.affectedRows;
    });
    expect(updated).toBe(0);
  });

  it("prevents a sales rep from giving a record to someone outside their scope", async () => {
    const mine = seed.companies.find((c) => c.owner_id === DEMO_USER_IDS.repDaniel)!;
    await expect(
      asUser(db, DEMO_USER_IDS.repDaniel, (tx) => tx.query("update public.companies set owner_id = $1 where id = $2", [DEMO_USER_IDS.repSofia, mine.id])),
    ).rejects.toThrow(/row-level security/);
  });

  it("does not let users change their own role by updating the profile", async () => {
    await expect(
      asUser(db, DEMO_USER_IDS.repDaniel, (tx) => tx.query("update public.profiles set role = 'admin' where id = $1", [DEMO_USER_IDS.repDaniel])),
    ).rejects.toThrow(/permission denied/);
  });

  it("keeps the audit log append-only", async () => {
    await asUser(db, DEMO_USER_IDS.admin, async (tx) => {
      await tx.query(
        "insert into public.audit_logs (organization_id, actor_id, actor_role, action, target_type) values ($1, $2, 'admin', 'test', 'test')",
        [seed.organizations[0]!.id, DEMO_USER_IDS.admin],
      );
      await expect(tx.query("delete from public.audit_logs")).rejects.toThrow(/permission denied/);
    });
  });

  it("does not expose API key hashes to the client role", async () => {
    await expect(asUser(db, DEMO_USER_IDS.admin, (tx) => tx.query("select key_hash from public.api_keys"))).rejects.toThrow(/permission denied/);
  });
});

describe("admin functions", () => {
  it("only admins can change roles", async () => {
    await expect(
      asUser(db, DEMO_USER_IDS.manager, (tx) => tx.query("select public.change_profile_role($1, 'admin')", [DEMO_USER_IDS.repDaniel])),
    ).rejects.toThrow(/forbidden/);
    const role = await asUser(db, DEMO_USER_IDS.admin, async (tx) => {
      const r = await tx.query<{ role: string }>("select (public.change_profile_role($1, 'manager')).role as role", [DEMO_USER_IDS.repDaniel]);
      return r.rows[0]!.role;
    });
    expect(role).toBe("manager");
  });

  it("refuses to demote the last admin", async () => {
    await expect(
      asUser(db, DEMO_USER_IDS.admin, (tx) => tx.query("select public.change_profile_role($1, 'sales_rep')", [DEMO_USER_IDS.admin])),
    ).rejects.toThrow(/last_admin/);
  });

  it("reorders stages atomically and rejects incomplete orderings", async () => {
    const ids = [...seed.pipeline_stages].sort((a, b) => a.position - b.position).map((s) => s.id);
    const swapped = [ids[1]!, ids[0]!, ...ids.slice(2)];
    const names = await asUser(db, DEMO_USER_IDS.admin, async (tx) => {
      await tx.query("select public.reorder_pipeline_stages($1::uuid[])", [swapped]);
      await tx.exec("set constraints all immediate");
      return (await tx.query<{ name: string }>("select name from public.pipeline_stages order by position")).rows.map((r) => r.name);
    });
    expect(names.slice(0, 2)).toEqual(["Discovery", "Qualification"]);
    await expect(
      asUser(db, DEMO_USER_IDS.admin, (tx) => tx.query("select public.reorder_pipeline_stages($1::uuid[])", [ids.slice(1)])),
    ).rejects.toThrow(/invalid_order/);
  });

  it("adds a new open stage before won/lost and keeps one won stage", async () => {
    const names = await asUser(db, DEMO_USER_IDS.admin, async (tx) => {
      await tx.query("select public.create_pipeline_stage('Technical review', 60, false, false)");
      await tx.exec("set constraints all immediate");
      return (await tx.query<{ name: string }>("select name from public.pipeline_stages order by position")).rows.map((r) => r.name);
    });
    expect(names.slice(-3)).toEqual(["Technical review", "Won", "Lost"]);
    await expect(
      asUser(db, DEMO_USER_IDS.admin, (tx) => tx.query("select public.create_pipeline_stage('Second won', 100, true, false)")),
    ).rejects.toThrow(/terminal_stage/);
  });

  it("refuses stage changes from non-admins", async () => {
    await expect(
      asUser(db, DEMO_USER_IDS.repDaniel, (tx) => tx.query("select public.create_pipeline_stage('Sneaky', 10, false, false)")),
    ).rejects.toThrow(/forbidden/);
  });
});
