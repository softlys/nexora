import { beforeEach, describe, expect, it } from "vitest";
import type { Dataset } from "@/domain/entities";
import type { EmailMessage } from "@/server/automation/engine";
import type { Db } from "@/server/db/types";
import { smsNumber } from "@/server/integrations/sms";
import { campaignInput, previewSegment, saveCampaign, sendCampaign, unsubscribe, unsubscribeToken, UNSUBSCRIBED_TAG } from "@/server/services/campaigns";
import { createTestDb, ctxFor, DEMO_USER_IDS } from "./helpers/services";

const SECRET = "test-secret";

describe("mailings", () => {
  let db: Db;
  let data: () => Dataset;
  beforeEach(() => {
    ({ db, data } = createTestDb());
  });
  const admin = () => ctxFor(db, data(), DEMO_USER_IDS.admin);
  const segment = { tags: [], lifecycle: ["customer"], countries: [], owner_ids: [] };
  const deps = (sent: EmailMessage[], configured = true) => ({
    email: { configured, send: async (m: EmailMessage) => (sent.push(m), { id: "m" }) },
    sms: { configured: false, send: async () => ({ id: "s" }) },
    simulate: false,
    baseUrl: "https://crm.example",
    secret: SECRET,
  });

  it("normalizes SMS numbers", () => {
    expect(smsNumber("8 (999) 123-45-67")).toBe("79991234567");
    expect(smsNumber("+7 999 123 45 67")).toBe("79991234567");
    expect(smsNumber("123")).toBeNull();
  });

  it("sends a personalised e-mail with an unsubscribe link to the segment, once", async () => {
    const preview = await previewSegment(admin(), segment, "email");
    expect(preview.reachable).toBeGreaterThan(0);
    const c = await saveCampaign(admin(), campaignInput.parse({ name: "Прайс", channel: "email", subject: "Новый прайс для {{company.name}}", body: "Здравствуйте, {{contact.first_name}}!", segment }));
    const sent: EmailMessage[] = [];
    const done = await sendCampaign(admin(), c.id, deps(sent));
    expect(done).toMatchObject({ status: "sent", sent: preview.reachable, failed: 0, simulated: false });
    const first = sent[0]!;
    const contact = data().contacts.find((x) => x.email === first.to)!;
    expect(first.text).toContain(`Здравствуйте, ${contact.first_name}!`);
    expect(first.text).toContain(`https://crm.example/api/unsubscribe?c=${contact.id}&t=${unsubscribeToken(contact.id, SECRET)}`);
    expect(first.subject).toMatch(/^Новый прайс для /);
    expect(data().activities.filter((a) => a.subject === "Mailing: Прайс")).toHaveLength(preview.reachable);
    await expect(sendCampaign(admin(), c.id, deps([]))).rejects.toThrow(/already sent/);
  });

  it("skips unsubscribed contacts and simulates in demo mode without a provider", async () => {
    const before = await previewSegment(admin(), segment, "email");
    const c = await saveCampaign(admin(), campaignInput.parse({ name: "Демо", channel: "email", subject: "Тема", body: "Текст", segment }));
    const sent: EmailMessage[] = [];
    const first = data().contacts.find((x) => x.email && !x.archived_at && x.tags.length < 10 && data().companies.find((co) => co.id === x.company_id)?.lifecycle_stage === "customer")!;
    expect(await unsubscribe(admin(), first.id, "bad-token", SECRET)).toBe(false);
    expect(await unsubscribe(admin(), first.id, unsubscribeToken(first.id, SECRET), SECRET)).toBe(true);
    expect(data().contacts.find((x) => x.id === first.id)?.tags).toContain(UNSUBSCRIBED_TAG);
    await expect(sendCampaign(admin(), c.id, deps(sent, false))).rejects.toThrow(/not set up/);
    const done = await sendCampaign(admin(), c.id, { ...deps(sent, false), simulate: true });
    expect(done).toMatchObject({ simulated: true, sent: before.reachable - 1 });
    expect(sent).toEqual([]);
  });

  it("is for admins and managers", async () => {
    await expect(saveCampaign(ctxFor(db, data(), DEMO_USER_IDS.repDaniel), campaignInput.parse({ name: "x", channel: "sms", body: "x", segment }))).rejects.toThrow();
    expect(campaignInput.safeParse({ name: "x", channel: "email", subject: "", body: "x", segment }).success).toBe(false);
  });
});
