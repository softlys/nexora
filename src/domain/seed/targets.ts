import type { Deal, PipelineStage, Profile, SalesTarget } from "../entities";

/**
 * Demo sales plans for this month and the previous one: a quarter above what each person won (at
 * least 50 000), rounded, so the KPI page shows a mix of people ahead of and behind plan.
 */
export function seedTargets(organizationId: string, profiles: Profile[], deals: Deal[], stages: PipelineStage[], now: Date): SalesTarget[] {
  const won = new Set(stages.filter((s) => s.is_won).map((s) => s.id));
  const months = [0, -1].map((by) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + by, 1)).toISOString().slice(0, 7));
  const at = now.toISOString();
  const out: SalesTarget[] = [];
  profiles
    .filter((p) => (p.role === "sales_rep" || p.role === "manager") && p.is_active && !p.archived_at)
    .forEach((p, i) => {
      for (const [m, month] of months.entries()) {
        const closed = deals.filter((d) => d.owner_id === p.id && won.has(d.stage_id) && d.closed_at?.startsWith(month)).reduce((s, d) => s + d.amount, 0);
        // Alternate people a little above and below plan.
        const factor = (i + m) % 2 === 0 ? 0.8 : 1.25;
        out.push({
          id: `00000000-0000-4000-8000-0000000007${String(i * 2 + m).padStart(2, "0")}`,
          organization_id: organizationId,
          profile_id: p.id,
          period: month,
          amount: Math.max(50_000, Math.round((closed * factor) / 5_000) * 5_000),
          deals: null,
          set_by: null,
          created_at: at,
          updated_at: at,
        });
      }
    });
  return out;
}
