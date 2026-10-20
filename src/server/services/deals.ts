import type { z } from "zod";
import type { AuditLog, Deal, DealStageHistory, PipelineStage } from "@/domain/entities";
import { diffFields } from "@/domain/diff";
import type { dealInput, dealQuickEditInput, dealUpdateInput, moveStageInput } from "@/domain/inputs";
import { applyListQuery, type ListQuery } from "@/domain/list";
import { daysInStage, planStageMove, StageMoveError, stageDurations, summarizeStages } from "@/domain/rules/pipeline";
import { buildTimeline } from "@/domain/timeline";
import { DomainError } from "@/server/repositories/types";
import type { Tx } from "@/server/db/types";
import { emit, emitSecurity, findVisible, trackRead, newId, nowOf, requireCan, resolveOwner, type ServiceContext } from "./context";
import { assertLinksVisible, byId, getOwned } from "./records";
import { PermissionError } from "@/domain/permissions";

export async function sortedStages(tx: Tx): Promise<PipelineStage[]> {
  return (await tx.find("pipeline_stages")).sort((a, b) => a.position - b.position);
}

export function firstOpenStage(stages: PipelineStage[]): PipelineStage {
  const stage = stages.find((s) => !s.is_won && !s.is_lost);
  if (!stage) throw new DomainError("The pipeline has no open stage.", "conflict");
  return stage;
}

export type DealFilters = {
  stage?: string;
  owner?: string;
  from?: string;
  to?: string;
  min?: number;
  max?: number;
  status?: "open" | "won" | "lost" | "closed";
  company?: string;
  /** Drill-down from metrics: created or closed within a date range (inclusive, YYYY-MM-DD). */
  created_from?: string;
  created_to?: string;
  closed_from?: string;
  closed_to?: string;
};

/** Visible, non-archived deals enriched for lists and the board, with all filters applied. */
async function filteredDeals(tx: Tx, ctx: ServiceContext, filters: DealFilters, archived = false) {
  const [deals, stages, companies, profiles] = await Promise.all([
    findVisible(tx, ctx, "deals", "deal", (r) => r.owner_id),
    sortedStages(tx),
    tx.find("companies"),
    tx.find("profiles"),
  ]);
  const stageById = byId(stages);
  const companyById = byId(companies);
  const profileById = byId(profiles);
  const now = nowOf(ctx);
  const rows = deals
    .filter((d) => (archived ? d.archived_at !== null : d.archived_at === null))
    .filter((d) => {
      const stage = stageById.get(d.stage_id);
      const status = stage?.is_won ? "won" : stage?.is_lost ? "lost" : "open";
      return (
        (!filters.stage || d.stage_id === filters.stage) &&
        (!filters.owner || d.owner_id === filters.owner) &&
        (!filters.company || d.company_id === filters.company) &&
        (!filters.status || status === filters.status || (filters.status === "closed" && status !== "open")) &&
        (!filters.created_from || d.created_at.slice(0, 10) >= filters.created_from) &&
        (!filters.created_to || d.created_at.slice(0, 10) <= filters.created_to) &&
        (!filters.closed_from || (d.closed_at !== null && d.closed_at.slice(0, 10) >= filters.closed_from)) &&
        (!filters.closed_to || (d.closed_at !== null && d.closed_at.slice(0, 10) <= filters.closed_to)) &&
        (filters.min === undefined || d.amount >= filters.min) &&
        (filters.max === undefined || d.amount <= filters.max) &&
        (!filters.from || (d.expected_close_date ?? "") >= filters.from) &&
        (!filters.to || (d.expected_close_date ?? "9999") <= filters.to)
      );
    })
    .map((d) => ({
      ...d,
      stage_name: stageById.get(d.stage_id)?.name ?? "Unknown",
      is_won: stageById.get(d.stage_id)?.is_won ?? false,
      is_lost: stageById.get(d.stage_id)?.is_lost ?? false,
      company_name: companyById.get(d.company_id)?.name ?? "Unknown company",
      owner_name: profileById.get(d.owner_id)?.full_name ?? "Unknown",
      days_in_stage: daysInStage(d, now),
    }));
  return { rows, stages };
}

