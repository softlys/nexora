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
import { DEMO_PIPELINE_IDS } from "@/domain/seed/generate";

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

  it("accept online payments (is_simulated false) but reject unknown methods", async () => {
    const p = seed.payments[0]!;
    await expect(
      db.query("insert into public.payments (organization_id, order_id, amount, method, is_simulated) values ($1, $2, 10, 'card', false)", [p.organization_id, p.order_id]),
    ).resolves.toBeDefined();
    await expect(
      db.query("insert into public.payments (organization_id, order_id, amount, method, is_simulated) values ($1, $2, 10, 'crypto', false)", [p.organization_id, p.order_id]),
    ).rejects.toThrow(/check constraint/);
  });

  it("keep integration records unique per organization, source and external id, and accept message activities", async () => {
    const org = seed.organizations[0]!.id;
    await db.query("insert into public.integration_records (organization_id, source, external_id) values ($1, 'mango', 'entry-1')", [org]);
    await expect(db.query("insert into public.integration_records (organization_id, source, external_id) values ($1, 'mango', 'entry-1')", [org])).rejects.toThrow(/duplicate key/);
    const contact = seed.contacts[0]!;
    await expect(
      db.query("insert into public.activities (organization_id, type, subject, contact_id, occurred_at) values ($1, 'message', 'WhatsApp', $2, now())", [contact.organization_id, contact.id]),
    ).resolves.toBeDefined();
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

  it("lets members read custom fields and only admins define them; records carry their values", async () => {
    const org = seed.organizations[0]!.id;
    const insert = "insert into public.custom_fields (organization_id, entity, key, label, type) values ($1, 'company', 'inn', 'ИНН', 'text')";
    await expect(asUser(db, DEMO_USER_IDS.manager, (tx) => tx.query(insert, [org]))).rejects.toThrow(/row-level security/);
    await asUser(db, DEMO_USER_IDS.admin, (tx) => tx.query(insert, [org]));
    // asUser rolls back, so the field is added once more for the read check.
    await db.query(insert, [org]);
    expect(await count(DEMO_USER_IDS.repDaniel, "public.custom_fields")).toBe(1);
    const mine = seed.companies.find((c) => c.owner_id === DEMO_USER_IDS.repDaniel)!;
    const custom = await asUser(db, DEMO_USER_IDS.repDaniel, async (tx) => {
      await tx.query(`update public.companies set custom = '{"inn": "7701234567"}' where id = $1`, [mine.id]);
      const saved = (await tx.query<{ custom: unknown }>("select custom from public.companies where id = $1", [mine.id])).rows[0]!.custom;
      await expect(tx.query("update public.companies set custom = '[]' where id = $1", [mine.id])).rejects.toThrow(/check constraint/);
      return saved;
    });
    expect(custom).toEqual({ inn: "7701234567" });
  });

  it("lets members read e-mail templates and only admins change them", async () => {
    const seeded = seed.email_templates.length;
    expect(await count(DEMO_USER_IDS.repDaniel, "public.email_templates")).toBe(seeded);
    const update = "update public.email_templates set subject = 'Changed' where id = $1";
    const changed = await asUser(db, DEMO_USER_IDS.repDaniel, async (tx) => (await tx.query(update, [seed.email_templates[0]!.id])).affectedRows);
    expect(changed).toBe(0);
    const byAdmin = await asUser(db, DEMO_USER_IDS.admin, async (tx) => (await tx.query(update, [seed.email_templates[0]!.id])).affectedRows);
    expect(byAdmin).toBe(1);
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

  it("reorders stages atomically within a pipeline and rejects incomplete orderings", async () => {
    const sales = DEMO_PIPELINE_IDS.sales;
    const ids = seed.pipeline_stages.filter((s) => s.pipeline_id === sales).sort((a, b) => a.position - b.position).map((s) => s.id);
    const swapped = [ids[1]!, ids[0]!, ...ids.slice(2)];
    const names = await asUser(db, DEMO_USER_IDS.admin, async (tx) => {
      await tx.query("select public.reorder_pipeline_stages($1, $2::uuid[])", [sales, swapped]);
      await tx.exec("set constraints all immediate");
      return (await tx.query<{ name: string }>("select name from public.pipeline_stages where pipeline_id = $1 order by position", [sales])).rows.map((r) => r.name);
    });
    expect(names.slice(0, 2)).toEqual(["Discovery", "Qualification"]);
    await expect(
      asUser(db, DEMO_USER_IDS.admin, (tx) => tx.query("select public.reorder_pipeline_stages($1, $2::uuid[])", [sales, ids.slice(1)])),
    ).rejects.toThrow(/invalid_order/);
    // A stage of another pipeline is not part of this pipeline's order.
    const tender = seed.pipeline_stages.find((s) => s.pipeline_id === DEMO_PIPELINE_IDS.tenders)!.id;
    await expect(
      asUser(db, DEMO_USER_IDS.admin, (tx) => tx.query("select public.reorder_pipeline_stages($1, $2::uuid[])", [sales, [...ids.slice(1), tender]])),
    ).rejects.toThrow(/invalid_order/);
  });

  it("adds a new open stage before won/lost and keeps one won stage per pipeline", async () => {
    const sales = DEMO_PIPELINE_IDS.sales;
    const names = await asUser(db, DEMO_USER_IDS.admin, async (tx) => {
      await tx.query("select public.create_pipeline_stage($1, 'Technical review', 60, false, false)", [sales]);
      await tx.exec("set constraints all immediate");
      return (await tx.query<{ name: string }>("select name from public.pipeline_stages where pipeline_id = $1 order by position", [sales])).rows.map((r) => r.name);
    });
    expect(names.slice(-3)).toEqual(["Technical review", "Won", "Lost"]);
    await expect(
      asUser(db, DEMO_USER_IDS.admin, (tx) => tx.query("select public.create_pipeline_stage($1, 'Second won', 100, true, false)", [sales])),
    ).rejects.toThrow(/terminal_stage/);
    // The same name is fine in another pipeline: names are unique per pipeline.
    await asUser(db, DEMO_USER_IDS.admin, (tx) => tx.query("select public.create_pipeline_stage($1, 'Proposal', 40, false, false)", [DEMO_PIPELINE_IDS.tenders]));
  });

  it("creates, renames and deletes pipelines with their own won and lost stages", async () => {
    const stages = JSON.stringify([
      { name: "Won", probability: 100, is_won: true, is_lost: false },
      { name: "New", probability: 10, is_won: false, is_lost: false },
      { name: "Lost", probability: 0, is_won: false, is_lost: true },
    ]);
    const result = await asUser(db, DEMO_USER_IDS.admin, async (tx) => {
      const created = (await tx.query<{ id: string }>("select (public.create_pipeline('Wholesale', $1::jsonb)).id", [stages])).rows[0]!.id;
      await tx.exec("set constraints all immediate");
      const order = (await tx.query<{ name: string }>("select name from public.pipeline_stages where pipeline_id = $1 order by position", [created])).rows.map((r) => r.name);
      await tx.query("select public.rename_pipeline($1, 'Опт')", [created]);
      const renamed = (await tx.query<{ name: string }>("select name from public.pipelines where id = $1", [created])).rows[0]!.name;
      await tx.query("select public.delete_pipeline($1)", [created]);
      const left = (await tx.query<{ n: number }>("select count(*)::int as n from public.pipeline_stages where pipeline_id = $1", [created])).rows[0]!.n;
      return { order, renamed, left };
    });
    expect(result).toEqual({ order: ["New", "Won", "Lost"], renamed: "Опт", left: 0 });
    await expect(
      asUser(db, DEMO_USER_IDS.admin, (tx) => tx.query("select public.create_pipeline('Broken', $1::jsonb)", [JSON.stringify([{ name: "Only open", probability: 10, is_won: false, is_lost: false }])])),
    ).rejects.toThrow(/terminal_stage/);
    await expect(asUser(db, DEMO_USER_IDS.admin, (tx) => tx.query("select public.delete_pipeline($1)", [DEMO_PIPELINE_IDS.sales]))).rejects.toThrow(/pipeline_has_deals/);
    await expect(asUser(db, DEMO_USER_IDS.manager, (tx) => tx.query("select public.create_pipeline('Sneaky', $1::jsonb)", [stages]))).rejects.toThrow(/forbidden/);
  });

  it("refuses stage changes from non-admins", async () => {
    await expect(
      asUser(db, DEMO_USER_IDS.repDaniel, (tx) => tx.query("select public.create_pipeline_stage($1, 'Sneaky', 10, false, false)", [DEMO_PIPELINE_IDS.sales])),
    ).rejects.toThrow(/forbidden/);
  });

  it("numbers orders across the whole organization even when a rep sees only their own", async () => {
    const year = Number(seed.orders[0]!.order_number.slice(3, 7));
    const all = seed.orders.filter((o) => o.order_number.startsWith(`NX-${year}-`)).map((o) => Number(o.order_number.slice(8)));
    const next = await asUser(db, DEMO_USER_IDS.repDaniel, async (tx) => (await tx.query<{ n: string }>("select public.next_order_number($1) as n", [year])).rows[0]!.n);
    expect(next).toBe(`NX-${year}-${String(Math.max(...all) + 1).padStart(4, "0")}`);
    const visibleToRep = seed.orders.filter((o) => o.owner_id === DEMO_USER_IDS.repDaniel).length;
    expect(visibleToRep).toBeLessThan(seed.orders.length);
  });
});
