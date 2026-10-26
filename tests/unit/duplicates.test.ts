import { beforeEach, describe, expect, it } from "vitest";
import { groupDuplicates, matchKeys, normalizeName, phoneKey, websiteKey } from "@/domain/duplicates";
import type { Dataset } from "@/domain/entities";
import { companyInput, contactInput } from "@/domain/inputs";
import type { Db } from "@/server/db/types";
import { createCompany } from "@/server/services/companies";
import { createContact } from "@/server/services/contacts";
import { findDuplicates, listDuplicateGroups, mergeInput, mergeRecords } from "@/server/services/duplicates";
import { createTestDb, ctxFor, DEMO_USER_IDS } from "./helpers/services";

describe("match keys", () => {
  it("normalizes names, phones and websites", () => {
    expect(normalizeName("ООО «Ромашка»")).toBe("ромашка");
    expect(normalizeName("Ромашка, LLC")).toBe("ромашка");
    expect(normalizeName("Ёлка Inc.")).toBe("елка");
    expect(phoneKey("+7 (999) 123-45-67")).toBe(phoneKey("8 999 123 45 67"));
    expect(phoneKey("123")).toBe("");
    expect(websiteKey("https://www.Example.ru/about")).toBe("example.ru");
    expect(websiteKey("example.ru")).toBe("example.ru");
    expect(matchKeys({ name: "ab" })).toEqual([]);
  });

  it("groups records linked directly or through each other", () => {
    const items = [
      { id: "1", name: "Альфа", phone: "+7 999 000-00-01" },
      { id: "2", name: "ООО Альфа", phone: null },
      { id: "3", name: "Гамма", phone: "8 999 000 00 01" },
      { id: "4", name: "Дельта", phone: null },
    ];
    const groups = groupDuplicates(items, (i) => i);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.items.map((i) => i.id).sort()).toEqual(["1", "2", "3"]);
    expect(groups[0]!.reasons.sort()).toEqual(["name", "phone"]);
  });
});

describe("duplicates in the CRM", () => {
  let db: Db;
  let data: () => Dataset;
  beforeEach(() => {
    ({ db, data } = createTestDb());
  });
  const admin = () => ctxFor(db, data(), DEMO_USER_IDS.admin);
  const manager = () => ctxFor(db, data(), DEMO_USER_IDS.manager);
  const company = (name: string, extra = {}) => companyInput.parse({ name, website: "", industry: "Retail", size: "11-50", country: "RU", city: "", address: "", phone: "", lifecycle_stage: "prospect", notes: "", ...extra });
  const contact = (first_name: string, extra = {}) => contactInput.parse({ company_id: null, first_name, last_name: "Иванов", email: "", phone: "", job_title: "", tags: [], ...extra });

  it("warns about look-alike records while one is entered", async () => {
    const existing = await createCompany(admin(), company("ООО Ромашка", { website: "https://romashka.ru" }));
    const byName = await findDuplicates(admin(), { entity: "company", name: "Ромашка LLC" });
    expect(byName.map((m) => [m.id, m.reasons])).toEqual([[existing.id, ["name"]]]);
    expect((await findDuplicates(admin(), { entity: "company", name: "Другая", website: "www.romashka.ru" }))[0]?.reasons).toEqual(["website"]);
    expect(await findDuplicates(admin(), { entity: "company", name: "Ромашка", exclude_id: existing.id })).toEqual([]);

    const person = await createContact(admin(), contact("Пётр", { email: "Petr@Example.ru" }));
    const lead = await findDuplicates(admin(), { entity: "lead", email: "petr@example.ru", company_name: "Ромашка" });
    expect(lead.map((m) => m.entity).sort()).toEqual(["company", "contact"]);
    expect(lead.find((m) => m.entity === "contact")?.id).toBe(person.id);
  });

  it("merges companies: links move to the kept one, blanks are filled, the others are archived", async () => {
    const kept = await createCompany(admin(), company("Ромашка"));
    const dup = await createCompany(admin(), company("ООО Ромашка", { website: "https://romashka.ru", phone: "+7 999 111-22-33", notes: "Старые заметки" }));
    const person = await createContact(admin(), contact("Анна", { company_id: dup.id }));
    expect((await listDuplicateGroups(admin(), "company")).some((g) => g.records.map((r) => r.id).join() === [kept.id, dup.id].join())).toBe(true);

    await expect(mergeRecords(manager(), mergeInput.parse({ entity: "company", keep_id: kept.id, merge_ids: [dup.id] }))).rejects.toThrow();
    const result = await mergeRecords(admin(), mergeInput.parse({ entity: "company", keep_id: kept.id, merge_ids: [dup.id] }));
    expect(result).toMatchObject({ id: kept.id, merged: 1 });
    const after = data().companies.find((c) => c.id === kept.id)!;
    expect(after).toMatchObject({ website: "https://romashka.ru", phone: "+7 999 111-22-33", notes: "Старые заметки" });
    expect(data().companies.find((c) => c.id === dup.id)?.archived_at).not.toBeNull();
    expect(data().contacts.find((c) => c.id === person.id)?.company_id).toBe(kept.id);
    expect(data().activities.some((a) => a.company_id === kept.id && a.subject === "Duplicates merged")).toBe(true);
    expect(mergeInput.safeParse({ entity: "company", keep_id: kept.id, merge_ids: [kept.id] }).success).toBe(false);
  });

  it("merges contacts with their deals, tags and messengers", async () => {
    const deal = data().deals.find((d) => d.primary_contact_id && !d.archived_at)!;
    const keptId = deal.primary_contact_id!;
    const kept = data().contacts.find((c) => c.id === keptId)!;
    const dup = await createContact(admin(), contact("Дубль", { email: kept.email, tags: ["vip"], messengers: { telegram: "@dubl_ivanov" } }));
    expect((await findDuplicates(admin(), { entity: "contact", email: kept.email ?? "" })).map((m) => m.id).sort()).toEqual([keptId, dup.id].sort());

    const dealOfDup = data().deals.find((d) => d.id !== deal.id && !d.archived_at)!;
    await db.write(data().organizations[0]!.id, (tx) => tx.update("deals", dealOfDup.id, { primary_contact_id: dup.id }));
    await mergeRecords(admin(), mergeInput.parse({ entity: "contact", keep_id: keptId, merge_ids: [dup.id] }));
    const after = data().contacts.find((c) => c.id === keptId)!;
    expect(after.tags).toContain("vip");
    expect(after.messengers?.telegram).toBe(kept.messengers?.telegram ?? "dubl_ivanov");
    expect(data().deals.find((d) => d.id === dealOfDup.id)?.primary_contact_id).toBe(keptId);
  });
});