export type DealRow = Awaited<ReturnType<typeof filteredDeals>>["rows"][number];

export async function listDeals(ctx: ServiceContext, query: ListQuery, filters: DealFilters) {
  return ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const { rows, stages } = await filteredDeals(tx, ctx, filters, query.archived === "1");
    const page = applyListQuery(rows, query, {
      searchText: (d) => `${d.name} ${d.company_name} ${d.owner_name}`,
      sorters: {
        name: (d) => d.name.toLowerCase(),
        company: (d) => d.company_name.toLowerCase(),
        amount: (d) => d.amount,
        stage: (d) => stages.findIndex((s) => s.id === d.stage_id),
        close: (d) => d.expected_close_date,
        owner: (d) => d.owner_name,
      },
      defaultSort: { key: "close", dir: "asc" },
    });
    trackRead(ctx, "deal", page.rows.length);
    return { ...page, stages };
  });
}

/** Board data: stages with their deals, per-stage totals, weighted forecast and stage durations. */
export async function getPipelineBoard(ctx: ServiceContext, filters: DealFilters & { q?: string }) {
  return ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const { rows, stages } = await filteredDeals(tx, ctx, filters);
    const q = filters.q?.toLowerCase().trim();
    const deals = q ? rows.filter((d) => `${d.name} ${d.company_name} ${d.owner_name}`.toLowerCase().includes(q)) : rows;
    const history = await tx.find("deal_stage_history");
    const visibleDealIds = new Set((await findVisible(tx, ctx, "deals", "deal", (r) => r.owner_id)).map((d) => d.id));
    return {
      stages,
      deals,
      summary: summarizeStages(stages, deals),
      durations: stageDurations(
        history.filter((h) => visibleDealIds.has(h.deal_id)),
        nowOf(ctx),
      ),
    };
  });
}

export async function getDeal(ctx: ServiceContext, id: string) {
  return ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const deal = await getOwned(tx, ctx, "deals", id);
    const [stages, company, contact, history, activities, tasks, comments, audit, order, profiles] = await Promise.all([
      sortedStages(tx),
      tx.get("companies", deal.company_id),
      deal.primary_contact_id ? tx.get("contacts", deal.primary_contact_id) : Promise.resolve(null),
      tx.find("deal_stage_history", { deal_id: id }),
      tx.find("activities", { deal_id: id }),
      findVisible(tx, ctx, "tasks", "task", (r) => r.assignee_id, { deal_id: id }),
      tx.find("comments", { entity_type: "deal", entity_id: id }),
      tx.find("audit_logs", { target_type: "deal", target_id: id }),
      tx.find("orders", { source_deal_id: id }),
      tx.find("profiles"),
    ]);
    return {
      deal,
      stage: stages.find((s) => s.id === deal.stage_id) ?? null,
      stages,
      company,
      contact,
      order: order[0] ?? null,
      tasks: tasks.filter((t) => !t.archived_at),
      profiles: profiles.map((p) => ({ id: p.id, full_name: p.full_name })),
      timeline: buildTimeline({ activities, tasks: tasks.filter((t) => !t.archived_at), stageHistory: history, comments, stages }),
      changes: changeHistory(history, audit, stages),
    };
  });
}

export type ChangeEntry = { id: string; at: string; actor_id: string | null; kind: "stage" | "field" | "created" | "archived" | "restored" | "owner"; label: string; before?: unknown; after?: unknown };

