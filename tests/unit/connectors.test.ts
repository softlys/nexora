import { createHash, createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Dataset } from "@/domain/entities";
import { crc32, createZip } from "@/lib/zip";
import type { Db } from "@/server/db/types";
import { briefText, dealAssist, type DealBrief } from "@/server/integrations/ai";
import { buildCalendar, foldLine, icsText } from "@/server/integrations/calendar";
import { flatFields } from "@/server/integrations/hooks/common";
import { parseSubmission } from "@/server/integrations/hooks/forms";
import { phoneKey } from "@/server/integrations/inbound";
import { recordMessages } from "@/server/integrations/mail";
import { metaSignatureValid, waNumber } from "@/server/integrations/messaging";
import { skuFor, syncProducts } from "@/server/integrations/moysklad";
import { buildVault, noteName } from "@/server/integrations/obsidian";
import { minorUnits, recordOnlinePayment, stripeSignatureValid } from "@/server/integrations/payments";
import { mangoSignatureValid, processCall, twilioSignature, zadarmaSignature, zadarmaSignatureValid } from "@/server/integrations/telephony";
import { createTestDb, ctxFor, DEMO_USER_IDS, NOW } from "./helpers/services";

describe("ZIP writer", () => {
  it("writes a valid archive with UTF-8 names", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    const zip = createZip([{ path: "NEXORA/Компании/Север.md", content: "# Север" }], NOW);
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(6, true) & 0x0800).toBe(0x0800); // UTF-8 names flag
    expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(zip.length - 22 + 10, true)).toBe(1);
  });
});

describe("inbound helpers", () => {
  it("parses Tilda form posts and Yandex Forms JSON with Russian field names", () => {
    const tilda = parseSubmission(flatFields("Name=%D0%98%D0%B2%D0%B0%D0%BD&Phone=%2B7+(999)+123-45-67&Email=ivan%40example.ru&utm_source=yandex&tranid=1:2&formname=Заявка", "application/x-www-form-urlencoded"));
    expect(tilda).toMatchObject({ name: "Иван", phone: "+7 (999) 123-45-67", email: "ivan@example.ru", form: "Заявка", utm: { utm_source: "yandex" } });
    const yandex = parseSubmission(flatFields(JSON.stringify({ answer: { data: { "имя": "Ольга", "телефон": "89991234567", "компания": "ООО Север", "комментарий": "Нужен расчёт", "бюджет": "150 000 ₽" } } }), "application/json"));
    expect(yandex).toMatchObject({ name: "Ольга", phone: "89991234567", company: "ООО Север", message: "Нужен расчёт", value: 150000 });
  });

  it("matches phone numbers across formats", () => {
    expect(phoneKey("+7 (999) 123-45-67")).toBe(phoneKey("89991234567"));
    expect(phoneKey("123")).toBeNull();
    expect(waNumber("8 (999) 123-45-67")).toBe("79991234567");
    expect(waNumber("+44 20 7946 0958")).toBe("442079460958");
  });

  it("checks provider signatures", () => {
    const json = '{"entry_id":"abc"}';
    expect(mangoSignatureValid("key", "salt", json, createHash("sha256").update(`key${json}salt`).digest("hex"))).toBe(true);
    expect(mangoSignatureValid("key", "salt", json, "0".repeat(64))).toBe(false);

    const fields = { event: "NOTIFY_END", caller_id: "+79991234567", called_did: "74951234567", call_start: "2026-10-24 10:00:00" };
    expect(zadarmaSignatureValid("secret", fields, zadarmaSignature("secret", "+79991234567749512345672026-10-24 10:00:00"))).toBe(true);
    expect(zadarmaSignatureValid("secret", { ...fields, caller_id: "+70000000000" }, zadarmaSignature("secret", "+79991234567749512345672026-10-24 10:00:00"))).toBe(false);

    // Twilio's documented example.
    expect(twilioSignature("12345", "https://mycompany.com/myapp.php?foo=1&bar=2", { CallSid: "CA1234567890ABCDE", Caller: "+12349013030", Digits: "1234", From: "+12349013030", To: "+18005551212" })).toBe("0/KCTR6DLpKmkAf8muzZqo1nDgQ=");

    const body = '{"object":"whatsapp_business_account"}';
    expect(metaSignatureValid("app-secret", body, `sha256=${createHmac("sha256", "app-secret").update(body).digest("hex")}`)).toBe(true);
    expect(metaSignatureValid("app-secret", body, "sha256=bad")).toBe(false);

    const t = Math.floor(NOW.getTime() / 1000);
    const header = `t=${t},v1=${createHmac("sha256", "whsec_x").update(`${t}.${body}`).digest("hex")}`;
    expect(stripeSignatureValid("whsec_x", body, header, NOW.getTime())).toBe(true);
    expect(stripeSignatureValid("whsec_x", body, header, NOW.getTime() + 10 * 60_000)).toBe(false); // replay after 10 minutes
    expect(minorUnits(1234.5, "RUB")).toBe(123450);
    expect(minorUnits(1000, "JPY")).toBe(1000);
  });
});

