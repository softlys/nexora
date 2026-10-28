import { beforeEach, describe, expect, it } from "vitest";
import { numberInWords, rublesInWords, ruPlural } from "@/domain/amount-in-words";
import { requisitesSchema, type Dataset } from "@/domain/entities";
import type { Db } from "@/server/db/types";
import { EMPTY_REQUISITES, getRequisites, saveRequisites } from "@/server/services/requisites";
import { createTestDb, ctxFor, DEMO_USER_IDS } from "./helpers/services";

describe("amount in words", () => {
  it("writes rubles and kopecks in Russian", () => {
    expect(rublesInWords(0)).toBe("Ноль рублей 00 копеек");
    expect(rublesInWords(1)).toBe("Один рубль 00 копеек");
    expect(rublesInWords(2.01)).toBe("Два рубля 01 копейка");
    expect(rublesInWords(12345.6)).toBe("Двенадцать тысяч триста сорок пять рублей 60 копеек");
    expect(rublesInWords(21000)).toBe("Двадцать одна тысяча рублей 00 копеек");
    expect(rublesInWords(1_002_011)).toBe("Один миллион две тысячи одиннадцать рублей 00 копеек");
    expect(numberInWords(2_000_000_000)).toBe("два миллиарда");
    expect(ruPlural(14, ["рубль", "рубля", "рублей"])).toBe("рублей");
    expect(ruPlural(22, ["рубль", "рубля", "рублей"])).toBe("рубля");
  });
});

describe("requisites", () => {
  let db: Db;
  let data: () => Dataset;
  beforeEach(() => {
    ({ db, data } = createTestDb());
  });

  it("validates Russian details and saves them for admins only", async () => {
    const good = { ...EMPTY_REQUISITES, legal_name: "ООО «Пример»", inn: "7701234567", kpp: "770101001", bik: "044525225", account: "40702810400000000001", corr_account: "30101810400000000225", director: "Иванов И. И." };
    expect(requisitesSchema.safeParse(good).success).toBe(true);
    expect(requisitesSchema.safeParse({ ...good, inn: "123" }).success).toBe(false);
    expect(requisitesSchema.safeParse({ ...good, stamp: "javascript:alert(1)" }).success).toBe(false);
    expect(requisitesSchema.safeParse({ ...good, stamp: "data:image/png;base64,iVBORw0KGgo=" }).success).toBe(true);
    await expect(saveRequisites(ctxFor(db, data(), DEMO_USER_IDS.manager), good)).rejects.toThrow();
    await saveRequisites(ctxFor(db, data(), DEMO_USER_IDS.admin), good);
    expect(await getRequisites(ctxFor(db, data(), DEMO_USER_IDS.repDaniel))).toMatchObject({ legal_name: "ООО «Пример»", bik: "044525225" });
  });
});