/** Full change history for a deal: every stage move and every field change, newest first. */
export function changeHistory(history: DealStageHistory[], audit: AuditLog[], stages: PipelineStage[]): ChangeEntry[] {
  const name = new Map(stages.map((s) => [s.id, s.name]));
  const entries: ChangeEntry[] = history.map((h) => ({
    id: h.id,
    at: h.changed_at,
    actor_id: h.changed_by,
    kind: "stage",
    label: "Stage",
    before: h.from_stage_id ? (name.get(h.from_stage_id) ?? "Removed stage") : null,
    after: name.get(h.to_stage_id) ?? "Removed stage",
  }));
  for (const log of audit) {
    if (log.action === "record.updated") {
      const changes = (log.changes.changes ?? {}) as Record<string, { before: unknown; after: unknown }>;
      for (const [field, change] of Object.entries(changes)) {
        entries.push({ id: `${log.id}:${field}`, at: log.created_at, actor_id: log.actor_id, kind: "field", label: field, before: change.before, after: change.after });
      }
    } else if (log.action === "record.created") entries.push({ id: log.id, at: log.created_at, actor_id: log.actor_id, kind: "created", label: "Created" });
    else if (log.action === "record.archived") entries.push({ id: log.id, at: log.created_at, actor_id: log.actor_id, kind: "archived", label: "Archived" });
    else if (log.action === "record.restored") entries.push({ id: log.id, at: log.created_at, actor_id: log.actor_id, kind: "restored", label: "Restored" });
  }
  return entries.sort((a, b) => b.at.localeCompare(a.at));
}

async function recordStageEntry(tx: Tx, ctx: ServiceContext, dealId: string, from: string | null, to: string, at: string) {
  await tx.insert("deal_stage_history", {
    id: newId(),
    organization_id: ctx.actor.organization_id,
    deal_id: dealId,
    from_stage_id: from,
    to_stage_id: to,
    changed_by: ctx.actor.id,
    changed_at: at,
  });
}

export async function createDeal(ctx: ServiceContext, input: z.output<typeof dealInput>, tx?: Tx): Promise<Deal> {
  requireCan(ctx, "create", "deal");
  const run = async (t: Tx) => {
    await assertLinksVisible(t, ctx, { company_id: input.company_id, contact_id: input.primary_contact_id });
    const stages = await sortedStages(t);
    const stage = input.stage_id ? stages.find((s) => s.id === input.stage_id) : firstOpenStage(stages);
    if (!stage || stage.is_won || stage.is_lost) throw new DomainError("New deals start in an open stage.");
    const owner = (await resolveOwner(t, ctx, "deal", input.owner_id ?? ctx.actor.id, ctx.actor.id, null))!;
    const at = nowOf(ctx).toISOString();
    const deal: Deal = {
      id: newId(),
      organization_id: ctx.actor.organization_id,
      name: input.name,
      company_id: input.company_id,
      primary_contact_id: input.primary_contact_id,
      amount: input.amount,
      currency: input.currency,
      stage_id: stage.id,
      probability: input.probability ?? stage.probability,
      expected_close_date: input.expected_close_date,
      owner_id: owner,
      source: input.source,
      next_activity: input.next_activity,
      notes: input.notes,
      lost_reason: null,
      stage_entered_at: at,
      closed_at: null,
      lead_id: null,
      created_at: at,
      updated_at: at,
      archived_at: null,
    };
    await t.insert("deals", deal);
    await recordStageEntry(t, ctx, deal.id, null, stage.id, at);
    await emit(t, ctx, { type: "record.created", payload: { entity: "deal", id: deal.id, after: deal } });
    return deal;
  };
  return tx ? run(tx) : ctx.db.write(ctx.actor.organization_id, run);
}

/** A sales rep may not change the value of a won deal; managers and admins may. */
async function guardWonDealAmount(tx: Tx, ctx: ServiceContext, deal: Deal, nextAmount: number | undefined, nextCurrency?: string) {
  if (ctx.actor.role !== "sales_rep") return;
  const stage = await tx.get("pipeline_stages", deal.stage_id);
  const changesValue = (nextAmount !== undefined && nextAmount !== deal.amount) || (nextCurrency !== undefined && nextCurrency !== deal.currency);
  if (stage?.is_won && changesValue) {
    emitSecurity(ctx, { type: "authz.denied", payload: { action: "update", resource: "deal", target_id: deal.id, reason: "forbidden_field" } });
    throw new PermissionError("update", "deal");
  }
}

