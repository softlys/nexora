import { notFound } from "next/navigation";
import { countryName } from "@/lib/countries";
import { requireUser } from "@/server/auth";
import { loadPage } from "@/server/page-data";
import { getDeal } from "@/server/services/deals";
import { getRequisites } from "@/server/services/requisites";
import { PrintDocument } from "../../document";

export const metadata = { title: "Document" };

/** A quote (КП) or an invoice made straight from a deal's products, before any order exists. */
export default async function PrintDealPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const { id } = await params;
  const q = await searchParams;
  const data = await loadPage(async (ctx) => {
    const deal = await getDeal(ctx, id);
    const org = await ctx.db.read(ctx.actor.organization_id, (tx) => tx.get("organizations", ctx.actor.organization_id));
    return { ...deal, orgName: org?.name ?? "", requisites: await getRequisites(ctx) };
  });
  if (!data) notFound();
  const { deal, items, itemTotals, company } = data;
  const custom = (company?.custom ?? {}) as Record<string, unknown>;
  // Without product lines, the deal itself is the single line.
  const lines = items.length
    ? items.map((i) => ({ description: i.description, quantity: Number(i.quantity), unit_price: Number(i.unit_price), discount_pct: Number(i.discount_pct), tax_rate: Number(i.tax_rate), line_total: Number(i.line_total) }))
    : [{ description: deal.name, quantity: 1, unit_price: deal.amount, discount_pct: 0, tax_rate: 0, line_total: deal.amount }];
  const totals = items.length ? itemTotals : { subtotal: deal.amount, discount_total: 0, tax_total: 0, total: deal.amount };
  const doc = q.doc === "invoice" ? "invoice" : "quote";
  return (
    <PrintDocument
      doc={doc}
      lang={q.lang === "en" ? "en" : "ru"}
      number={`${doc === "invoice" ? "СЧ" : "КП"}-${deal.id.slice(0, 6).toUpperCase()}`}
      date={new Date().toISOString().slice(0, 10)}
      due={null}
      currency={deal.currency}
      orgName={data.orgName}
      requisites={data.requisites}
      sellerLines={(process.env.NEXORA_SELLER_DETAILS ?? "").split(/\\n|\n/).map((l) => l.trim()).filter(Boolean)}
      buyer={company ? { name: company.name, inn: custom.inn ? String(custom.inn) : undefined, kpp: custom.kpp ? String(custom.kpp) : undefined, address: [company.address, company.city, countryName(company.country)].filter(Boolean).join(", "), phone: company.phone } : null}
      lines={lines}
      totals={totals}
      notes={deal.notes}
    />
  );
}
