/**
 * Pipeline math: stage moves, weighted forecast and stage duration statistics.
 * Pure functions over plain records.
 */
import type { Deal, DealStageHistory, PipelineStage } from "../entities";

export type StageMove = {
  stage_id: string;
  probability: number;
  stage_entered_at: string;
  closed_at: string | null;
  lost_reason: string | null;
};

export class StageMoveError extends Error {
  constructor(
    message: string,
    public readonly code: "lost_reason_required" | "same_stage" | "unknown_stage",
  ) {
    super(message);
    this.name = "StageMoveError";
  }
}

/** Computes the deal fields that change when it enters `to`. Probability resets to the stage default. */
export function planStageMove(deal: Pick<Deal, "stage_id" | "closed_at">, to: PipelineStage | undefined, lostReason: string | null, now: Date): StageMove {
  if (!to) throw new StageMoveError("Unknown stage.", "unknown_stage");
  if (deal.stage_id === to.id) throw new StageMoveError("The deal is already in this stage.", "same_stage");
  const reason = lostReason?.trim() || null;
  if (to.is_lost && !reason) throw new StageMoveError("A lost reason is required.", "lost_reason_required");
  const at = now.toISOString();
  return {
    stage_id: to.id,
    probability: to.probability,
    stage_entered_at: at,
    closed_at: to.is_won || to.is_lost ? at : null,
    lost_reason: to.is_lost ? reason : null,
  };
}

export type StageSummary = {
  stage_id: string;
  count: number;
  total: number;
  weighted: number;
};

/** Per-stage count, total amount and weighted amount (amount × probability). Open stages only contribute to the forecast. */
export function summarizeStages(stages: PipelineStage[], deals: Array<Pick<Deal, "stage_id" | "amount" | "probability">>): {
  stages: StageSummary[];
  openTotal: number;
  weightedTotal: number;
} {
  const byStage = new Map<string, StageSummary>(stages.map((s) => [s.id, { stage_id: s.id, count: 0, total: 0, weighted: 0 }]));
  for (const d of deals) {
    const s = byStage.get(d.stage_id);
    if (!s) continue;
    s.count += 1;
    s.total += d.amount;
    s.weighted += (d.amount * d.probability) / 100;
  }
  const open = stages.filter((s) => !s.is_won && !s.is_lost).map((s) => byStage.get(s.id)!);
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    stages: [...byStage.values()].map((s) => ({ ...s, total: round(s.total), weighted: round(s.weighted) })),
    openTotal: round(open.reduce((a, s) => a + s.total, 0)),
    weightedTotal: round(open.reduce((a, s) => a + s.weighted, 0)),
  };
}

const DAY = 86_400_000;

export function daysInStage(deal: Pick<Deal, "stage_entered_at">, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(deal.stage_entered_at)) / DAY));
}

/**
 * Average and median days deals spent in each stage, from stage history.
 * A visit ends at the next history entry for the same deal; open visits end now.
 */
export function stageDurations(history: DealStageHistory[], now: Date): Record<string, { visits: number; averageDays: number; medianDays: number }> {
  const byDeal = new Map<string, DealStageHistory[]>();
  for (const h of history) byDeal.set(h.deal_id, [...(byDeal.get(h.deal_id) ?? []), h]);
  const durations = new Map<string, number[]>();
  for (const entries of byDeal.values()) {
    entries.sort((a, b) => a.changed_at.localeCompare(b.changed_at));
    entries.forEach((entry, i) => {
      const end = entries[i + 1]?.changed_at ?? now.toISOString();
      const days = (Date.parse(end) - Date.parse(entry.changed_at)) / DAY;
      durations.set(entry.to_stage_id, [...(durations.get(entry.to_stage_id) ?? []), days]);
    });
  }
  const out: Record<string, { visits: number; averageDays: number; medianDays: number }> = {};
  for (const [stageId, list] of durations) {
    const sorted = [...list].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
    out[stageId] = {
      visits: list.length,
      averageDays: Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 10) / 10,
      medianDays: Math.round(median * 10) / 10,
    };
  }
  return out;
}
