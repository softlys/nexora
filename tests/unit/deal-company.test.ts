import { beforeEach, describe, expect, it } from "vitest";
import type { Dataset } from "@/domain/entities";
import { dealInput, dealUpdateInput } from "@/domain/inputs";
import type { Db } from "@/server/db/types";
import { createDeal, updateDeal } from "@/server/services/deals";
import { createTestDb, ctxFor, DEMO_USER_IDS } from "./helpers/services";

const base = { name: "Typed company deal", primary_contact_id: null, amount: 12000, currency: "USD", expected_close_date: null, source: "outbound", next_activity: "", notes: "" };

describe("deal with a company typed by name", () => {
  let db: Db;
  let data: () => Dataset;
  beforeEach(() => {
    ({ db, data } = createTestDb());
  });

  it("needs either an existing company or a new name with a valid country", () => {
    expect(dealInput.safeParse(base).success).toBe(false);
    expect(dealInput.safeParse({ ...base, new_company: { name: "Север", industry: "", country: "XX" } }).success).toBe(false);
    expect(dealInput.safeParse({ ...base, new_company: { name: "Север", industry: "", country: "RU" } }).success).toBe(true);
  });

  it("creates the company with the deal, owned by the user who typed it", async () => {
    const rep = ctxFor(db, data(), DEMO_USER_IDS.repDaniel);
    const before = data().companies.length;
    const deal = await createDeal(rep, dealInput.parse({ ...base, new_company: { name: "ООО Север", industry: "", country: "RU" } }));
    const company = data().companies.find((c) => c.id === deal.company_id)!;
    expect(data().companies).toHaveLength(before + 1);
    expect(company).toMatchObject({ name: "ООО Север", industry: "Other", country: "RU", lifecycle_stage: "prospect", owner_id: DEMO_USER_IDS.repDaniel });
  });

  it("reuses an existing company with the same name instead of duplicating it", async () => {
    const admin = ctxFor(db, data(), DEMO_USER_IDS.admin);
    const existing = data().companies.find((c) => !c.archived_at)!;
    const before = data().companies.length;
    const deal = await createDeal(admin, dealInput.parse({ ...base, new_company: { name: `  ${existing.name.toUpperCase()} `, industry: "", country: "US" } }));
    expect(deal.company_id).toBe(existing.id);
    expect(data().companies).toHaveLength(before);
  });

  it("moves an existing deal to a newly typed company", async () => {
    const admin = ctxFor(db, data(), DEMO_USER_IDS.admin);
    const deal = data().deals.find((d) => !d.archived_at && !d.closed_at)!;
    const updated = await updateDeal(
      admin,
      dealUpdateInput.parse({ ...base, id: deal.id, name: deal.name, amount: deal.amount, currency: deal.currency, new_company: { name: "Kazakh Steppe Logistics", industry: "Logistics", country: "KZ" } }),
    );
    const company = data().companies.find((c) => c.id === updated.company_id)!;
    expect(company).toMatchObject({ name: "Kazakh Steppe Logistics", industry: "Logistics", country: "KZ" });
  });
});
