import "server-only";
import { XMLBuilder, XMLParser } from "fast-xml-parser";
import type { Order, Product } from "@/domain/entities";
import { emit, newId, type ServiceContext } from "@/server/services/context";
import { readCursor } from "./inbound";
import { recordOnlinePayment } from "./payments";

/**
 * 1C exchange (1С:Управление торговлей, Бухгалтерия, КА, УНФ) over the standard "Обмен с сайтом"
 * protocol and CommerceML 2 — the same exchange 1C runs with 1C-Bitrix:
 *  - catalog: 1C sends import.xml (товары) and offers.xml (цены) → NEXORA products;
 *  - sale, query: NEXORA returns orders with counterparties (ИНН/КПП from custom fields) → 1C;
 *  - sale, file: 1C sends documents back → orders marked as confirmed (проведён) and payments
 *    recorded (дата оплаты по 1С).
 * Login and password: ONEC_LOGIN / ONEC_PASSWORD, entered in 1C's exchange settings.
 */

export function onecConfig(env: NodeJS.ProcessEnv = process.env) {
  const login = env.ONEC_LOGIN?.trim() || null;
  const password = env.ONEC_PASSWORD?.trim() || null;
  return { login, password, configured: Boolean(login && password && password.length >= 8) };
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  trimValues: true,
  // Elements that can repeat are always arrays, so one item and many look the same.
  isArray: (name) => ["Товар", "Предложение", "Цена", "Группа", "Документ", "ЗначениеРеквизита", "СтавкаНалога", "Контрагент"].includes(name),
  processEntities: true,
  htmlEntities: false,
});

type Node = Record<string, unknown>;
const text = (v: unknown): string => (v === undefined || v === null ? "" : typeof v === "object" ? text((v as Node)["#text"]) : String(v)).trim();
const list = (v: unknown): Node[] => (Array.isArray(v) ? (v as Node[]) : v ? [v as Node] : []);
const num = (v: unknown) => Number(text(v).replace(/\s/g, "").replace(",", ".")) || 0;

export type CatalogItem = { id: string; sku: string; name: string; description: string; tax_rate: number; group: string };
export type OfferItem = { id: string; price: number };

/** NEXORA SKUs are A–Z, 0–9 and "-", 3–32 characters; without a usable артикул the 1C id is used. */
const TRANSLIT: Record<string, string> = { А: "A", Б: "B", В: "V", Г: "G", Д: "D", Е: "E", Ё: "E", Ж: "ZH", З: "Z", И: "I", Й: "Y", К: "K", Л: "L", М: "M", Н: "N", О: "O", П: "P", Р: "R", С: "S", Т: "T", У: "U", Ф: "F", Х: "H", Ц: "TS", Ч: "CH", Ш: "SH", Щ: "SCH", Ъ: "", Ы: "Y", Ь: "", Э: "E", Ю: "YU", Я: "YA" };

