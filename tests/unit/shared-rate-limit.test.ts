/**
 * Rate limits and bulk-read counting shared by every server instance (audit NX-007): the
 * PostgreSQL counter behind them, and the limiter on top of any shared counter.
 */
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { hitRateLimit, RATE_LIMITS, type Counter } from "@/server/security/rate-limit";
import { createDatabase } from "./helpers/pglite";

let db: PGlite;
beforeAll(async () => {
  db = await createDatabase();
}, 120_000);

const hit = async (id: string, windowSeconds: number, amount: number) =>
  Number((await db.query<{ count: number }>("select count from public.hit_counter($1, $2, $3)", [id, windowSeconds, amount])).rows[0]!.count);

describe("public.hit_counter", () => {
  it("adds up within the window across callers", async () => {
    expect(await hit("rl:test:a", 60, 1)).toBe(1);
    expect(await hit("rl:test:a", 60, 1)).toBe(2);
    expect(await hit("rl:test:a", 60, 5)).toBe(7);
    expect(await hit("rl:test:b", 60, 1)).toBe(1);
  });

  it("starts a new window once the old one has passed", async () => {
    await hit("rl:test:old", 60, 50);
    await db.query("update private.rate_counters set window_start = now() - interval '2 minutes' where id = 'rl:test:old'");
    expect(await hit("rl:test:old", 60, 1)).toBe(1);
  });

  it("cannot be called by signed-in users", async () => {
    await db.exec("begin; set local role authenticated;");
    await expect(db.query("select * from public.hit_counter('x', 60, 1)")).rejects.toThrow(/permission denied/);
    await db.exec("rollback");
  });
});

describe("hitRateLimit with a shared counter", () => {
  it("allows up to the limit and reports the first blocked request once", async () => {
    const totals = new Map<string, number>();
    // Two "instances" share this counter, like two servers sharing PostgreSQL.
    const counter: Counter = async (id, _w, amount) => {
      totals.set(id, (totals.get(id) ?? 0) + amount);
      return totals.get(id)!;
    };
    const { limit } = RATE_LIMITS.api_auth;
    const results = [];
    for (let i = 0; i < limit + 2; i++) results.push(await hitRateLimit("203.0.113.9", "api_auth", counter));
    expect(results.slice(0, limit).every((r) => r.allowed)).toBe(true);
    expect(results[limit]).toMatchObject({ allowed: false, firstBlocked: true });
    expect(results[limit + 1]).toMatchObject({ allowed: false, firstBlocked: false });
  });
});
