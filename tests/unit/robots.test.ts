import { beforeEach, describe, expect, it } from "vitest";
import type { Dataset } from "@/domain/entities";
import { handleEvent, triggerMatches, type EngineDeps } from "@/server/automation/engine";
import { createRobot, robotBoard, robotDefinition, robotInput } from "@/server/automation/robots";
import type { Db } from "@/server/db/types";
import { moveDealStage } from "@/server/services/deals";
import { generateSeed } from "@/domain/seed/generate";
import { DEMO_PIPELINE_IDS } from "@/domain/seed/generate";
import { createTestDb, ctxFor, DEMO_USER_IDS, NOW } from "./helpers/services";

describe("robots on pipeline stages", () => {
  let db: Db;
  let data: () => Dataset;
  let deps: EngineDeps;
  beforeEach(() => {
    const seed = generateSeed(NOW);
    seed.automation_workflows = [];
    seed.automation_executions = [];
    ({ db, data } = createTestDb(seed));
    deps = { db, meta: { ip: null, user_agent: "vitest", request_id: "robots" }, now: () => NOW };
  });
  const admin = () => ctxFor(db, data(), DEMO_USER_IDS.admin);
  const rep = () => ctxFor(db, data(), DEMO_USER_IDS.repDaniel);
  const stages = () => data().pipeline_stages.filter((s) => s.pipeline_id === DEMO_PIPELINE_IDS.sales).sort((a, b) => a.position - b.position);

  it("fires only when a deal enters its own stage", () => {
    const [a, b] = stages();
    const def = robotDefinition(robotInput.parse({ stage_id: a!.id, kind: "task" }));
    const event = (to: string) => ({ id: "e", organization_id: "o", type: "deal.stage_changed", occurred_at: NOW.toISOString(), actor_id: null, payload: { deal_id: "d", from_stage_id: null, to_stage_id: to, is_won: false, is_lost: false, lost_reason: null } }) as never;
    expect(triggerMatches(def, event(a!.id))).toBe(true);
    expect(triggerMatches(def, event(b!.id))).toBe(false);
  });

  it("creates a task for the deal owner when a deal enters the stage", async () => {
    const target = stages().find((s) => !s.is_won && !s.is_lost && s.position > 0)!;
    const robot = await createRobot(admin(), robotInput.parse({ stage_id: target.id, kind: "task", text: "Позвонить по {{deal.name}}", due_days: 2, task_type: "call" }));
    expect(robot.enabled).toBe(true);
    const board = await robotBoard(admin(), DEMO_PIPELINE_IDS.sales);
    expect(board.stages.find((s) => s.id === target.id)?.robots.map((r) => r.id)).toEqual([robot.id]);

    const deal = data().deals.find((d) => d.owner_id === DEMO_USER_IDS.repDaniel && !d.closed_at && !d.archived_at && d.stage_id !== target.id)!;
    const ctx = { ...rep(), pendingEvents: [] as never[] };
    await moveDealStage(ctx, { deal_id: deal.id, stage_id: target.id } as never);
    for (const e of ctx.pendingEvents ?? []) await handleEvent(deps, e);
    const task = data().tasks.find((t) => t.deal_id === deal.id && t.title === `Позвонить по ${deal.name}`);
    expect(task).toMatchObject({ assignee_id: DEMO_USER_IDS.repDaniel, type: "call" });
  });

  it("lets only admins and managers add robots", async () => {
    await expect(createRobot(rep(), robotInput.parse({ stage_id: stages()[0]!.id, kind: "notify" }))).rejects.toThrow();
    expect(robotInput.safeParse({ stage_id: stages()[0]!.id, kind: "probability", probability: 150 }).success).toBe(false);
  });
});
