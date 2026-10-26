import { beforeEach, describe, expect, it } from "vitest";
import { fieldKey, normalizeCustom, type CustomFieldDef } from "@/domain/custom-fields";
import type { Dataset } from "@/domain/entities";
import { companyInput, companyUpdateInput, dealInput } from "@/domain/inputs";
import type { Db } from "@/server/db/types";
import { createCompany, updateCompany } from "@/server/services/companies";
import { archiveCustomField, customFieldInput, saveCustomField } from "@/server/services/custom-fields";
import { createDeal } from "@/server/services/deals";
import { importCsv } from "@/server/services/imports";
import { createTestDb, ctxFor, DEMO_USER_IDS } from "./helpers/services";

const def = (over: Partial<CustomFieldDef>): CustomFieldDef => ({ id: "f", key: "k", label: "K", type: "text", options: [], required: false, position: 0, ...over });

describe("custom field values", () => {
  it("derives latin keys from labels in any script", () => {
    expect(fieldKey("ИНН")).toBe("inn");
    expect(fieldKey("Тип клиента")).toBe("tip_klienta");
    expect(fieldKey("Contract date")).toBe("contract_date");
    expect(fieldKey("2nd phone")).toBe("f_2nd_phone");
  });

  it("normalizes values by type and reports problems per field", () => {
    const defs = [
      def({ key: "inn", required: true }),
      def({ key: "employees", type: "number" }),
      def({ key: "signed", type: "date" }),
      def({ key: "kind", type: "select", options: ["Опт", "Розница"] }),
      def({ key: "vip", type: "checkbox" }),
      def({ key: "site", type: "url" }),
    ];
    expect(normalizeCustom(defs, { inn: " 7701234567 ", employees: "1 250,5", signed: "2026-10-01", kind: "Опт", vip: "да", site: "example.ru", junk: "x" })).toEqual({
      values: { inn: "7701234567", employees: 1250.5, signed: "2026-10-01", kind: "Опт", vip: true, site: "https://example.ru/" },
      issues: [],
    });
    const bad = normalizeCustom(defs, { inn: "", employees: "many", signed: "01.10.2026", kind: "Other", site: "javascript:alert(1)" });
    expect(bad.issues.map((i) => i.key)).toEqual(["inn", "employees", "signed", "kind", "site"]);
    // An unchecked checkbox is stored as false.
    expect(bad.values.vip).toBe(false);
  });
});

describe("custom fields on records", () => {
  let db: Db;
  let data: () => Dataset;
  beforeEach(() => {
    ({ db, data } = createTestDb());
  });
  const admin = () => ctxFor(db, data(), DEMO_USER_IDS.admin);
  const rep = () => ctxFor(db, data(), DEMO_USER_IDS.repDaniel);
  const company = { name: "ООО Ромашка", website: "", industry: "Food Processing", size: "11-50", country: "RU", city: "Москва", address: "", phone: "", lifecycle_stage: "prospect", notes: "" };

  it("lets only admins define fields and keys them uniquely per record type", async () => {
    await expect(saveCustomField(rep(), customFieldInput.parse({ entity: "company", label: "ИНН", type: "text" }))).rejects.toThrow();
    const first = await saveCustomField(admin(), customFieldInput.parse({ entity: "company", label: "ИНН", type: "text", required: true }));
    const second = await saveCustomField(admin(), customFieldInput.parse({ entity: "company", label: "инн", type: "text" }));
    const onDeals = await saveCustomField(admin(), customFieldInput.parse({ entity: "deal", label: "ИНН", type: "text" }));
    expect([first.key, second.key, onDeals.key]).toEqual(["inn", "inn_2", "inn"]);
    expect(customFieldInput.safeParse({ entity: "deal", label: "Kind", type: "select" }).success).toBe(false);
  });

  it("validates values against the definitions when records are saved", async () => {
    await saveCustomField(admin(), customFieldInput.parse({ entity: "company", label: "ИНН", type: "text", required: true }));
    await saveCustomField(admin(), customFieldInput.parse({ entity: "company", label: "Тип клиента", type: "select", options: ["Опт", "Розница"] }));
    await expect(createCompany(admin(), companyInput.parse({ ...company, custom: { tip_klienta: "Опт" } }))).rejects.toMatchObject({ fields: { "custom.inn": ["Required"] } });
    const created = await createCompany(admin(), companyInput.parse({ ...company, custom: { inn: "7701234567", tip_klienta: "Опт", unknown: "dropped" } }));
    expect(created.custom).toEqual({ inn: "7701234567", tip_klienta: "Опт" });

    // An update without custom values keeps them; with values they are replaced field by field.
    const renamed = await updateCompany(admin(), companyUpdateInput.parse({ id: created.id, ...company, name: "ООО Ромашка+" }));
    expect(renamed.custom).toEqual({ inn: "7701234567", tip_klienta: "Опт" });
    const changed = await updateCompany(admin(), companyUpdateInput.parse({ id: created.id, ...company, custom: { inn: "7701234567", tip_klienta: "" } }));
    expect(changed.custom).toEqual({ inn: "7701234567" });
  });

  it("keeps values of a removed field on the records", async () => {
    const inn = await saveCustomField(admin(), customFieldInput.parse({ entity: "company", label: "ИНН", type: "text" }));
    const created = await createCompany(admin(), companyInput.parse({ ...company, custom: { inn: "7701234567" } }));
    await archiveCustomField(admin(), inn.id);
    const updated = await updateCompany(admin(), companyUpdateInput.parse({ id: created.id, ...company, custom: {} }));
    expect(updated.custom).toEqual({ inn: "7701234567" });
  });

  it("stores custom values on new deals", async () => {
    await saveCustomField(admin(), customFieldInput.parse({ entity: "deal", label: "Contract date", type: "date" }));
    const c = data().companies.find((x) => !x.archived_at)!;
    const deal = await createDeal(admin(), dealInput.parse({ name: "Поставка", company_id: c.id, primary_contact_id: null, amount: 1000, currency: "USD", expected_close_date: null, source: "outbound", next_activity: "", notes: "", custom: { contract_date: "2026-11-01" } }));
    expect(deal.custom).toEqual({ contract_date: "2026-11-01" });
  });

  it("imports custom columns from CSV by label and reports bad values by row", async () => {
    await saveCustomField(admin(), customFieldInput.parse({ entity: "company", label: "ИНН", type: "text" }));
    await saveCustomField(admin(), customFieldInput.parse({ entity: "company", label: "Партнёр", type: "checkbox" }));
    await saveCustomField(admin(), customFieldInput.parse({ entity: "company", label: "Сотрудников", type: "number" }));
    const csv = "Name,Industry,Country,ИНН,Партнёр,Сотрудников\nАльфа,Retail,RU,7701,да,120\nБета,Retail,RU,7702,no,много\n";
    const check = await importCsv(admin(), { entity: "companies", csv, dry_run: true });
    expect(check.errors).toEqual([{ row: 3, message: "Сотрудников: Enter a number" }]);
    const ok = await importCsv(admin(), { entity: "companies", csv: csv.replace("много", "15"), dry_run: false });
    expect(ok.created).toBe(2);
    expect(data().companies.find((c) => c.name === "Альфа")?.custom).toEqual({ inn: "7701", partner: true, sotrudnikov: 120 });
    expect(data().companies.find((c) => c.name === "Бета")?.custom).toEqual({ inn: "7702", partner: false, sotrudnikov: 15 });
  });
});
