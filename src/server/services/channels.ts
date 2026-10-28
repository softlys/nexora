import { z } from "zod";
import type { AdSpend, Deal, Lead } from "@/domain/entities";
import { inPeriod } from "@/domain/metrics";
import { DomainError } from "@/server/repositories/types";
import { emit, findVisible, newId, nowOf, requireCan, type ServiceContext } from "./context";
import { monthPeriod } from "./sales-plan";

/**
 * End-to-end analytics (сквозная аналитика): leads of a month grouped by advertising channel
 * (utm_source, utm_medium, utm_campaign or the lead source), followed to the deals they became and
 * the money won, with the month's ad spend for cost per lead and ROI.
 */

export const CHANNEL_GROUPS = ["source", "medium", "campaign", "lead_source"] as const;
export type ChannelGroup = (typeof CHANNEL_GROUPS)[number];
export const NO_CHANNEL = "(none)";

export type ChannelRow = {
  channel: string;
  leads: number;
  converted: number;
  won_deals: number;
  revenue: number;
  /** Leads that became won deals ÷ leads. */
  lead_to_won: number | null;
  average_deal: number | null;
  spend: number | null;
  cost_per_lead: number | null;
  /** (revenue − spend) ÷ spend. */
  roi: number | null;
};

const keyOf = (group: ChannelGroup, row: { utm?: Lead["utm"]; source?: string }) => (group === "lead_source" ? (row.source ?? NO_CHANNEL) : (row.utm?.[group] ?? NO_CHANNEL));

export async function channelReport(ctx: ServiceContext, month: string, group: ChannelGroup): Promise<{ rows: ChannelRow[]; total: ChannelRow; canRecordSpend: boolean }> {
  requireCan(ctx, "view", "analytics");
  const period = monthPeriod(month);
  return ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const [leads, deals, stages, spend] = await Promise.all([
      findVisible(tx, ctx, "leads", "lead", (r) => r.owner_id),
      findVisible(tx, ctx, "deals", "deal", (r) => r.owner_id),
      tx.find("pipeline_stages"),
      tx.find("ad_spend", { period: month }),
    ]);
    const won = new Set(stages.filter((s) => s.is_won).map((s) => s.id));
    const dealByLead = new Map(deals.filter((d) => d.lead_id && !d.archived_at).map((d) => [d.lead_id!, d]));
    const monthLeads = leads.filter((l) => !l.archived_at && inPeriod(l.created_at, period));
    // Deals created this month with UTM tags but without a lead (e.g. made by hand from a call).
    const directDeals = deals.filter((d) => !d.archived_at && !d.lead_id && d.utm && inPeriod(d.created_at, period));
    const buckets = new Map<string, { leads: Lead[]; deals: Deal[] }>();
    const bucket = (k: string) => buckets.get(k) ?? buckets.set(k, { leads: [], deals: [] }).get(k)!;
    for (const l of monthLeads) {
      const b = bucket(keyOf(group, l));
      b.leads.push(l);
      const d = dealByLead.get(l.id);
      if (d) b.deals.push(d);
    }
    for (const d of directDeals) bucket(keyOf(group, d)).deals.push(d);
    const spendBy = new Map(spend.map((s) => [s.channel, Number(s.amount)]));
    const row = (channel: string, ls: Lead[], ds: Deal[], money: number | null): ChannelRow => {
      const wonDeals = ds.filter((d) => won.has(d.stage_id));
      const revenue = Math.round(wonDeals.reduce((s, d) => s + d.amount, 0) * 100) / 100;
      const wonFromLeads = wonDeals.filter((d) => d.lead_id).length;
      return {
        channel,
        leads: ls.length,
        converted: ls.filter((l) => l.converted_deal_id).length,
        won_deals: wonDeals.length,
        revenue,
        lead_to_won: ls.length ? wonFromLeads / ls.length : null,
        average_deal: wonDeals.length ? revenue / wonDeals.length : null,
        spend: money,
        cost_per_lead: money !== null && ls.length ? money / ls.length : null,
        roi: money ? (revenue - money) / money : null,
      };
    };
    const rows = [...buckets.entries()].map(([k, b]) => row(k, b.leads, b.deals, group === "source" ? (spendBy.get(k) ?? null) : null));
    // Spend recorded for a channel with no leads still shows (money spent without result).
    if (group === "source") for (const [channel, amount] of spendBy) if (!buckets.has(channel)) rows.push(row(channel, [], [], amount));
    rows.sort((a, b) => b.revenue - a.revenue || b.leads - a.leads || a.channel.localeCompare(b.channel));
    const allSpend = group === "source" ? [...spendBy.values()].reduce((s, v) => s + v, 0) : null;
    const total = row("", monthLeads, [...dealByLead.values()].filter((d) => monthLeads.some((l) => l.id === d.lead_id)).concat(directDeals), allSpend || null);
    return { rows, total, canRecordSpend: ctx.actor.role === "admin" || ctx.actor.role === "manager" };
  });
}

export const spendInput = z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), channel: z.string().trim().min(1).max(200), amount: z.coerce.number().min(0).max(1_000_000_000) }).strict();

/** Admins and managers record what a channel cost in a month (0 removes nothing; it records zero spend). */
export async function setAdSpend(ctx: ServiceContext, input: z.output<typeof spendInput>): Promise<AdSpend> {
  if (ctx.actor.role !== "admin" && ctx.actor.role !== "manager") throw new DomainError("Only admins and managers record ad spend.", "conflict");
  return ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const at = nowOf(ctx).toISOString();
    const current = (await tx.find("ad_spend", { period: input.period, channel: input.channel }))[0];
    if (current) {
      const updated = await tx.update("ad_spend", current.id, { amount: input.amount, updated_at: at });
      await emit(tx, ctx, { type: "record.updated", payload: { entity: "ad_spend", id: current.id, changes: { amount: { before: current.amount, after: input.amount } } } });
      return updated;
    }
    const row: AdSpend = { id: newId(), organization_id: ctx.actor.organization_id, period: input.period, channel: input.channel, amount: input.amount, created_at: at, updated_at: at };
    await tx.insert("ad_spend", row);
    await emit(tx, ctx, { type: "record.created", payload: { entity: "ad_spend", id: row.id, after: row } });
    return row;
  });
}
