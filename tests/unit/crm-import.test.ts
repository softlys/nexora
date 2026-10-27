import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Dataset } from "@/domain/entities";
import type { Db } from "@/server/db/types";
import { amoBase, bitrixBase, readAmo, readBitrix, type SourceData } from "@/server/integrations/crm-sources";
import type { Transport, TransportRequest } from "@/server/integrations/transport";
import { importCrm, stagesFor, type CreatePipeline } from "@/server/services/crm-import";
import { createTestDb, ctxFor, DEMO_USER_IDS } from "./helpers/services";

function fakeTransport(answer: (req: TransportRequest) => unknown): { transport: Transport; calls: TransportRequest[] } {
  const calls: TransportRequest[] = [];
  return {
    calls,
    transport: async (req) => {
      calls.push(req);
      const body = answer(req);
      return body === null ? { status: 204, body: "", durationMs: 1 } : { status: 200, body: JSON.stringify(body), durationMs: 1 };
    },
  };
}

describe("reading Bitrix24 and amoCRM", () => {
  it("checks the addresses", () => {
    expect(bitrixBase("https://acme.bitrix24.ru/rest/1/abc123/profile")).toBe("https://acme.bitrix24.ru/rest/1/abc123/");
    expect(() => bitrixBase("https://acme.bitrix24.ru/crm/")).toThrow(/incoming webhook/);
    expect(() => bitrixBase("http://acme.bitrix24.ru/rest/1/abc/")).toThrow();
    expect(amoBase("https://mycompany.amocrm.ru/leads")).toBe("https://mycompany.amocrm.ru/api/v4/");
    expect(() => amoBase("my company")).toThrow();
  });

  it("reads Bitrix24 pipelines, stages, companies, contacts and deals with paging", async () => {
    const { transport, calls } = fakeTransport((req) => {
      const method = req.url.split("/").pop()!.replace(".json", "");
      const start = (JSON.parse(req.body) as { start: number }).start;
      switch (method) {
        case "crm.category.list":
          return { result: { categories: [{ id: 0, name: "Продажи" }] } };
        case "crm.status.list":
          return { result: [{ STATUS_ID: "NEW", NAME: "Новая", SORT: "10" }, { STATUS_ID: "WON", NAME: "Сделка успешна", SORT: "60", EXTRA: { SEMANTICS: "S" } }, { STATUS_ID: "LOSE", NAME: "Провал", SORT: "70", EXTRA: { SEMANTICS: "F" } }] };
        case "crm.company.list":
          return start === 0 ? { result: [{ ID: "1", TITLE: "ООО Альфа", PHONE: [{ VALUE: "+7 999 111-22-33" }], WEB: [{ VALUE: "alfa.ru" }] }], next: 50 } : { result: [{ ID: "2", TITLE: "ООО Бета" }] };
        case "crm.contact.list":
          return { result: [{ ID: "10", NAME: "Иван", LAST_NAME: "Петров", COMPANY_ID: "1", EMAIL: [{ VALUE: "ivan@alfa.ru" }] }] };
        case "crm.deal.list":
          return { result: [{ ID: "100", TITLE: "Поставка", OPPORTUNITY: "150000.00", CURRENCY_ID: "RUB", CATEGORY_ID: "0", STAGE_ID: "WON", COMPANY_ID: "1", CONTACT_ID: "10" }] };
      }
      return { result: [] };
    });
    const data = await readBitrix(transport, "https://acme.bitrix24.ru/rest/1/abc123/");
    expect(data.pipelines[0]!.stages.map((s) => s.kind)).toEqual(["open", "won", "lost"]);
    expect(data.companies.map((c) => c.name)).toEqual(["ООО Альфа", "ООО Бета"]);
    expect(data.companies[0]).toMatchObject({ phone: "+7 999 111-22-33", website: "alfa.ru" });
    expect(data.contacts[0]).toMatchObject({ first_name: "Иван", company_key: "1", email: "ivan@alfa.ru" });
    expect(data.deals[0]).toMatchObject({ amount: 150000, stage_key: "WON", contact_key: "10" });
    expect(calls.every((c) => c.url.startsWith("https://acme.bitrix24.ru/rest/1/abc123/"))).toBe(true);
  });

  it("reads amoCRM with the token and marks won and lost statuses", async () => {
    const { transport, calls } = fakeTransport((req) => {
      const path = new URL(req.url).pathname.replace("/api/v4/", "");
      if (path === "leads/pipelines") return { _embedded: { pipelines: [{ id: 5, name: "Воронка", _embedded: { statuses: [{ id: 1, name: "Неразобранное", sort: 10, type: 1 }, { id: 20, name: "Первичный контакт", sort: 20, type: 0 }, { id: 142, name: "Успешно", sort: 10000 }, { id: 143, name: "Закрыто", sort: 11000 }] } }] } };
      if (path === "companies") return { _embedded: { companies: [{ id: 7, name: "ИП Сидоров", custom_fields_values: [{ field_code: "PHONE", values: [{ value: "+79990001122" }] }] }] } };
      if (path === "contacts") return { _embedded: { contacts: [{ id: 8, name: "Пётр Сидоров", custom_fields_values: [{ field_code: "EMAIL", values: [{ value: "p@s.ru" }] }], _embedded: { companies: [{ id: 7 }] } }] } };
      if (path === "leads") return { _embedded: { leads: [{ id: 9, name: "Заказ", price: 5000, pipeline_id: 5, status_id: 20, _embedded: { contacts: [{ id: 8, is_main: true }], companies: [{ id: 7 }] } }] } };
      return null;
    });
    const data = await readAmo(transport, "mycompany", "secret-token-123");
    expect(data.pipelines[0]!.stages.map((s) => [s.name, s.kind])).toEqual([
      ["Первичный контакт", "open"],
      ["Успешно", "won"],
      ["Закрыто", "lost"],
    ]);
    expect(data.contacts[0]).toMatchObject({ first_name: "Пётр", last_name: "Сидоров", email: "p@s.ru", company_key: "7" });
    expect(data.deals[0]).toMatchObject({ amount: 5000, contact_key: "8", company_key: "7" });
    expect(calls.every((c) => c.method === "GET" && c.headers.Authorization === "Bearer secret-token-123")).toBe(true);
  });
});

