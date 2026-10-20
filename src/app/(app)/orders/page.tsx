import { Package } from "lucide-react";
import Link from "next/link";
import { OrderFormButton } from "@/components/crm/order-form";
import { ListTable } from "@/components/list/list-table";
import { ListToolbar } from "@/components/list/list-toolbar";
import { EmptyState } from "@/components/patterns/empty-state";
import { PageHeader } from "@/components/patterns/page-header";
import { humanizeStatus, StatusBadge } from "@/components/patterns/status-badge";
import { ORDER_STATUSES, PAYMENT_STATUSES } from "@/domain/entities";
import { enumFilter, parseListQuery, stringFilter, first } from "@/domain/list";
import { formatAmount, formatDate } from "@/lib/format";
import { requirePermission } from "@/server/guards";
import { loadPage, peopleFor, permissionsFor } from "@/server/page-data";
import { companyOptions } from "@/server/services/companies";
import { listOrders, productOptions } from "@/server/services/orders";

export const metadata = { title: "Orders" };

export default async function OrdersPage({ searchParams }: PageProps<"/orders">) {
  await requirePermission("view", "order");
  const params = await searchParams;
  const query = parseListQuery(params);
  const filters = {
    status: enumFilter(params, "status", ORDER_STATUSES),
    payment: enumFilter(params, "payment", PAYMENT_STATUSES),
    owner: stringFilter(params, "owner", 36),
    company: stringFilter(params, "company", 36),
    receivable: first(params.receivable) === "1" || undefined,
  };
  const { page, people, perms, companies, products, currency } = await loadPage(async (ctx) => ({
    page: await listOrders(ctx, query, filters),
    people: await peopleFor(ctx, "order"),
    perms: permissionsFor(ctx, "order"),
    companies: (await companyOptions(ctx)).map((c) => ({ value: c.id, label: c.name })),
    products: await productOptions(ctx),
    currency: (await ctx.db.read(ctx.actor.organization_id, (tx) => tx.get("organizations", ctx.actor.organization_id)))?.currency ?? "USD",
  }));
  const filtered = Boolean(query.q || Object.values(filters).some(Boolean) || query.archived === "1");
  const form = <OrderFormButton companies={companies} products={products} owners={people.assignable} currency={currency} />;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Orders"
        description="Orders with line items, simulated payments and fulfillment."
        actions={perms.canCreate && <OrderFormButton companies={companies} products={products} owners={people.assignable} currency={currency} autoOpen={first(params.new) === "1"} />}
      />
      <ListToolbar
        searchPlaceholder="Search order number or company…"
        filters={[
          { key: "status", label: "Statuses", options: ORDER_STATUSES.map((s) => ({ value: s, label: humanizeStatus(s) })) },
          { key: "payment", label: "Payment", options: PAYMENT_STATUSES.map((s) => ({ value: s, label: humanizeStatus(s) })) },
          { key: "company", label: "Companies", options: companies },
          ...(people.assignable.length > 1 ? [{ key: "owner", label: "Owners", options: people.assignable }] : []),
        ]}
      />
      <ListTable
        caption="Orders"
        basePath="/orders"
        params={params}
        {...page}
        rowKey={(o) => o.id}
        rowHref={(o) => `/orders/${o.id}`}
        columns={[
          {
            id: "number",
            header: "Order",
            sort: "number",
            cell: (o) => (
              <div className="min-w-0">
                <Link href={`/orders/${o.id}`} className="font-medium tabular-nums hover:underline">
                  {o.order_number}
                </Link>
                <div className="truncate text-xs text-text-muted">{o.company_name}</div>
              </div>
            ),
          },
          { id: "status", header: "Status", sort: "status", cell: (o) => <StatusBadge status={o.status} /> },
          { id: "payment", header: "Payment", cell: (o) => <StatusBadge status={o.payment_status} dot /> },
          { id: "total", header: "Total", sort: "total", align: "right", cell: (o) => formatAmount(o.total, o.currency) },
          { id: "collected", header: "Collected", align: "right", hideBelow: "lg", cell: (o) => <span className="text-text-subtle">{formatAmount(o.collected, o.currency)}</span> },
          { id: "date", header: "Order date", sort: "date", hideBelow: "md", cell: (o) => <span className="text-text-subtle">{formatDate(o.order_date)}</span> },
          { id: "due", header: "Due", sort: "due", hideBelow: "lg", cell: (o) => <span className="text-text-subtle">{formatDate(o.payment_due_date)}</span> },
          { id: "owner", header: "Owner", hideBelow: "xl", cell: (o) => <span className="text-text-subtle">{o.owner_name}</span> },
        ]}
        empty={
          <EmptyState
            icon={Package}
            title={filtered ? "No orders match these filters" : "No orders yet"}
            description={filtered ? "Try a different search or clear the filters." : "Create an order, or convert a won deal into one."}
            action={!filtered && perms.canCreate ? form : undefined}
            className="m-4 border-0 bg-transparent"
          />
        }
      />
    </div>
  );
}