export async function updateDeal(ctx: ServiceContext, input: z.output<typeof dealUpdateInput>): Promise<Deal> {
  return ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const current = await getOwned(tx, ctx, "deals", input.id);
    requireCan(ctx, "update", "deal", current.owner_id, current.id);
    await guardWonDealAmount(tx, ctx, current, input.amount, input.currency);
    if (input.company_id !== current.company_id || input.primary_contact_id !== current.primary_contact_id) {
      await assertLinksVisible(tx, ctx, { company_id: input.company_id, contact_id: input.primary_contact_id });
    }
    const owner = (await resolveOwner(tx, ctx, "deal", input.owner_id, current.owner_id, current.id))!;
    const { id, owner_id: _o, probability, ...fields } = input;
    void _o;
    const patch = { ...fields, owner_id: owner, ...(probability !== undefined && { probability }) };
    const changes = diffFields(current as unknown as Record<string, unknown>, patch);
    if (Object.keys(changes).length === 0) return current;
    const updated = await tx.update("deals", id, { ...patch, updated_at: nowOf(ctx).toISOString() });
    await emit(tx, ctx, { type: "record.updated", payload: { entity: "deal", id, changes } });
    if (changes.owner_id) await emit(tx, ctx, { type: "record.owner_changed", payload: { entity: "deal", id, from: current.owner_id, to: owner } });
    return updated;
  });
}

export async function quickEditDeal(ctx: ServiceContext, input: z.output<typeof dealQuickEditInput>): Promise<Deal> {
  return ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const current = await getOwned(tx, ctx, "deals", input.id);
    requireCan(ctx, "update", "deal", current.owner_id, current.id);
    await guardWonDealAmount(tx, ctx, current, input.amount);
    const { id, ...patch } = input;
    const changes = diffFields(current as unknown as Record<string, unknown>, patch);
    if (Object.keys(changes).length === 0) return current;
    const updated = await tx.update("deals", id, { ...patch, updated_at: nowOf(ctx).toISOString() });
    await emit(tx, ctx, { type: "record.updated", payload: { entity: "deal", id, changes } });
    return updated;
  });
}

/** Moves a deal to another stage: validation, history, probability reset, close date and event. */
export async function moveDealStage(ctx: ServiceContext, input: z.output<typeof moveStageInput>): Promise<Deal> {
  return ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const deal = await getOwned(tx, ctx, "deals", input.deal_id);
    requireCan(ctx, "update", "deal", deal.owner_id, deal.id);
    if (deal.archived_at) throw new DomainError("Restore the deal before moving it.");
    const stages = await sortedStages(tx);
    const to = stages.find((s) => s.id === input.stage_id);
    let move;
    try {
      move = planStageMove(deal, to, input.lost_reason ?? null, nowOf(ctx));
    } catch (error) {
      if (error instanceof StageMoveError) throw new DomainError(error.message, error.code === "unknown_stage" ? "not_found" : "invalid");
      throw error;
    }
    const updated = await tx.update("deals", deal.id, { ...move, updated_at: move.stage_entered_at });
    await recordStageEntry(tx, ctx, deal.id, deal.stage_id, to!.id, move.stage_entered_at);
    await emit(tx, ctx, {
      type: "deal.stage_changed",
      payload: { deal_id: deal.id, from_stage_id: deal.stage_id, to_stage_id: to!.id, is_won: to!.is_won, is_lost: to!.is_lost, lost_reason: move.lost_reason },
    });
    return updated;
  });
}

export async function stageOptions(ctx: ServiceContext) {
  return ctx.db.read(ctx.actor.organization_id, (tx) => sortedStages(tx));
}