export function onecSku(article: string, id: string): string {
  const latin = article
    .toUpperCase()
    .split("")
    .map((c) => TRANSLIT[c] ?? c)
    .join("")
    .replace(/[^A-Z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return latin.length >= 3 ? latin.slice(0, 32) : `1C-${id.replace(/[^A-Za-z0-9]/g, "").slice(0, 12).toUpperCase()}`;
}

/** Товары from import.xml (CommerceML 2). */
export function parseCatalog(xml: string): CatalogItem[] {
  const root = (parser.parse(xml) as Node)["КоммерческаяИнформация"] as Node | undefined;
  const groups = new Map<string, string>();
  const walk = (nodes: Node[]) => {
    for (const g of nodes) {
      groups.set(text(g["Ид"]), text(g["Наименование"]));
      walk(list((g["Группы"] as Node | undefined)?.["Группа"]));
    }
  };
  walk(list(((root?.["Классификатор"] as Node | undefined)?.["Группы"] as Node | undefined)?.["Группа"]));
  const goods = list(((root?.["Каталог"] as Node | undefined)?.["Товары"] as Node | undefined)?.["Товар"]);
  return goods.map((g) => {
    const id = text(g["Ид"]);
    const rate = list((g["СтавкиНалогов"] as Node | undefined)?.["СтавкаНалога"])[0];
    const groupId = text(list((g["Группы"] as Node | undefined)?.["Ид"] ?? [])[0] ?? (g["Группы"] as Node | undefined)?.["Ид"]);
    return { id, sku: onecSku(text(g["Артикул"]), id), name: text(g["Наименование"]).slice(0, 160) || id, description: text(g["Описание"]).slice(0, 1000), tax_rate: Math.min(100, Math.max(0, num(rate?.["Ставка"]))), group: (groups.get(groupId) || "1C").slice(0, 80) };
  });
}

/** Предложения from offers.xml: the first price of each offer (characteristics after "#" share the product). */
export function parseOffers(xml: string): OfferItem[] {
  const root = (parser.parse(xml) as Node)["КоммерческаяИнформация"] as Node | undefined;
  const offers = list(((root?.["ПакетПредложений"] as Node | undefined)?.["Предложения"] as Node | undefined)?.["Предложение"]);
  return offers.map((o) => ({ id: text(o["Ид"]).split("#")[0]!, price: num(list((o["Цены"] as Node | undefined)?.["Цена"])[0]?.["ЦенаЗаЕдиницу"]) }));
}

/** Creates or updates products from 1C; remembers 1C ids so offers and orders find them. */
export async function syncCatalog(ctx: ServiceContext, items: CatalogItem[], offers: OfferItem[], currency: string): Promise<{ created: number; updated: number }> {
  return ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const links = new Map((await tx.find("integration_records", { source: "1c" })).filter((r) => r.entity_type === "product").map((r) => [r.external_id, r.entity_id!]));
    const products = new Map((await tx.find("products")).map((p) => [p.id, p]));
    const bySku = new Map([...products.values()].map((p) => [p.sku, p]));
    const prices = new Map(offers.map((o) => [o.id, o.price]));
    const at = new Date().toISOString();
    let created = 0;
    let updated = 0;
    const touch = async (id: string, patch: Partial<Product>) => {
      const current = products.get(id)!;
      if (Object.entries(patch).some(([k, v]) => (current as Record<string, unknown>)[k] !== v)) {
        products.set(id, await tx.update("products", id, { ...patch, updated_at: at }));
        updated++;
      }
    };
    for (const item of items) {
      const price = prices.get(item.id);
      const fields = { name: item.name, category: item.group, description: item.description, tax_rate: item.tax_rate, is_active: true, ...(price !== undefined && { unit_price: price }) };
      const linked = links.get(`product:${item.id}`) ?? bySku.get(item.sku)?.id;
      if (linked && products.has(linked)) {
        await touch(linked, fields);
        if (!links.has(`product:${item.id}`)) {
          await tx.insert("integration_records", { id: newId(), organization_id: ctx.actor.organization_id, source: "1c", external_id: `product:${item.id}`.slice(0, 255), entity_type: "product", entity_id: linked, data: {}, created_at: at, updated_at: at });
          links.set(`product:${item.id}`, linked);
        }
        continue;
      }
      const product: Product = { id: newId(), organization_id: ctx.actor.organization_id, sku: item.sku, unit_price: price ?? 0, currency, ...fields, created_at: at, updated_at: at, archived_at: null };
      await tx.insert("products", product);
      await tx.insert("integration_records", { id: newId(), organization_id: ctx.actor.organization_id, source: "1c", external_id: `product:${item.id}`.slice(0, 255), entity_type: "product", entity_id: product.id, data: {}, created_at: at, updated_at: at });
      products.set(product.id, product);
      bySku.set(product.sku, product);
      links.set(`product:${item.id}`, product.id);
      created++;
    }
    // offers.xml can come alone (prices only).
    if (items.length === 0) {
      for (const o of offers) {
        const id = links.get(`product:${o.id}`);
        if (id && products.has(id)) await touch(id, { unit_price: o.price });
      }
    }
    return { created, updated };
  });
}

const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: "@_", format: true, suppressEmptyNode: true });
const money = (n: number) => n.toFixed(2);
const currencyCode = (c: string) => (c === "RUB" ? "руб" : c);

