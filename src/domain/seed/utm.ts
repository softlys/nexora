import type { AdSpend, Deal, Lead } from "../entities";

const CHANNELS: Array<Lead["utm"]> = [
  { source: "yandex", medium: "cpc", campaign: "pumps-search" },
  { source: "google", medium: "cpc", campaign: "brand" },
  { source: "vk", medium: "social", campaign: "autumn-promo" },
  { source: "yandex", medium: "cpc", campaign: "spare-parts" },
  { source: "telegram", medium: "messenger", campaign: "channel-posts" },
  null,
];

/** Demo UTM tags on leads (and the deals they became), so end-to-end analytics has data. */
export function seedUtm(leads: Lead[], deals: Deal[]): void {
  leads.forEach((l, i) => {
    if (l.utm !== undefined) return;
    // Leads that became deals always carry a channel, so revenue and ROI show up per channel.
    l.utm = l.converted_deal_id ? CHANNELS[i % (CHANNELS.length - 1)]! : l.source === "website" || l.source === "api" || i % 3 === 0 ? (CHANNELS[i % CHANNELS.length] ?? null) : null;
  });
  const byLead = new Map(leads.map((l) => [l.id, l]));
  for (const d of deals) {
    const lead = d.lead_id ? byLead.get(d.lead_id) : undefined;
    if (lead?.utm && d.utm === undefined) d.utm = lead.utm;
  }
}

/** Demo ad spend for this month and the previous one. */
export function seedSpend(organizationId: string, now: Date): AdSpend[] {
  const at = now.toISOString();
  const months = [0, -1].map((by) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + by, 1)).toISOString().slice(0, 7));
  const amounts: Record<string, number> = { yandex: 42_000, google: 18_000, vk: 12_000, telegram: 6_000 };
  return months.flatMap((period, m) =>
    Object.entries(amounts).map(([channel, amount], i) => ({ id: `00000000-0000-4000-8000-0000000008${String(m * 10 + i).padStart(2, "0")}`, organization_id: organizationId, period, channel, amount: m === 0 ? amount : Math.round(amount * 0.9), created_at: at, updated_at: at })),
  );
}
