import { notFound } from "next/navigation";
import { countryName } from "@/lib/countries";
import { requireUser } from "@/server/auth";
import { loadPage } from "@/server/page-data";
import { getOrder } from "@/server/services/orders";
import { getRequisites } from "@/server/services/requisites";
import { PrintDocument } from "../../document";

export const metadata = { title: "Document" };

/**
 * Printable invoice or quote for an order. Seller details come from Settings → Requisites (or the
 * NEXORA_SELLER_DETAILS lines), the buyer's ИНН/КПП from the company's custom fields inn/kpp.
 */
export default async function PrintOrderPage({ params, searchParams }: PageProps<"/print/orders/[id]">) {
  await requireUser();
  const { id } = await params;
  const q = await searchParams;
  const data = await loadPage(async (ctx) => {
    const order = await getOrder(ctx, id);
    const org = await ctx.db.read(ctx.actor.organization_id, (tx) => tx.get("organizations", ctx.actor.organization_id));
    return { ...order, orgName: org?.name ?? "", requisites: await getRequisites(ctx) };
  });
  if (!data) notFound();
  const { order, items, company, collected, outstanding } = data;
  const custom = (company?.custom ?? {}) as Record<string, unknown>;
  return (
    <PrintDocument
      doc={q.doc === "quote" ? "quote" : "invoice"}
      lang={q.lang === "en" ? "en" : "ru"}
      number={order.order_number}
      date={order.order_date}
      due={order.payment_due_date}
      currency={order.currency}
      orgName={data.orgName}
      requisites={data.requisites}
      sellerLines={(process.env.NEXORA_SELLER_DETAILS ?? "").split(/\\n|\n/).map((l) => l.trim()).filter(Boolean)}
      buyer={company ? { name: company.name, inn: custom.inn ? String(custom.inn) : undefined, kpp: custom.kpp ? String(custom.kpp) : undefined, address: [company.address, company.city, countryName(company.country)].filter(Boolean).join(", "), phone: company.phone } : null}
      lines={items.map((i) => ({ description: i.description, quantity: Number(i.quantity), unit_price: Number(i.unit_price), discount_pct: Number(i.discount_pct), tax_rate: Number(i.tax_rate), line_total: Number(i.line_total) }))}
      totals={order}
      collected={collected}
      outstanding={outstanding}
      notes={order.notes}
    />
  );
}
