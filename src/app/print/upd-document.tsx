import { computeLineTotals } from "@/domain/orders/totals";
import { PrintButton } from "./orders/[id]/print-button";
import type { PrintDocumentProps } from "./document";

const OKV: Record<string, string> = { RUB: "Российский рубль, 643", USD: "Доллар США, 840", EUR: "Евро, 978", CNY: "Юань, 156", KZT: "Тенге, 398", BYN: "Белорусский рубль, 933" };

/**
 * Универсальный передаточный документ (УПД), status 1: an invoice (счёт-фактура) and a delivery
 * note in one, laid out after the recommended form. Seller details come from Settings → Requisites.
 */
export function UpdDocument(p: Omit<PrintDocumentProps, "doc" | "lang" | "due" | "collected" | "outstanding" | "notes">) {
  const r = p.requisites;
  const money = (v: number) => new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  const date = new Date(`${p.date.slice(0, 10)}T12:00:00Z`).toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" });
  const seller = r.legal_name || p.orgName;
  const innKpp = (inn?: string, kpp?: string) => [inn, kpp].filter(Boolean).join(" / ") || "—";
  const rows = p.lines.map((l) => {
    const t = computeLineTotals(l);
    return { ...l, net: t.subtotal - t.discount, tax: t.tax, total: t.total };
  });
  const sum = (k: "net" | "tax" | "total") => rows.reduce((a, x) => a + x[k], 0);
  const cell = "border border-black px-1 py-0.5";
  const field = (label: string, value: string, n: string) => (
    <div className="flex gap-2">
      <span className="w-56 shrink-0">{label}</span>
      <span className="flex-1 border-b border-black">{value}</span>
      <span className="w-8 text-right text-neutral-600">({n})</span>
    </div>
  );

  return (
    <main className="mx-auto max-w-[1100px] bg-white p-6 text-[11px] leading-snug text-black print:p-0">
      <style>{"@page { size: A4 landscape; margin: 10mm } body { background: #fff !important }"}</style>
      <div className="mb-4 flex justify-end print:hidden">
        <PrintButton />
      </div>
      <div className="flex gap-4">
        <div className="w-36 shrink-0 border-r-2 border-black pr-3">
          <p className="font-bold">Универсальный передаточный документ</p>
          <p className="mt-3">
            Статус: <span className="border border-black px-2 font-bold">1</span>
          </p>
          <p className="mt-2 text-[9px] text-neutral-700">1 — счёт-фактура и передаточный документ (акт)</p>
        </div>
        <div className="flex-1 space-y-0.5">
          <h1 className="text-[13px] font-bold">
            Счёт-фактура № {p.number} от {date} <span className="font-normal">(1)</span>
          </h1>
          <p>Исправление № — от — (1а)</p>
          {field("Продавец:", seller, "2")}
          {field("Адрес:", r.address || "—", "2а")}
          {field("ИНН/КПП продавца:", innKpp(r.inn, r.kpp), "2б")}
          {field("Грузоотправитель и его адрес:", "он же", "3")}
          {field("Грузополучатель и его адрес:", p.buyer ? [p.buyer.name, p.buyer.address].filter(Boolean).join(", ") : "—", "4")}
          {field("К платёжно-расчётному документу №", "— от —", "5")}
          {field("Документ об отгрузке:", `№ п/п 1–${rows.length} № ${p.number} от ${date}`, "5а")}
          {field("Покупатель:", p.buyer?.name ?? "—", "6")}
          {field("Адрес:", p.buyer?.address || "—", "6а")}
          {field("ИНН/КПП покупателя:", innKpp(p.buyer?.inn, p.buyer?.kpp), "6б")}
          {field("Валюта: наименование, код", OKV[p.currency] ?? p.currency, "7")}
        </div>
      </div>

      <table className="mt-3 w-full border-collapse text-[10px]" data-testid="upd-table">
        <thead className="text-center align-top">
          <tr>
            <th className={cell}>№ п/п</th>
            <th className={cell}>Наименование товара (описание выполненных работ, оказанных услуг)</th>
            <th className={cell}>Код вида товара</th>
            <th className={cell}>Ед. изм.</th>
            <th className={cell}>Количество (объём)</th>
            <th className={cell}>Цена (тариф) за единицу</th>
            <th className={cell}>Стоимость без налога — всего</th>
            <th className={cell}>В том числе сумма акциза</th>
            <th className={cell}>Налоговая ставка</th>
            <th className={cell}>Сумма налога</th>
            <th className={cell}>Стоимость с налогом — всего</th>
          </tr>
          <tr className="text-[9px]">
            {["А", "1", "1а", "2", "3", "4", "5", "6", "7", "8", "9"].map((n) => (
              <th key={n} className={cell}>
                {n}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((l, i) => (
            <tr key={i}>
              <td className={`${cell} text-center`}>{i + 1}</td>
              <td className={cell}>{l.description}</td>
              <td className={`${cell} text-center`}>—</td>
              <td className={`${cell} text-center`}>шт</td>
              <td className={`${cell} text-right tabular-nums`}>{l.quantity}</td>
              <td className={`${cell} text-right tabular-nums`}>{money(l.unit_price * (1 - l.discount_pct / 100))}</td>
              <td className={`${cell} text-right tabular-nums`}>{money(l.net)}</td>
              <td className={`${cell} text-center`}>без акциза</td>
              <td className={`${cell} text-center`}>{l.tax_rate ? `${l.tax_rate}%` : "без НДС"}</td>
              <td className={`${cell} text-right tabular-nums`}>{l.tax_rate ? money(l.tax) : "без НДС"}</td>
              <td className={`${cell} text-right tabular-nums`}>{money(l.total)}</td>
            </tr>
          ))}
          <tr className="font-bold">
            <td className={cell} colSpan={6}>
              Всего к оплате
            </td>
            <td className={`${cell} text-right tabular-nums`}>{money(sum("net"))}</td>
            <td className={`${cell} text-center`} colSpan={2}>
              ×
            </td>
            <td className={`${cell} text-right tabular-nums`}>{sum("tax") ? money(sum("tax")) : "без НДС"}</td>
            <td className={`${cell} text-right tabular-nums`} data-testid="upd-total">
              {money(sum("total"))}
            </td>
          </tr>
        </tbody>
      </table>

      <div className="mt-4 grid grid-cols-2 gap-x-10 gap-y-3">
        <p>
          Руководитель организации: <span className="inline-block w-32 border-b border-black" /> {r.director || "________"}
        </p>
        <p>
          Главный бухгалтер: <span className="inline-block w-32 border-b border-black" /> {r.accountant || "________"}
        </p>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-10 border-t-2 border-black pt-3">
        <div className="space-y-2">
          <p>Основание передачи (сдачи) / получения (приёмки): Договор / заказ № {p.number} (8)</p>
          <p>
            Товар (груз) передал / услуги, результаты работ сдал: <span className="inline-block w-28 border-b border-black" /> {r.director || ""} (10)
          </p>
          <p>Дата отгрузки, передачи (сдачи): {date} (11)</p>
          <p>Ответственный за правильность оформления факта хозяйственной жизни: {r.director || "________"} (13)</p>
          <p>Наименование экономического субъекта — составителя документа: {[seller, r.inn && `ИНН/КПП ${innKpp(r.inn, r.kpp)}`].filter(Boolean).join(", ")} (14)</p>
          <div className="relative h-24">
            {r.stamp && (
              // eslint-disable-next-line @next/next/no-img-element -- a data: URL image, nothing for next/image to optimize
              <img src={r.stamp} alt="" className="absolute top-0 left-10 h-24 w-24 object-contain opacity-90" />
            )}
            <span className="absolute bottom-0 left-0">М.П.</span>
          </div>
        </div>
        <div className="space-y-2">
          <p>&nbsp;</p>
          <p>
            Товар (груз) получил / услуги, результаты работ принял: <span className="inline-block w-28 border-b border-black" /> (15)
          </p>
          <p>Дата получения (приёмки): «___» ____________ 20__ г. (16)</p>
          <p>Ответственный за правильность оформления факта хозяйственной жизни: ________ (18)</p>
          <p>Наименование экономического субъекта — составителя документа: {p.buyer ? [p.buyer.name, p.buyer.inn && `ИНН/КПП ${innKpp(p.buyer.inn, p.buyer.kpp)}`].filter(Boolean).join(", ") : "________"} (19)</p>
          <p className="pt-16">М.П.</p>
        </div>
      </div>
    </main>
  );
}
