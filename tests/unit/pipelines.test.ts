import { beforeEach, describe, expect, it } from "vitest";
import type { Dataset } from "@/domain/entities";
import { dealInput } from "@/domain/inputs";
import { DEMO_PIPELINE_IDS } from "@/domain/seed/generate";
import type { Db } from "@/server/db/types";
import { getAnalytics } from "@/server/services/analytics";
import { createDeal, getPipelineBoard, listDeals, moveDealStage } from "@/server/services/deals";
import { createTestDb, ctxFor, DEMO_USER_IDS, NOW } from "./helpers/services";

const query = { q: "", page: 1, size: 100, sort: undefined, dir: undefined, archived: undefined } as never;

describe("several pipelines", () => {
  let db: Db;
  let data: () => Dataset;
  beforeEach(() => {
    ({ db, data } = createTestDb());
  });
  const admin = () => ctxFor(db, data(), DEMO_USER_IDS.admin);
  const company = () => data().companies.find((c) => !c.archived_at)!;
  const base = () => ({ name: "Тендер на поставку труб", company_id: company().id, primary_contact_id: null, amount: 500_000, currency: "USD", expected_close_date: null, source: "outbound", next_activity: "", notes: "" });

  it("seeds a default sales pipeline and a tenders pipeline, each with one won and one lost stage", () => {
    const pipelines = data().pipelines;
    expect(pipelines.map((p) => p.name)).toEqual(["Sales", "Tenders"]);
    for (const p of pipelines) {
      const stages = data().pipeline_stages.filter((s) => s.pipeline_id === p.id);
      expect(stages.filter((s) => s.is_won)).toHaveLength(1);
      expect(stages.filter((s) => s.is_lost)).toHaveLength(1);
    }
    // Existing deals stay in the default pipeline.
    const salesStages = new Set(data().pipeline_stages.filter((s) => s.pipeline_id === DEMO_PIPELINE_IDS.sales).map((s) => s.id));
    expect(data().deals.every((d) => salesStages.has(d.stage_id))).toBe(true);
  });

  it("starts a new deal in the chosen pipeline's first stage, or the default pipeline's", async () => {
    const tender = await createDeal(admin(), dealInput.parse({ ...base(), pipeline_id: DEMO_PIPELINE_IDS.tenders }));
    expect(data().pipeline_stages.find((s) => s.id === tender.stage_id)).toMatchObject({ pipeline_id: DEMO_PIPELINE_IDS.tenders, name: "Tender found" });
    const plain = await createDeal(admin(), dealInput.parse(base()));
    expect(data().pipeline_stages.find((s) => s.id === plain.stage_id)).toMatchObject({ pipeline_id: DEMO_PIPELINE_IDS.sales, name: "Qualification" });
  });

  it("shows one pipeline on the board and filters the deal list by pipeline", async () => {
    const tender = await createDeal(admin(), dealInput.parse({ ...base(), pipeline_id: DEMO_PIPELINE_IDS.tenders }));
    const board = await getPipelineBoard(admin(), { pipeline: DEMO_PIPELINE_IDS.tenders });
    expect(board.pipeline.id).toBe(DEMO_PIPELINE_IDS.tenders);
    expect(board.stages.map((s) => s.name)).toEqual(["Tender found", "Documents prepared", "Bid submitted", "Won", "Lost"]);
    expect(board.deals.map((d) => d.id)).toEqual([tender.id]);
    // Without a choice the board shows the default pipeline.
    expect((await getPipelineBoard(admin(), {})).pipeline.id).toBe(DEMO_PIPELINE_IDS.sales);

    const tenders = await listDeals(admin(), query, { pipeline: DEMO_PIPELINE_IDS.tenders });
    expect(tenders.rows.map((d) => d.id)).toEqual([tender.id]);
    expect(tenders.rows[0]).toMatchObject({ pipeline_id: DEMO_PIPELINE_IDS.tenders, pipeline_name: "Tenders" });
    const all = await listDeals(admin(), query, {});
    expect(all.rows.length).toBe(data().deals.filter((d) => !d.archived_at).length);
  });

  it("moves a deal into another pipeline through one of its stages", async () => {
    const deal = data().deals.find((d) => !d.archived_at && !d.closed_at)!;
    const bid = data().pipeline_stages.find((s) => s.pipeline_id === DEMO_PIPELINE_IDS.tenders && s.name === "Bid submitted")!;
    const moved = await moveDealStage(admin(), { deal_id: deal.id, stage_id: bid.id });
    expect(moved).toMatchObject({ stage_id: bid.id, probability: 50 });
    const board = await getPipelineBoard(admin(), { pipeline: DEMO_PIPELINE_IDS.tenders });
    expect(board.deals.map((d) => d.id)).toContain(deal.id);
  });

  it("computes the funnel and distribution per pipeline", async () => {
    const period = { from: "2025-01-01", to: NOW.toISOString().slice(0, 10) };
    const sales = await getAnalytics(admin(), period);
    expect(sales.pipeline?.id).toBe(DEMO_PIPELINE_IDS.sales);
    expect(sales.funnel.map((s) => s.stage)).toEqual(["Qualification", "Discovery", "Proposal", "Negotiation", "Commitment", "Won"]);
    const tenders = await getAnalytics(admin(), period, DEMO_PIPELINE_IDS.tenders);
    expect(tenders.funnel.map((s) => s.stage)).toEqual(["Tender found", "Documents prepared", "Bid submitted", "Won"]);
    expect(tenders.funnel.every((s) => s.count === 0)).toBe(true);
    // Totals stay organization-wide.
    expect(tenders.totals.wonDealValue).toBe(sales.totals.wonDealValue);
  });
});