/** Orders changed since the last successful export, as a CommerceML document for 1C. */
export async function ordersForOnec(ctx: ServiceContext): Promise<{ xml: string; count: number; until: string }> {
  return ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const since = String((await readCursor(tx, "1c", "orders"))?.exported_until ?? "");
    const until = new Date().toISOString();
    const orders = (await tx.find("orders", { archived_at: null })).filter((o) => o.status !== "draft" && o.updated_at > since && o.updated_at <= until).sort((a, b) => a.order_number.localeCompare(b.order_number));
    const links = new Map((await tx.find("integration_records", { source: "1c" })).filter((r) => r.entity_type === "product").map((r) => [r.entity_id!, r.external_id.replace(/^product:/, "")]));
    const companies = new Map((await tx.find("companies")).map((c) => [c.id, c]));
    const items = await tx.find("order_items");
    const doc = (o: Order) => {
      const company = companies.get(o.company_id);
      const custom = (company?.custom ?? {}) as Record<string, unknown>;
      const lines = items.filter((i) => i.order_id === o.id).sort((a, b) => a.position - b.position);
      return {
        "Ид": o.id,
        "Номер": o.order_number,
        "Дата": o.order_date,
        "ХозОперация": "Заказ товара",
        "Роль": "Продавец",
        "Валюта": currencyCode(o.currency),
        "Курс": "1",
        "Сумма": money(o.total),
        "Контрагенты": {
          "Контрагент": [
            {
              "Ид": company?.id ?? o.company_id,
              "Наименование": company?.name ?? "",
              "ПолноеНаименование": company?.name ?? "",
              "Роль": "Покупатель",
              ...(custom.inn ? { "ИНН": String(custom.inn) } : {}),
              ...(custom.kpp ? { "КПП": String(custom.kpp) } : {}),
            },
          ],
        },
        "Комментарий": o.notes,
        "Товары": {
          "Товар": lines.map((l) => ({
            "Ид": (l.product_id && links.get(l.product_id)) || l.product_id || l.id,
            "Наименование": l.description,
            "БазоваяЕдиница": { "@_Код": "796", "@_НаименованиеПолное": "Штука", "#text": "шт" },
            "ЦенаЗаЕдиницу": money(Number(l.unit_price)),
            "Количество": String(Number(l.quantity)),
            "Сумма": money(Number(l.line_total)),
            ...(Number(l.discount_pct) > 0 ? { "Скидки": { "Скидка": { "Наименование": "Скидка", "Процент": String(Number(l.discount_pct)), "УчтеноВСумме": "true" } } } : {}),
          })),
        },
        "ЗначенияРеквизитов": { "ЗначениеРеквизита": [{ "Наименование": "Статус заказа", "Значение": o.status }, { "Наименование": "Статус оплаты", "Значение": o.payment_status }] },
      };
    };
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build({ "КоммерческаяИнформация": { "@_ВерсияСхемы": "2.08", "@_ДатаФормирования": until.slice(0, 19), "Документ": orders.map(doc) } })}`;
    return { xml, count: orders.length, until };
  });
}

/** 1C confirmed the export: the next query starts after it. */
export async function markOrdersExported(ctx: ServiceContext, until: string): Promise<void> {
  await ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const key = { source: "cursor:1c", external_id: "orders" };
    const current = (await tx.find("integration_records", key))[0];
    const at = new Date().toISOString();
    if (current) await tx.update("integration_records", current.id, { data: { ...current.data, exported_until: until }, updated_at: at });
    else await tx.insert("integration_records", { id: newId(), organization_id: ctx.actor.organization_id, ...key, entity_type: null, entity_id: null, data: { exported_until: until }, created_at: at, updated_at: at });
  });
}

export type OnecDocumentUpdate = { number: string; posted: boolean; paidOn: string | null; amount: number; cancelled: boolean };

/** Documents 1C sends back (orders with their requisites). */
export function parseOrderUpdates(xml: string): OnecDocumentUpdate[] {
  const root = (parser.parse(xml) as Node)["КоммерческаяИнформация"] as Node | undefined;
  return list(root?.["Документ"]).map((d) => {
    const req = new Map(list((d["ЗначенияРеквизитов"] as Node | undefined)?.["ЗначениеРеквизита"]).map((r) => [text(r["Наименование"]).toLowerCase(), text(r["Значение"])]));
    const yes = (v: string | undefined) => v === "true" || v === "1" || v?.toLowerCase() === "да";
    const paid = req.get("дата оплаты по 1с") || req.get("дата оплаты") || "";
    return { number: text(d["Номер"]), posted: yes(req.get("проведен")), paidOn: paid && !paid.startsWith("T") ? paid : null, amount: num(d["Сумма"]), cancelled: yes(req.get("отменен")) };
  });
}

/** Applies 1C's documents: posted orders become confirmed; a payment date records the outstanding amount once. */
export async function applyOrderUpdates(ctx: ServiceContext, updates: OnecDocumentUpdate[]): Promise<{ confirmed: number; paid: number }> {
  let confirmed = 0;
  let paid = 0;
  for (const u of updates) {
    const order = await ctx.db.read(ctx.actor.organization_id, async (tx) => (await tx.find("orders", { order_number: u.number }))[0] ?? null);
    if (!order) continue;
    if (u.posted && order.status === "draft") {
      await ctx.db.write(ctx.actor.organization_id, async (tx) => {
        await tx.update("orders", order.id, { status: "confirmed", updated_at: new Date().toISOString() });
        await emit(tx, ctx, { type: "order.status_changed", payload: { order_id: order.id, from: "draft", to: "confirmed" } });
      });
      confirmed++;
    }
    if (u.paidOn && order.status !== "cancelled") {
      const outstanding = await ctx.db.read(ctx.actor.organization_id, async (tx) => order.total - (await tx.find("payments", { order_id: order.id })).reduce((s, p) => s + p.amount, 0));
      if (outstanding > 0.004 && (await recordOnlinePayment(ctx, { provider: "1c", externalId: `${order.order_number}:${u.paidOn}`, orderId: order.id, amount: Math.round(outstanding * 100) / 100, currency: order.currency }))) paid++;
    }
  }
  return { confirmed, paid };
}
