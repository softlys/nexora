import { beforeEach, describe, expect, it } from "vitest";
import type { Dataset } from "@/domain/entities";
import { leadInput } from "@/domain/inputs";
import type { Db } from "@/server/db/types";
import { channelReport, NO_CHANNEL, setAdSpend, spendInput } from "@/server/services/channels";
import { cleanUtm, createLead } from "@/server/services/leads";
import { createTestDb, ctxFor, DEMO_USER_IDS, NOW } from "./helpers/services";

describe("end-to-end analytics", () => {
  let db: Db;
  let data: () => Dataset;
  beforeEach(() => {
    ({ db, data } = createTestDb());
  });
  const admin = () => ctxFor(db, data(), DEMO_USER_IDS.admin);
  const month = NOW.toISOString().slice(0, 7);
  const lead = (title: string, utm: Record<string, string> | null) =>
    createLead(admin(), leadInput.parse({ title, company_name: title, contact_name: "Иван", email: "", phone: "", country: "", source: "website", status: "new", qualification: "warm", next_action: "", next_action_at: "", estimated_value: 0, utm }));

  it("cleans tags and keeps them on leads", async () => {
    expect(cleanUtm({ source: " yandex ", medium: "" })).toEqual({ source: "yandex" });
    expect(cleanUtm({ medium: "" })).toBeNull();
    const l = await lead("Насосы", { source: "yandex", medium: "cpc", campaign: "pumps" });
    expect(data().leads.find((x) => x.id === l.id)?.utm).toEqual({ source: "yandex", medium: "cpc", campaign: "pumps" });
  });

  it("groups the month's leads by channel and follows them to won deals, spend and ROI", async () => {
    const before = await channelReport(admin(), month, "source");
    const yandexBefore = before.rows.find((r) => r.channel === "yandex");
    await lead("Новый лид 1", { source: "yandex" });
    await lead("Новый лид 2", { source: "yandex" });
    await lead("Без меток", null);
    await setAdSpend(admin(), spendInput.parse({ period: month, channel: "yandex", amount: 100000 }));
    const report = await channelReport(admin(), month, "source");
    const yandex = report.rows.find((r) => r.channel === "yandex")!;
    expect(yandex.leads).toBe((yandexBefore?.leads ?? 0) + 2);
    expect(yandex.spend).toBe(100000);
    expect(yandex.cost_per_lead).toBeCloseTo(100000 / yandex.leads, 5);
    expect(yandex.roi).toBeCloseTo((yandex.revenue - 100000) / 100000, 5);
    expect(report.rows.some((r) => r.channel === NO_CHANNEL)).toBe(true);
    expect(report.total.leads).toBe(report.rows.reduce((s, r) => s + r.leads, 0));
  });

  it("counts revenue of won deals that came from tagged leads", async () => {
    const won = new Set(data().pipeline_stages.filter((s) => s.is_won).map((s) => s.id));
    const tagged = data().deals.filter((d) => d.lead_id && d.utm?.source && won.has(d.stage_id));
    const sample = tagged.find((d) => data().leads.find((l) => l.id === d.lead_id)?.created_at.startsWith(month));
    if (!sample) return; // the seed may have no lead of this month that was won
    const report = await channelReport(admin(), month, "source");
    expect(report.rows.find((r) => r.channel === sample.utm!.source)!.revenue).toBeGreaterThanOrEqual(sample.amount);
  });

  it("lets only admins and managers record spend", async () => {
    await expect(setAdSpend(ctxFor(db, data(), DEMO_USER_IDS.repDaniel), spendInput.parse({ period: month, channel: "vk", amount: 1 }))).rejects.toThrow();
  });
});
