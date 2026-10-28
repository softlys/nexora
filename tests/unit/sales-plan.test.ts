import { beforeEach, describe, expect, it } from "vitest";
import type { Dataset } from "@/domain/entities";
import type { Db } from "@/server/db/types";
import { monthPeriod, salesPlan, setTarget, targetInput } from "@/server/services/sales-plan";
import { createTestDb, ctxFor, DEMO_USER_IDS, NOW } from "./helpers/services";

describe("sales plan", () => {
  let db: Db;
  let data: () => Dataset;
  beforeEach(() => {
    ({ db, data } = createTestDb());
  });
  const ctx = (id: string) => ctxFor(db, data(), id);
  const month = NOW.toISOString().slice(0, 7);

  it("knows the days of a month", () => {
    expect(monthPeriod("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthPeriod("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("seeds demo plans and compares them with won deals, calls and meetings", async () => {
    expect(data().sales_targets.some((t) => t.period === month)).toBe(true);
    const plan = await salesPlan(ctx(DEMO_USER_IDS.admin), month);
    const daniel = plan.rows.find((r) => r.profile_id === DEMO_USER_IDS.repDaniel)!;
    const won = new Set(data().pipeline_stages.filter((s) => s.is_won).map((s) => s.id));
    const expected = data().deals.filter((d) => !d.archived_at && d.owner_id === DEMO_USER_IDS.repDaniel && won.has(d.stage_id) && d.closed_at?.startsWith(month)).reduce((s, d) => s + d.amount, 0);
    expect(daniel.won_amount).toBeCloseTo(expected, 2);
    expect(daniel.completion).toBeCloseTo(expected / daniel.target!, 5);
    expect(daniel.calls).toBe(data().activities.filter((a) => a.actor_id === DEMO_USER_IDS.repDaniel && a.type === "call" && a.occurred_at.startsWith(month)).length);
    // Ranked by completion.
    const completions = plan.rows.map((r) => r.completion ?? -1);
    expect([...completions].sort((a, b) => b - a)).toEqual(completions);
  });

  it("shows a rep only themselves and lets managers set their team's plans", async () => {
    const repPlan = await salesPlan(ctx(DEMO_USER_IDS.repDaniel), month);
    expect(repPlan.rows.map((r) => r.profile_id)).toEqual([DEMO_USER_IDS.repDaniel]);
    expect(repPlan.rows[0]!.can_edit).toBe(false);
    await expect(setTarget(ctx(DEMO_USER_IDS.repDaniel), targetInput.parse({ profile_id: DEMO_USER_IDS.repDaniel, period: month, amount: 1 }))).rejects.toThrow();

    await setTarget(ctx(DEMO_USER_IDS.manager), targetInput.parse({ profile_id: DEMO_USER_IDS.repDaniel, period: month, amount: 250000 }));
    expect(data().sales_targets.filter((t) => t.profile_id === DEMO_USER_IDS.repDaniel && t.period === month).map((t) => t.amount)).toEqual([250000]);
    // Ethan reports to the admin, not to this manager.
    await expect(setTarget(ctx(DEMO_USER_IDS.manager), targetInput.parse({ profile_id: DEMO_USER_IDS.repEthan, period: month, amount: 1 }))).rejects.toThrow();
    await setTarget(ctx(DEMO_USER_IDS.admin), targetInput.parse({ profile_id: DEMO_USER_IDS.repEthan, period: "2027-01", amount: 1000 }));
  });
});
