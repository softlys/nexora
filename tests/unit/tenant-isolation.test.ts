/**
 * Two organizations in one database: users of one must not see or change a single row of the
 * other, in any table, whatever their role (audit NX-006). Also checks that the security log is
 * append-only for the server alone (NX-003).
 */
import type { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { Dataset } from "@/domain/entities";
import { generateSeed } from "@/domain/seed/generate";
import { asUser, createDatabase, loadDataset } from "./helpers/pglite";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/** The same seed with every id, email, slug and key hash replaced: a second, unrelated organization. */
function otherOrganization(data: Dataset): Dataset {
  const remap = (id: string) => {
    const h = createHash("sha256").update(`other:${id}`).digest("hex");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
  };
  const json = JSON.stringify(data)
    .replace(UUID, (id) => remap(id))
    .replace(/"email":"([^"]+)"/g, '"email":"other.$1"')
    .replace(/"slug":"([^"]+)"/g, '"slug":"other-$1"')
    .replace(/"key_hash":"([0-9a-f]+)"/g, (_m, h: string) => `"key_hash":"${createHash("sha256").update(`other:${h}`).digest("hex")}"`);
  return JSON.parse(json) as Dataset;
}

const seed = generateSeed(new Date("2026-10-19T12:00:00Z"));
const other = otherOrganization(seed);
let db: PGlite;

// Every table with organization data (organizations itself is checked by id).
const TABLES = [
  "profiles", "companies", "contacts", "leads", "pipeline_stages", "deals", "deal_stage_history", "products", "orders", "order_items", "payments",
  "tasks", "activities", "comments", "notifications", "automation_workflows", "automation_executions", "integration_settings", "webhook_deliveries",
  "audit_logs", "security_events", "api_idempotency_keys",
];

beforeAll(async () => {
  db = await createDatabase();
  await loadDataset(db, seed);
  await loadDataset(db, other);
}, 180_000);

describe("tenant isolation", () => {
  const otherOrg = () => other.organizations[0]!.id;

  for (const profile of seed.profiles.filter((p) => p.is_active)) {
    it(`${profile.full_name} (${profile.role}) sees nothing of the other organization`, async () => {
      await asUser(db, profile.id, async (tx) => {
        const orgs = await tx.query<{ n: number }>("select count(*)::int as n from public.organizations where id = $1", [otherOrg()]);
        expect(orgs.rows[0]!.n).toBe(0);
        for (const table of TABLES) {
          // A table closed to client roles entirely ("permission denied") is invisible too.
          await tx.exec("savepoint probe");
          const visible = await tx
            .query<{ n: number }>(`select count(*)::int as n from public.${table} where organization_id = $1`, [otherOrg()])
            .then((r) => r.rows[0]!.n)
            .catch(async (error: Error) => {
              expect(error.message, table).toMatch(/permission denied/);
              await tx.exec("rollback to savepoint probe");
              return 0;
            });
          expect(visible, table).toBe(0);
        }
      });
    });
  }

  it("cannot change or delete another organization's records, even as admin", async () => {
    const admin = seed.profiles.find((p) => p.role === "admin")!;
    await asUser(db, admin.id, async (tx) => {
      for (const table of ["companies", "deals", "orders", "tasks", "leads", "contacts"]) {
        const updated = await tx.query(`update public.${table} set updated_at = now() where organization_id = $1 returning id`, [otherOrg()]);
        expect(updated.rows, table).toHaveLength(0);
        const deleted = await tx.query(`delete from public.${table} where organization_id = $1 returning id`, [otherOrg()]).catch(() => ({ rows: [] }));
        expect(deleted.rows, table).toHaveLength(0);
      }
    });
    const left = await db.query<{ n: number }>("select count(*)::int as n from public.companies where organization_id = $1", [otherOrg()]);
    expect(left.rows[0]!.n).toBe(other.companies.length);
  });

  it("cannot create records inside another organization", async () => {
    const admin = seed.profiles.find((p) => p.role === "admin")!;
    await expect(
      asUser(db, admin.id, (tx) => tx.query("insert into public.companies (organization_id, name, owner_id) values ($1, 'Injected', $2)", [otherOrg(), admin.id])),
    ).rejects.toThrow();
  });
});

describe("security log", () => {
  it("cannot be appended to by signed-in users, only by the server", async () => {
    const rep = seed.profiles.find((p) => p.role === "sales_rep")!;
    await expect(
      asUser(db, rep.id, (tx) =>
        tx.query(
          `insert into public.security_events (event_id, organization_id, sequence, occurred_at, category, action, outcome, severity, actor, source, target, metadata, prev_hash, hash)
           values (gen_random_uuid(), $1, 999999, now(), 'system', 'system.heartbeat', 'success', 'info', '{}', '{}', '{}', '{}', $2, $2)`,
          [rep.organization_id, "0".repeat(64)],
        ),
      ),
    ).rejects.toThrow(/permission denied|row-level security/);
  });
});
