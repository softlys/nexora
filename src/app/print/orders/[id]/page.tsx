import { notFound } from "next/navigation";
import { countryName } from "@/lib/countries";
import { requireUser } from "@/server/auth";
import { loadPage } from "@/server/page-data";
import { getOrder } from "@/server/services/orders";
import { PrintButton } from "./print-button";

export const metadata = { title: "Document" };

const TEXT = {
  ru: {
    invoice: "Счёт на оплату",
    quote: "Коммерческое предложение",
    from: "Поставщик",
    to: "Покупатель",
    date: "Дата",
    due: "Оплатить до",
    validity: "Предложение действительно 14 дней с даты документа.",
    item: "Наименование",
    qty: "Кол-во",
    price: "Цена",
    discount: "Скидка",
    tax: "НДС",
    sum: "Сумма",
    subtotal: "Итого без скидок",
    discounts: "Скидки",
    taxes: "НДС",
    total: "Всего к оплате",
    paid: "Оплачено",
    outstanding: "Остаток к оплате",
    notes: "Примечания",
    sign: "Руководитель ________________   Бухгалтер ________________",
  },
  en: {
    invoice: "Invoice",
    quote: "Quote",
    from: "From",
    to: "Bill to",
    date: "Date",
    due: "Due",
    validity: "This quote is valid for 14 days from its date.",
    item: "Item",
    qty: "Qty",
    price: "Unit price",
    discount: "Discount",
    tax: "Tax",
    sum: "Amount",
    subtotal: "Subtotal",
    discounts: "Discounts",
    taxes: "Tax",
    total: "Total",
    paid: "Paid",
    outstanding: "Balance due",
    notes: "Notes",
    sign: "Authorized signature ________________",
  },
} as const;

/**
 * Printable invoice or quote for an order: open it and print or "Save as PDF" in the browser, which
 * renders Cyrillic and every other script correctly. Seller details come from NEXORA_SELLER_DETAILS
 * (one line per row, for example legal name, tax id, address, bank account).
 */
export default async function PrintOrderPage({ params, searchParams }: PageProps<"/print/orders/[id]">) {
  await requireUser();
  const { id } = await params;
  const q = await searchParams;
  const doc = q.doc === "quote" ? "quote" : "invoice";
  const lang = q.lang === "en" ? "en" : "ru";
  const t = TEXT[lang];
  const data = await loadPage(async (ctx) => {
    const order = await getOrder(ctx, id);
    const org = await ctx.db.read(ctx.actor.organization_id, (tx) => tx.get("organizations", ctx.actor.organization_id));
    return { ...order, orgName: org?.name ?? "" };
  });
  if (!data) notFound();
  const { order, items, company, collected, outstanding } = data;
  const locale = lang === "ru" ? "ru-RU" : "en-US";
  const money = (v: number) => new Intl.NumberFormat(locale, { style: "currency", currency: order.currency, minimumFractionDigits: 2 }).format(v);
  const date = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString(locale) : "—");
  const seller = (process.env.NEXORA_SELLER_DETAILS ?? "").split(/\\n|\n/).map((l) => l.trim()).filter(Boolean);

  return (
    <main className="mx-auto max-w-3xl bg-white p-8 text-[13px] leading-relaxed text-black print:p-0">
      <style>{"@page { size: A4; margin: 16mm } body { background: #fff !important }"}</style>
      <div className="mb-6 flex items-center justify-end gap-2 print:hidden">
        <PrintButton />
      </div>
      <header className="flex items-start justify-between gap-6 border-b border-neutral-300 pb-4">
        <div>
          <h1 className="text-2xl font-semibold">
            {doc === "invoice" ? t.invoice : t.quote} № {order.order_number}
          </h1>
          <p className="mt-1 text-neutral-600">
            {t.date}: {date(order.order_date)}
            {doc === "invoice" && order.payment_due_date ? ` · ${t.due}: ${date(order.payment_due_date)}` : ""}
          </p>
        </div>
        <div className="text-right font-semibold">{data.orgName}</div>
      </header>
      <section className="grid grid-cols-2 gap-6 py-4">
        <div>
          <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">{t.from}</h2>
          <p className="font-medium">{data.orgName}</p>
          {seller.map((l) => (
            <p key={l}>{l}</p>
          ))}
        </div>
        <div>
          <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">{t.to}</h2>
          {company && (
            <>
              <p className="font-medium">{company.name}</p>
              {company.address && <p>{company.address}</p>}
              <p>{[company.city, countryName(company.country)].filter(Boolean).join(", ")}</p>
              {company.phone && <p>{company.phone}</p>}
            </>
          )}
        </div>
      </section>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-y border-neutral-400 text-left text-xs text-neutral-600">
            <th className="py-2 pr-2">#</th>
            <th className="py-2 pr-2">{t.item}</th>
            <th className="py-2 pr-2 text-right">{t.qty}</th>
            <th className="py-2 pr-2 text-right">{t.price}</th>
            <th className="py-2 pr-2 text-right">{t.discount}</th>
            <th className="py-2 pr-2 text-right">{t.tax}</th>
            <th className="py-2 text-right">{t.sum}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={it.id} className="border-b border-neutral-200 align-top">
              <td className="py-1.5 pr-2">{i + 1}</td>
              <td className="py-1.5 pr-2">{it.description}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{it.quantity}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{money(it.unit_price)}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{it.discount_pct ? `${it.discount_pct}%` : "—"}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{it.tax_rate ? `${it.tax_rate}%` : "—"}</td>
              <td className="py-1.5 text-right tabular-nums">{money(it.line_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="ml-auto mt-4 w-72 space-y-1">
        {[
          [t.subtotal, money(order.subtotal)],
          ...(order.discount_total ? [[t.discounts, `−${money(order.discount_total)}`]] : []),
          ...(order.tax_total ? [[t.taxes, money(order.tax_total)]] : []),
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between">
            <dt>{k}</dt>
            <dd className="tabular-nums">{v}</dd>
          </div>
        ))}
        <div className="flex justify-between border-t border-neutral-400 pt-1 text-base font-semibold">
          <dt>{t.total}</dt>
          <dd className="tabular-nums">{money(order.total)}</dd>
        </div>
        {doc === "invoice" && collected > 0 && (
          <>
            <div className="flex justify-between">
              <dt>{t.paid}</dt>
              <dd className="tabular-nums">{money(collected)}</dd>
            </div>
            <div className="flex justify-between font-semibold">
              <dt>{t.outstanding}</dt>
              <dd className="tabular-nums">{money(outstanding)}</dd>
            </div>
          </>
        )}
      </dl>
      {doc === "quote" && <p className="mt-6 text-neutral-700">{t.validity}</p>}
      {order.notes && (
        <section className="mt-6">
          <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">{t.notes}</h2>
          <p className="whitespace-pre-wrap">{order.notes}</p>
        </section>
      )}
      <p className="mt-12 text-neutral-700">{t.sign}</p>
    </main>
  );
}
