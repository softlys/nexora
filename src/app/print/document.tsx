import type { Requisites } from "@/domain/entities";
import { rublesInWords } from "@/domain/amount-in-words";
import { PrintButton } from "./orders/[id]/print-button";

const TEXT = {
  ru: {
    invoice: "Счёт на оплату",
    quote: "Коммерческое предложение",
    from: "Поставщик",
    to: "Покупатель",
    date: "от",
    due: "Оплатить до",
    validity: "Предложение действительно 14 дней с даты документа.",
    item: "Товары (работы, услуги)",
    qty: "Кол-во",
    price: "Цена",
    discount: "Скидка",
    tax: "НДС",
    sum: "Сумма",
    subtotal: "Итого без скидок",
    discounts: "Скидки",
    taxes: "В том числе НДС",
    total: "Всего к оплате",
    paid: "Оплачено",
    outstanding: "Остаток к оплате",
    notes: "Примечания",
    director: "Руководитель",
    accountant: "Бухгалтер",
    bank: "Банк получателя",
    bik: "БИК",
    account: "Сч. №",
    recipient: "Получатель",
    summary: (n: number, total: string) => `Всего наименований ${n}, на сумму ${total}`,
  },
  en: {
    invoice: "Invoice",
    quote: "Quote",
    from: "From",
    to: "Bill to",
    date: "dated",
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
    director: "Director",
    accountant: "Accountant",
    bank: "Recipient's bank",
    bik: "BIC",
    account: "Account",
    recipient: "Recipient",
    summary: (n: number, total: string) => `${n} items, total ${total}`,
  },
} as const;

export type PrintLine = { description: string; quantity: number; unit_price: number; discount_pct: number; tax_rate: number; line_total: number };
export type PrintDocumentProps = {
  doc: "invoice" | "quote";
  lang: "ru" | "en";
  number: string;
  date: string;
  due: string | null;
  currency: string;
  orgName: string;
  requisites: Requisites;
  /** Extra seller lines from NEXORA_SELLER_DETAILS (used when requisites are empty). */
  sellerLines: string[];
  buyer: { name: string; inn?: string; kpp?: string; address?: string; phone?: string | null } | null;
  lines: PrintLine[];
  totals: { subtotal: number; discount_total: number; tax_total: number; total: number };
  collected?: number;
  outstanding?: number;
  notes?: string;
};

/**
 * A printable invoice or quote (open it and print or "Save as PDF"). With requisites filled in, the
 * Russian invoice has the bank block, the amount in words, the signatures and the stamp.
 */
