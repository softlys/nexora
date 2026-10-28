import { beforeEach, describe, expect, it } from "vitest";
import type { Dataset } from "@/domain/entities";
import { orderInput } from "@/domain/inputs";
import type { Db } from "@/server/db/types";
import { applyOrderUpdates, markOrdersExported, onecSku, ordersForOnec, parseCatalog, parseOffers, parseOrderUpdates, syncCatalog } from "@/server/integrations/onec";
import { changeOrderStatus, createOrder } from "@/server/services/orders";
import { createTestDb, ctxFor, DEMO_USER_IDS } from "./helpers/services";

const IMPORT = `<?xml version="1.0" encoding="UTF-8"?>
<КоммерческаяИнформация ВерсияСхемы="2.08">
  <Классификатор><Группы><Группа><Ид>g1</Ид><Наименование>Насосы</Наименование></Группа></Группы></Классификатор>
  <Каталог>
    <Товары>
      <Товар><Ид>a1b2-c3</Ид><Артикул>НС-100</Артикул><Наименование>Насос центробежный</Наименование><Группы><Ид>g1</Ид></Группы><СтавкиНалогов><СтавкаНалога><Наименование>НДС</Наименование><Ставка>20</Ставка></СтавкаНалога></СтавкиНалогов></Товар>
      <Товар><Ид>d4e5</Ид><Артикул>PUMP-200</Артикул><Наименование>Pump 200</Наименование></Товар>
    </Товары>
  </Каталог>
</КоммерческаяИнформация>`;

const OFFERS = `<?xml version="1.0" encoding="UTF-8"?>
<КоммерческаяИнформация ВерсияСхемы="2.08"><ПакетПредложений><Предложения>
  <Предложение><Ид>a1b2-c3</Ид><Цены><Цена><ЦенаЗаЕдиницу>15000,50</ЦенаЗаЕдиницу></Цена></Цены></Предложение>
  <Предложение><Ид>d4e5#size-L</Ид><Цены><Цена><ЦенаЗаЕдиницу>900</ЦенаЗаЕдиницу></Цена></Цены></Предложение>
</Предложения></ПакетПредложений></КоммерческаяИнформация>`;

describe("1C CommerceML", () => {
  it("parses products, groups, VAT and prices", () => {
    expect(parseCatalog(IMPORT)).toEqual([
      { id: "a1b2-c3", sku: "NS-100", name: "Насос центробежный", description: "", tax_rate: 20, group: "Насосы" },
      { id: "d4e5", sku: "PUMP-200", name: "Pump 200", description: "", tax_rate: 0, group: "1C" },
    ]);
    expect(parseOffers(OFFERS)).toEqual([
      { id: "a1b2-c3", price: 15000.5 },
      { id: "d4e5", price: 900 },
    ]);
    expect(onecSku("АБВ", "x-1")).toBe("ABV");
    expect(onecSku("", "x-1")).toBe("1C-X1");
  });

  let db: Db;
  let data: () => Dataset;
  beforeEach(() => {
    ({ db, data } = createTestDb());
  });
  const admin = () => ctxFor(db, data(), DEMO_USER_IDS.admin);

  it("creates products from import.xml, then prices from offers.xml, and updates on the next exchange", async () => {
    expect(await syncCatalog(admin(), parseCatalog(IMPORT), [], "RUB")).toEqual({ created: 2, updated: 0 });
    await syncCatalog(admin(), [], parseOffers(OFFERS), "RUB");
    const pump = data().products.find((p) => p.sku === "NS-100")!;
    expect(pump).toMatchObject({ name: "Насос центробежный", unit_price: 15000.5, tax_rate: 20, category: "Насосы" });
    expect(await syncCatalog(admin(), parseCatalog(IMPORT.replace("Pump 200", "Pump 200 Pro")), [], "RUB")).toEqual({ created: 0, updated: 1 });
  });

  it("exports confirmed orders with ИНН, once, and applies posting and payment from 1C", async () => {
    const company = data().companies.find((c) => !c.archived_at)!;
    await db.write(data().organizations[0]!.id, (tx) => tx.update("companies", company.id, { custom: { inn: "7701234567", kpp: "770101001" } }));
    const order = await createOrder(admin(), orderInput.parse({ company_id: company.id, currency: "RUB", order_date: "2026-10-20", expected_delivery_date: null, notes: "", items: [{ product_id: null, description: "Монтаж", quantity: 2, unit_price: 5000, discount_pct: 10, tax_rate: 0 }] }));
    const draftExport = await ordersForOnec(admin());
    expect(draftExport.xml).not.toContain(order.order_number);

    await changeOrderStatus(admin(), { id: order.id, status: "confirmed" });
    const { xml, until } = await ordersForOnec(admin());
    expect(xml).toContain(`<Номер>${order.order_number}</Номер>`);
    expect(xml).toContain("<ИНН>7701234567</ИНН>");
    expect(xml).toContain("<КПП>770101001</КПП>");
    expect(xml).toContain("<ЦенаЗаЕдиницу>5000.00</ЦенаЗаЕдиницу>");
    await markOrdersExported(admin(), until);
    expect((await ordersForOnec(admin())).xml).not.toContain(order.order_number);

    const back = `<?xml version="1.0" encoding="UTF-8"?><КоммерческаяИнформация><Документ><Номер>${order.order_number}</Номер><Сумма>9000</Сумма><ЗначенияРеквизитов><ЗначениеРеквизита><Наименование>Проведен</Наименование><Значение>true</Значение></ЗначениеРеквизита><ЗначениеРеквизита><Наименование>Дата оплаты по 1С</Наименование><Значение>2026-10-25T10:00:00</Значение></ЗначениеРеквизита></ЗначенияРеквизитов></Документ></КоммерческаяИнформация>`;
    const updates = parseOrderUpdates(back);
    expect(updates[0]).toMatchObject({ number: order.order_number, posted: true, paidOn: "2026-10-25T10:00:00" });
    expect(await applyOrderUpdates(admin(), updates)).toEqual({ confirmed: 0, paid: 1 });
    expect(data().payments.filter((p) => p.order_id === order.id).map((p) => [p.amount, p.method, p.is_simulated])).toEqual([[9000, "bank_transfer", false]]);
    // The same document again records nothing.
    expect(await applyOrderUpdates(admin(), updates)).toEqual({ confirmed: 0, paid: 0 });
  });
});

describe("1C exchange endpoint", () => {
  it("checks the login and hands 1C a session cookie", async () => {
    process.env.ONEC_LOGIN = "exchange";
    process.env.ONEC_PASSWORD = "correct-horse-battery";
    const { GET } = await import("@/app/api/1c/exchange/route");
    const url = "https://crm.example/api/1c/exchange?type=catalog&mode=checkauth";
    const basic = (p: string) => ({ authorization: `Basic ${Buffer.from(`exchange:${p}`).toString("base64")}` });
    expect((await GET(new Request(url, { headers: basic("wrong") }))).status).toBe(401);
    const ok = await GET(new Request(url, { headers: basic("correct-horse-battery") }));
    const [status, name, value] = (await ok.text()).trim().split("\n");
    expect([status, name]).toEqual(["success", "nexora_1c"]);
    const init = await GET(new Request(url.replace("checkauth", "init"), { headers: { cookie: `${name}=${value}` } }));
    expect(await init.text()).toContain("zip=no");
    delete process.env.ONEC_LOGIN;
    delete process.env.ONEC_PASSWORD;
  });
});