describe("integrations writing to the CRM", () => {
  let db: Db;
  let data: () => Dataset;
  beforeEach(() => {
    ({ db, data } = createTestDb());
  });
  const admin = () => ({ ...ctxFor(db, data(), DEMO_USER_IDS.admin), principal: "service" as const, pendingEvents: [] });

  it("logs a call on the contact once, and turns a missed call into a call-back task for the owner", async () => {
    const contact = data().contacts.find((c) => c.phone && !c.archived_at)!;
    const call = { provider: "mango" as const, id: "entry-1", direction: "inbound" as const, customer: contact.phone!, ours: "101", startedAt: NOW.toISOString(), durationSec: 0, answered: false };
    expect(await processCall(admin(), call)).toBe("created");
    expect(await processCall(admin(), call)).toBe("duplicate");
    const activities = data().activities.filter((a) => a.contact_id === contact.id && a.type === "call" && a.subject.startsWith("Missed call"));
    expect(activities).toHaveLength(1);
    expect(activities[0]!.actor_id).toBeNull();
    const task = data().tasks.find((t) => t.contact_id === contact.id && t.title.startsWith("Call back"))!;
    expect(task).toMatchObject({ assignee_id: contact.owner_id, priority: "high", type: "call" });
  });

  it("creates a lead for a call from an unknown number", async () => {
    const before = data().leads.length;
    await processCall(admin(), { provider: "zadarma", id: "z-1", direction: "inbound", customer: "+7 912 000-11-22", ours: "", startedAt: NOW.toISOString(), durationSec: 95, answered: true });
    const lead = data().leads.at(-1)!;
    expect(data().leads).toHaveLength(before + 1);
    expect(lead).toMatchObject({ source: "inbound_call", phone: "+7 912 000-11-22" });
    expect(data().activities.some((a) => a.lead_id === lead.id && a.subject.includes("(1:35)"))).toBe(true);
  });

  it("records only mail with known contacts, once per Message-ID", async () => {
    const contact = data().contacts.find((c) => c.email && !c.archived_at)!;
    const message = { messageId: "<m1@example.ru>", folder: "INBOX", uid: 5, date: NOW.toISOString(), subject: "Счёт", from: contact.email, to: ["sales@nexora.test"], text: "Добрый день!" };
    const stranger = { ...message, messageId: "<m2@example.ru>", from: "someone@unknown.example" };
    expect(await recordMessages(admin(), "sales@nexora.test", [message, stranger, message])).toBe(1);
    const recorded = data().activities.filter((a) => a.type === "email" && a.contact_id === contact.id && a.subject.includes("Счёт"));
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.subject).toBe(`Email from ${contact.email}: Счёт`);
  });

  it("records an online payment once and updates the order's payment status", async () => {
    const order = data().orders.find((o) => o.status === "confirmed" && o.payment_status !== "paid" && !data().payments.some((p) => p.order_id === o.id))!;
    const input = { provider: "yookassa" as const, externalId: "2f1a-test-payment", orderId: order.id, amount: order.total, currency: order.currency };
    expect(await recordOnlinePayment(admin(), input)).toBe(true);
    expect(await recordOnlinePayment(admin(), input)).toBe(false);
    const payments = data().payments.filter((p) => p.order_id === order.id);
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ is_simulated: false, method: "card", recorded_by: null });
    expect(data().orders.find((o) => o.id === order.id)!.payment_status).toBe("paid");
  });

  it("imports MoySklad products by SKU and updates them on the next sync", async () => {
    const rows = [{ id: "0d7a-11ee", name: "Труба 57х3,5", article: "tr 57/3.5", salePrices: [{ value: 125050 }], vatEnabled: true, vat: 20, pathName: "Металл/Трубы" }];
    expect(skuFor(rows[0]!)).toBe("TR-57-3-5");
    expect(skuFor({ id: "abcd-ef01-2345", article: "", code: "" })).toBe("MS-ABCDEF012345");
    expect(await syncProducts(admin(), rows, "RUB")).toEqual({ created: 1, updated: 0 });
    expect(data().products.find((p) => p.sku === "TR-57-3-5")).toMatchObject({ name: "Труба 57х3,5", unit_price: 1250.5, tax_rate: 20, category: "Трубы", currency: "RUB" });
    expect(await syncProducts(admin(), [{ ...rows[0]!, salePrices: [{ value: 130000 }] }], "RUB")).toEqual({ created: 0, updated: 1 });
  });
});

