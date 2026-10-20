/**
 * Date range presets for the dashboard and analytics, kept in the URL:
 *   ?range=this_month|last_30|last_90|this_quarter|this_year
 *   ?range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD
 */
import type { Period } from "./index";

export const RANGE_PRESETS = ["this_month", "last_30", "last_90", "this_quarter", "this_year", "custom"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export const RANGE_LABELS: Record<RangePreset, string> = {
  this_month: "This month",
  last_30: "Last 30 days",
  last_90: "Last 90 days",
  this_quarter: "This quarter",
  this_year: "This year",
  custom: "Custom range",
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const DAY = 86_400_000;

export function resolvePeriod(params: { range?: string; from?: string; to?: string }, now: Date = new Date()): { preset: RangePreset; period: Period } {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const preset = (RANGE_PRESETS as readonly string[]).includes(params.range ?? "") ? (params.range as RangePreset) : "last_90";
  switch (preset) {
    case "this_month":
      return { preset, period: { from: iso(new Date(Date.UTC(y, m, 1))), to: iso(today) } };
    case "last_30":
      return { preset, period: { from: iso(new Date(today.getTime() - 29 * DAY)), to: iso(today) } };
    case "this_quarter":
      return { preset, period: { from: iso(new Date(Date.UTC(y, Math.floor(m / 3) * 3, 1))), to: iso(today) } };
    case "this_year":
      return { preset, period: { from: iso(new Date(Date.UTC(y, 0, 1))), to: iso(today) } };
    case "custom": {
      const from = params.from && DATE.test(params.from) ? params.from : null;
      const to = params.to && DATE.test(params.to) ? params.to : null;
      if (from && to && from <= to && Date.parse(to) - Date.parse(from) <= 3 * 366 * DAY) return { preset, period: { from, to } };
      return { preset: "last_90", period: { from: iso(new Date(today.getTime() - 89 * DAY)), to: iso(today) } };
    }
    case "last_90":
    default:
      return { preset: "last_90", period: { from: iso(new Date(today.getTime() - 89 * DAY)), to: iso(today) } };
  }
}

/** Query string that reproduces a period in links (drill-down keeps the same range). */
export function periodQuery(preset: RangePreset, period: Period): string {
  return preset === "custom" ? `range=custom&from=${period.from}&to=${period.to}` : `range=${preset}`;
}