export function PrintDocument(p: PrintDocumentProps) {
  const t = TEXT[p.lang];
  const r = p.requisites;
  const locale = p.lang === "ru" ? "ru-RU" : "en-US";
  const money = (v: number) => new Intl.NumberFormat(locale, { style: "currency", currency: p.currency, minimumFractionDigits: 2 }).format(v);
  const date = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString(locale) : "—");
  const sellerName = r.legal_name || p.orgName;
  const sellerLine = [sellerName, r.inn && `ИНН ${r.inn}`, r.kpp && `КПП ${r.kpp}`, r.address].filter(Boolean).join(", ");
  const buyerLine = p.buyer ? [p.buyer.name, p.buyer.inn && `ИНН ${p.buyer.inn}`, p.buyer.kpp && `КПП ${p.buyer.kpp}`, p.buyer.address].filter(Boolean).join(", ") : "";
  const bankBlock = p.lang === "ru" && p.doc === "invoice" && r.bik && r.account;

  return (
    <main className="mx-auto max-w-3xl bg-white p-8 text-[13px] leading-relaxed text-black print:p-0">
      <style>{"@page { size: A4; margin: 14mm } body { background: #fff !important }"}</style>
      <div className="mb-6 flex items-center justify-end gap-2 print:hidden">
        <PrintButton />
      </div>
      {bankBlock && (
        <table className="mb-5 w-full border-collapse border border-black text-[12px]" data-testid="bank-block">
          <tbody>
            <tr>
              <td colSpan={2} rowSpan={2} className="border border-black p-1 align-top">
                {r.bank_name}
                <div className="text-[10px]">{t.bank}</div>
              </td>
              <td className="w-16 border border-black p-1">{t.bik}</td>
              <td className="border-x border-black p-1">{r.bik}</td>
            </tr>
            <tr>
              <td className="border border-black p-1">{t.account}</td>
              <td className="border-x border-black p-1">{r.corr_account}</td>
            </tr>
            <tr>
              <td className="border border-black p-1">ИНН {r.inn}</td>
              <td className="border border-black p-1">КПП {r.kpp}</td>
              <td rowSpan={2} className="border border-black p-1 align-top">
                {t.account}
              </td>
              <td rowSpan={2} className="border border-black p-1 align-top">
                {r.account}
              </td>
            </tr>
            <tr>
              <td colSpan={2} className="border border-black p-1">
                {sellerName}
                <div className="text-[10px]">{t.recipient}</div>
              </td>
            </tr>
          </tbody>
        </table>
      )}
      <header className="border-b-2 border-black pb-2">
        <h1 className="text-xl font-bold">
          {p.doc === "invoice" ? t.invoice : t.quote} № {p.number} {t.date} {date(p.date)}
        </h1>
        {p.doc === "invoice" && p.due && (
          <p className="text-neutral-700">
            {t.due}: {date(p.due)}
          </p>
        )}
      </header>
      <section className="space-y-1 py-3">
        <p>
          <span className="inline-block w-28 text-neutral-600">{t.from}:</span>
          <span className="font-medium">{sellerLine}</span>
        </p>
        {!r.legal_name && p.sellerLines.length > 0 && <p className="pl-28 text-neutral-700">{p.sellerLines.join(", ")}</p>}
        {p.buyer && (
          <p>
            <span className="inline-block w-28 text-neutral-600">{t.to}:</span>
            <span className="font-medium">{buyerLine}</span>
          </p>
        )}
      </section>
      <table className="w-full border-collapse border border-black">
        <thead>
          <tr className="text-left text-xs">
            <th className="border border-black p-1">№</th>
            <th className="border border-black p-1">{t.item}</th>
            <th className="border border-black p-1 text-right">{t.qty}</th>
            <th className="border border-black p-1 text-right">{t.price}</th>
            <th className="border border-black p-1 text-right">{t.discount}</th>
            <th className="border border-black p-1 text-right">{t.tax}</th>
            <th className="border border-black p-1 text-right">{t.sum}</th>
          </tr>
        </thead>
        <tbody>
          {p.lines.map((it, i) => (
            <tr key={i} className="align-top">
              <td className="border border-black p-1">{i + 1}</td>
              <td className="border border-black p-1">{it.description}</td>
              <td className="border border-black p-1 text-right tabular-nums">{it.quantity}</td>
              <td className="border border-black p-1 text-right tabular-nums">{money(it.unit_price)}</td>
              <td className="border border-black p-1 text-right tabular-nums">{it.discount_pct ? `${it.discount_pct}%` : "—"}</td>
              <td className="border border-black p-1 text-right tabular-nums">{it.tax_rate ? `${it.tax_rate}%` : "—"}</td>
              <td className="border border-black p-1 text-right tabular-nums">{money(it.line_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="mt-3 ml-auto w-80 space-y-0.5">
        {p.totals.discount_total > 0 && (
          <>
            <div className="flex justify-between">
              <dt>{t.subtotal}</dt>
              <dd className="tabular-nums">{money(p.totals.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>{t.discounts}</dt>
              <dd className="tabular-nums">−{money(p.totals.discount_total)}</dd>
            </div>
          </>
        )}
        <div className="flex justify-between">
          <dt>{t.taxes}</dt>
          <dd className="tabular-nums">{p.totals.tax_total ? money(p.totals.tax_total) : r.vat_note || "—"}</dd>
        </div>
        <div className="flex justify-between text-base font-bold">
          <dt>{t.total}</dt>
          <dd className="tabular-nums">{money(p.totals.total)}</dd>
        </div>
        {p.doc === "invoice" && (p.collected ?? 0) > 0 && (
          <>
            <div className="flex justify-between">
              <dt>{t.paid}</dt>
              <dd className="tabular-nums">{money(p.collected!)}</dd>
            </div>
            <div className="flex justify-between font-semibold">
              <dt>{t.outstanding}</dt>
              <dd className="tabular-nums">{money(p.outstanding ?? 0)}</dd>
            </div>
          </>
        )}
      </dl>
      <p className="mt-3">{t.summary(p.lines.length, money(p.totals.total))}</p>
      {p.lang === "ru" && p.currency === "RUB" && (
        <p className="font-bold" data-testid="amount-in-words">
          {rublesInWords(p.totals.total)}
        </p>
      )}
      {p.doc === "quote" && <p className="mt-4 text-neutral-700">{t.validity}</p>}
      {p.notes && (
        <section className="mt-4">
          <h2 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">{t.notes}</h2>
          <p className="whitespace-pre-wrap">{p.notes}</p>
        </section>
      )}
      <section className="relative mt-10 border-t-2 border-black pt-6" data-testid="signatures">
        <div className="grid grid-cols-2 gap-8">
          <div className="relative">
            <span>{t.director}</span>
            <span className="relative mx-2 inline-block w-36 border-b border-black align-bottom">
              {r.signature && (
                // eslint-disable-next-line @next/next/no-img-element -- a data: URL image, nothing for next/image to optimize
                <img src={r.signature} alt="" className="absolute bottom-0 left-2 h-14 max-w-32 object-contain" />
              )}
              &nbsp;
            </span>
            <span>{r.director}</span>
          </div>
          <div>
            <span>{t.accountant}</span>
            <span className="mx-2 inline-block w-36 border-b border-black align-bottom">&nbsp;</span>
            <span>{r.accountant}</span>
          </div>
        </div>
        {r.stamp && (
          // eslint-disable-next-line @next/next/no-img-element -- a data: URL image, nothing for next/image to optimize
          <img src={r.stamp} alt="" className="absolute top-0 left-24 h-36 w-36 object-contain opacity-90" data-testid="stamp" />
        )}
      </section>
    </main>
  );
}