describe("exports and feeds", () => {
  it("builds an Obsidian vault with unique note names and wikilinks", () => {
    const { data } = createTestDb();
    const d = data();
    const company = d.companies[0]!;
    const twin = { ...d.companies[1]!, name: company.name };
    const contact = { ...d.contacts.find((c) => c.company_id === company.id)!, first_name: "Анна", last_name: "Иванова" };
    const deal = d.deals.find((x) => x.company_id === company.id)!;
    const files = buildVault({ companies: [company, twin], contacts: [contact], deals: [deal], stages: d.pipeline_stages, activities: [], tasks: [], profiles: d.profiles, baseUrl: "https://crm.example.ru", generatedAt: NOW });
    const paths = files.map((f) => f.path);
    expect(paths).toContain(`NEXORA/Companies/${noteName(company.name)}.md`);
    expect(paths).toContain(`NEXORA/Companies/${noteName(company.name)} (2).md`);
    const companyNote = files.find((f) => f.path === `NEXORA/Companies/${noteName(company.name)}.md`)!.content as string;
    expect(companyNote).toContain("[[Анна Иванова]]");
    expect(companyNote).toContain(`nexora: "https://crm.example.ru/companies/${company.id}"`);
    expect(noteName('A/B: "C"? [x]#')).toBe("A B C x");
  });

  it("writes an RFC 5545 calendar with escaped, folded lines", () => {
    expect(icsText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
    const long = `SUMMARY:${"Ж".repeat(60)}`;
    const folded = foldLine(long).split("\r\n");
    expect(folded.every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
    expect(folded.slice(1).every((l) => l.startsWith(" "))).toBe(true);
    const { data } = createTestDb();
    const d = data();
    const task = { ...d.tasks[0]!, due_at: "2026-10-25T09:00:00.000Z", status: "todo" as const, title: "Позвонить, уточнить объём" };
    const ics = buildCalendar({ name: "NEXORA", baseUrl: "https://crm.example.ru", tasks: [task], deals: [], stages: d.pipeline_stages, companyName: () => "", now: NOW });
    expect(ics).toContain("BEGIN:VCALENDAR\r\n");
    expect(ics).toContain("DTSTART:20261025T090000Z");
    expect(ics).toContain("Позвонить\\, уточнить объём");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("asks the AI with the deal's data only and returns its answer", async () => {
    const brief: DealBrief = {
      deal: { name: "Поставка труб", stage: "Proposal", amount: 1_200_000, currency: "RUB", probability: 50, expected_close: "2026-11-15", next_activity: "Созвон", notes: "", days_in_stage: 12 },
      company: { name: "ООО Север", industry: "Metal", country: "Russia", city: "Екатеринбург" },
      contact: { name: "Анна Иванова", job_title: "Закупки", email: "anna@sever.ru" },
      owner: "Olivia Hart",
      activities: [{ when: "2026-10-20", type: "call", subject: "Обсудили сроки", body: "" }],
      tasks: [],
      comments: [],
    };
    expect(briefText(brief)).toContain("Company: ООО Север, Metal, Екатеринбург, Russia");
    const seen: string[] = [];
    const text = await dealAssist(async (system, prompt) => (seen.push(system, prompt), "Сводка"), brief, "summary", "ru");
    expect(text).toBe("Сводка");
    expect(seen[0]).toContain("по-русски");
    expect(seen[1]).toContain("Поставка труб");
  });
});