describe("moving into NEXORA", () => {
  let db: Db;
  let data: () => Dataset;
  beforeEach(() => {
    ({ db, data } = createTestDb());
  });
  const admin = () => ctxFor(db, data(), DEMO_USER_IDS.admin);
  const org = () => data().organizations[0]!.id;
  const createPipeline: CreatePipeline = async (name, stages) => {
    const id = randomUUID();
    const at = new Date().toISOString();
    await db.write(org(), async (tx) => {
      await tx.insert("pipelines", { id, organization_id: org(), name, position: 9, created_at: at, updated_at: at, archived_at: null });
      for (const [position, s] of stages.entries()) await tx.insert("pipeline_stages", { id: randomUUID(), organization_id: org(), pipeline_id: id, name: s.name, probability: s.probability, is_won: s.is_won, is_lost: s.is_lost, position, created_at: at, updated_at: at });
    });
    return id;
  };
  const source: SourceData = {
    pipelines: [{ key: "0", name: "Опт", stages: [{ key: "NEW", name: "Новая", kind: "open", sort: 10 }, { key: "OFFER", name: "КП", kind: "open", sort: 20 }, { key: "WON", name: "Успех", kind: "won", sort: 90 }, { key: "LOSE", name: "Провал", kind: "lost", sort: 95 }, { key: "APOLOGY", name: "Анализ причины", kind: "lost", sort: 96 }] }],
    companies: [{ key: "1", name: "ООО Альфа", phone: "+7 999 111-22-33", email: "", website: "alfa.ru", address: "Москва", industry: "" }],
    contacts: [{ key: "10", first_name: "Иван", last_name: "Петров", phone: "", email: "not-an-email", job_title: "Директор", company_key: "1" }],
    deals: [
      { key: "100", name: "Поставка", amount: 150000, currency: "RUB", pipeline_key: "0", stage_key: "OFFER", company_key: "1", contact_key: "10" },
      { key: "101", name: "Без компании", amount: 1000, currency: "RUB", pipeline_key: "0", stage_key: "APOLOGY", company_key: null, contact_key: null },
    ],
  };

  it("builds one won and one lost stage from the source", () => {
    expect(stagesFor(source.pipelines[0]!).map((s) => [s.name, s.is_won, s.is_lost])).toEqual([
      ["Новая", false, false],
      ["КП", false, false],
      ["Успех", true, false],
      ["Провал", false, true],
    ]);
  });

  it("checks first, then moves, and a second run adds nothing", async () => {
    const check = await importCrm(admin(), "bitrix24", source, { dryRun: true, createPipeline });
    expect(check).toMatchObject({ dry_run: true, pipelines: { created: 1 }, companies: { created: 1 }, deals: { created: 2 } });
    expect(data().pipelines.some((p) => p.name === "Опт")).toBe(false);

    const run = await importCrm(admin(), "bitrix24", source, { dryRun: false, createPipeline });
    expect(run.errors).toEqual([]);
    expect(run).toMatchObject({ companies: { created: 1 }, contacts: { created: 1 }, deals: { created: 2 } });
    const pipeline = data().pipelines.find((p) => p.name === "Опт")!;
    const stage = (id: string) => data().pipeline_stages.find((s) => s.id === id)!;
    const offer = data().deals.find((d) => d.name === "Поставка")!;
    expect(stage(offer.stage_id)).toMatchObject({ pipeline_id: pipeline.id, name: "КП" });
    expect(offer.amount).toBe(150000);
    const company = data().companies.find((c) => c.name === "ООО Альфа")!;
    expect(company).toMatchObject({ website: "https://alfa.ru/", country: "RU" });
    expect(data().contacts.find((c) => c.first_name === "Иван")).toMatchObject({ company_id: company.id, email: null });
    // "Analysis of the reason" is another failure stage in Bitrix24: it becomes the single lost stage.
    const lost = data().deals.find((d) => d.name === "Без компании")!;
    expect(stage(lost.stage_id).is_lost).toBe(true);
    // Imported deals do not run automations.
    expect(data().automation_executions.filter((e) => e.trigger_payload && (e.trigger_payload as { deal_id?: string }).deal_id === offer.id)).toEqual([]);

    const again = await importCrm(admin(), "bitrix24", source, { dryRun: false, createPipeline });
    expect(again).toMatchObject({ pipelines: { created: 0, matched: ["Опт"] }, companies: { created: 0, skipped: 1 }, contacts: { skipped: 1 }, deals: { created: 0, skipped: 2 } });
  });

  it("is for admins only", async () => {
    await expect(importCrm(ctxFor(db, data(), DEMO_USER_IDS.manager), "amocrm", source, { dryRun: true, createPipeline })).rejects.toThrow();
  });
});
