import { z } from "zod";
import type { SalesTarget } from "@/domain/entities";
import { inPeriod, type Period } from "@/domain/metrics";
import { ownerInScope, visibleOwnerIds } from "@/domain/permissions";
import { DomainError } from "@/server/repositories/types";
import { emit, newId, nowOf, requireCan, type ServiceContext } from "./context";

/**
 * Sales plan and KPI (план продаж): a monthly won-deal target per person and, for the same month,
 * what they closed, how many calls and meetings they logged, their win rate and a forecast. The
 * ranking orders people by plan completion. Everyone sees the people within their deal scope;
 * admins set any target, managers the targets of their team.
 */

export const monthInput = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export function monthPeriod(month: string): Period {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

export type PlanRow = {
  profile_id: string;
  name: string;
  role: string;
  target: number | null;
  target_deals: number | null;
  won_amount: number;
  won_count: number;
  lost_count: number;
  /** Won ÷ (won + lost) among deals closed in the month. */
  win_rate: number | null;
  calls: number;
  meetings: number;
  /** Won so far plus open deals expected to close this month, weighted by probability. */
  forecast: number;
  /** won_amount ÷ target. */
  completion: number | null;
  can_edit: boolean;
};

export type SalesPlan = { month: string; rows: PlanRow[]; total: { target: number; won_amount: number; completion: number | null; forecast: number }; canSetTargets: boolean };

export async function salesPlan(ctx: ServiceContext, month: string): Promise<SalesPlan> {
  requireCan(ctx, "view", "analytics");
  const period = monthPeriod(month);
  return ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const [profiles, deals, stages, activities, targets] = await Promise.all([tx.find("profiles"), tx.find("deals", { archived_at: null }), tx.find("pipeline_stages"), tx.find("activities"), tx.find("sales_targets", { period: month })]);
    const scope = visibleOwnerIds(ctx.actor, "deal");
    const inScope = (id: string) => scope === "all" || scope.includes(id);
    const stage = new Map(stages.map((s) => [s.id, s]));
    const people = profiles.filter((p) => p.is_active && !p.archived_at && inScope(p.id) && (p.role !== "admin" || targets.some((t) => t.profile_id === p.id) || deals.some((d) => d.owner_id === p.id && inPeriod(d.closed_at, period))));
    const canSet = ctx.actor.role === "admin" || ctx.actor.role === "manager";
    const rows: PlanRow[] = people.map((p) => {
      const mine = deals.filter((d) => d.owner_id === p.id);
      const won = mine.filter((d) => stage.get(d.stage_id)?.is_won && inPeriod(d.closed_at, period));
      const lost = mine.filter((d) => stage.get(d.stage_id)?.is_lost && inPeriod(d.closed_at, period));
      const open = mine.filter((d) => !d.closed_at && inPeriod(d.expected_close_date, period));
      const wonAmount = won.reduce((s, d) => s + d.amount, 0);
      const target = targets.find((t) => t.profile_id === p.id) ?? null;
      const acts = activities.filter((a) => a.actor_id === p.id && inPeriod(a.occurred_at, period));
      return {
        profile_id: p.id,
        name: p.full_name,
        role: p.role,
        target: target ? Number(target.amount) : null,
        target_deals: target?.deals ?? null,
        won_amount: Math.round(wonAmount * 100) / 100,
        won_count: won.length,
        lost_count: lost.length,
        win_rate: won.length + lost.length ? won.length / (won.length + lost.length) : null,
        calls: acts.filter((a) => a.type === "call").length,
        meetings: acts.filter((a) => a.type === "meeting").length,
        forecast: Math.round((wonAmount + open.reduce((s, d) => s + (d.amount * d.probability) / 100, 0)) * 100) / 100,
        completion: target && Number(target.amount) > 0 ? wonAmount / Number(target.amount) : null,
        can_edit: ctx.actor.role === "admin" || (ctx.actor.role === "manager" && p.id !== ctx.actor.id && ownerInScope(ctx.actor, "update", "deal", p.id)),
      };
    });
    rows.sort((a, b) => (b.completion ?? -1) - (a.completion ?? -1) || b.won_amount - a.won_amount || a.name.localeCompare(b.name));
    const target = rows.reduce((s, r) => s + (r.target ?? 0), 0);
    const won = rows.reduce((s, r) => s + r.won_amount, 0);
    return { month, rows, total: { target, won_amount: won, completion: target > 0 ? won / target : null, forecast: rows.reduce((s, r) => s + r.forecast, 0) }, canSetTargets: canSet };
  });
}

export const targetInput = z
  .object({
    profile_id: z.uuid(),
    period: monthInput,
    amount: z.coerce.number().min(0).max(1_000_000_000_000),
    deals: z.coerce.number().int().min(0).max(100_000).nullable().optional(),
  })
  .strict();

/** Admins set any target; managers the targets of people on their team. */
export async function setTarget(ctx: ServiceContext, input: z.output<typeof targetInput>): Promise<SalesTarget> {
  if (ctx.actor.role !== "admin" && !(ctx.actor.role === "manager" && input.profile_id !== ctx.actor.id && ownerInScope(ctx.actor, "update", "deal", input.profile_id))) {
    throw new DomainError("Only an admin, or the person's manager, can set this target.", "conflict");
  }
  return ctx.db.write(ctx.actor.organization_id, async (tx) => {
    if (!(await tx.get("profiles", input.profile_id))) throw new DomainError("User not found.", "not_found");
    const at = nowOf(ctx).toISOString();
    const current = (await tx.find("sales_targets", { profile_id: input.profile_id, period: input.period }))[0];
    if (current) {
      const updated = await tx.update("sales_targets", current.id, { amount: input.amount, deals: input.deals ?? null, set_by: ctx.actor.id, updated_at: at });
      await emit(tx, ctx, { type: "record.updated", payload: { entity: "sales_target", id: current.id, changes: { amount: { before: current.amount, after: input.amount } } } });
      return updated;
    }
    const target: SalesTarget = { id: newId(), organization_id: ctx.actor.organization_id, profile_id: input.profile_id, period: input.period, amount: input.amount, deals: input.deals ?? null, set_by: ctx.actor.id, created_at: at, updated_at: at };
    await tx.insert("sales_targets", target);
    await emit(tx, ctx, { type: "record.created", payload: { entity: "sales_target", id: target.id, after: target } });
    return target;
  });
}
