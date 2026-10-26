import Link from "next/link";
import { ActivityComposer, CommentComposer } from "@/components/crm/composers";
import { DetailHeader, Facts, Panel } from "@/components/crm/detail";
import { OrderStatusActions, RecordPaymentButton } from "@/components/crm/order-controls";
import { OrderFormButton } from "@/components/crm/order-form";
import { OrderDocuments } from "@/components/crm/order-documents";
import { RecordActions } from "@/components/crm/record-actions";
import { paymentsConfig } from "@/server/integrations/payments";
import { Timeline } from "@/components/crm/timeline";
import { humanizeStatus, StatusBadge } from "@/components/patterns/status-badge";
import { can } from "@/domain/permissions";
import { isEditable } from "@/domain/rules/orders";
import { formatAmount, formatDate } from "@/lib/format";
import { requirePermission } from "@/server/guards";
import { loadPage, peopleFor, recordTitle } from "@/server/page-data";
import { companyOptions } from "@/server/services/companies";
import { getOrder, productOptions } from "@/server/services/orders";
import { tr, trNode } from "@/lib/i18n";

export async function generateMetadata({ params }: PageProps<"/orders/[id]">) {
  const { id } = await params;
  return { title: (await recordTitle("orders", id)) ?? tr("Order") };
}

export default async function OrderPage({ params }: PageProps<"/orders/[id]">) {
  const { user } = await requirePermission("view", "order");
  const { id } = await params;
  const { data, people, companies, products } = await loadPage(async (ctx) => ({
    data: await getOrder(ctx, id),
    people: await peopleFor(ctx, "order"),
    companies: (await companyOptions(ctx)).map((c) => ({ value: c.id, label: c.name })),
    products: await productOptions(ctx),
  }));
  const { order, items, payments, collected, outstanding, company, deal, timeline } = data;
  const record = { organization_id: order.organization_id, owner_id: order.owner_id };
  const canEdit = can(user.actor, "update", "order", record) && !order.archived_at;
  const canPay = can(user.actor, "create", "payment", record) && !order.archived_at && order.status !== "draft" && order.status !== "cancelled";

  return (
    <div className="space-y-6">
      <DetailHeader
        back={{ href: "/orders", label: tr("Orders") }}
        path={`/orders/${order.id}`}
        title={order.order_number}
        subtitle={company ? <Link href={`/companies/${company.id}`} className="hover:text-foreground hover:underline">{company.name}</Link> : undefined}
        badges={
          <>
            <StatusBadge status={order.status} />
            <StatusBadge status={order.payment_status} dot />
            {order.archived_at && <StatusBadge status="archived" />}
          </>
        }
        actions={
          <RecordActions
            table="orders"
            id={order.id}
            label={tr("Order")}
            archived={!!order.archived_at}
            canArchive={can(user.actor, "archive", "order", record)}
            canDelete={can(user.actor, "delete", "order", record)}
            listPath="/orders"
          >
            {canEdit && <OrderStatusActions orderId={order.id} status={order.status} />}
            {canPay && <RecordPaymentButton orderId={order.id} outstanding={outstanding} currency={order.currency} />}
            {canEdit && isEditable(order.status) && <OrderFormButton order={order} items={items} companies={companies} products={products} owners={people.assignable} currency={order.currency} />}
          </RecordActions>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-6 lg:col-span-2">
          <Panel title={tr("Line items")}>
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="text-xs text-text-muted">
                  <tr className="border-b border-border">
                    <th className="py-1.5 text-left font-medium">{tr("Item")}</th>
                    <th className="py-1.5 text-right font-medium">{tr("Qty")}</th>
                    <th className="py-1.5 text-right font-medium">{tr("Unit price")}</th>
                    <th className="py-1.5 text-right font-medium">{tr("Disc.")}</th>
                    <th className="py-1.5 text-right font-medium">{tr("Tax")}</th>
                    <th className="py-1.5 text-right font-medium">{tr("Total")}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.id} className="border-b border-border last:border-0">
                      <td className="py-2">{trNode(i.description)}</td>
                      <td className="py-2 text-right tabular-nums">{i.quantity}</td>
                      <td className="py-2 text-right tabular-nums">{formatAmount(i.unit_price, order.currency)}</td>
                      <td className="py-2 text-right tabular-nums">{i.discount_pct}%</td>
                      <td className="py-2 text-right tabular-nums">{i.tax_rate}%</td>
                      <td className="py-2 text-right tabular-nums">{formatAmount(i.line_total, order.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="mt-4 ml-auto w-full max-w-xs space-y-1 text-sm">
              {[
                [tr("Subtotal"), order.subtotal],
                [tr("Discount"), -order.discount_total],
                [tr("Tax"), order.tax_total],
              ].map(([label, value]) => (
                <div key={label as string} className="flex justify-between text-text-subtle">
                  <dt>{trNode(label)}</dt>
                  <dd className="tabular-nums">{formatAmount(value as number, order.currency)}</dd>
                </div>
              ))}
              <div className="flex justify-between border-t border-border pt-1 font-semibold">
                <dt>{tr("Total")}</dt>
                <dd className="tabular-nums">{formatAmount(order.total, order.currency)}</dd>
              </div>
            </dl>
          </Panel>
          <Panel title={tr("Documents and online payment")}>
            <OrderDocuments
              orderId={order.id}
              canPay={Boolean(canPay) && outstanding > 0}
              providers={[...(paymentsConfig().yookassa ? [{ id: "yookassa" as const, label: "ЮKassa" }] : []), ...(paymentsConfig().stripe ? [{ id: "stripe" as const, label: tr("Stripe") }] : [])]}
            />
          </Panel>
          <Panel title={tr("Payments")}>
            {payments.length === 0 ? (
              <p className="text-sm text-text-muted">{tr("No payments recorded.")}</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      {formatDate(p.paid_at)} · {humanizeStatus(p.method)}
                      {p.reference && <span className="text-text-muted"> · {p.reference}</span>}
                    </span>
                    <span className="flex items-center gap-2">
                      {p.is_simulated ? <StatusBadge status="simulated" label={tr("Simulated")} /> : <StatusBadge status="paid" label={tr("Online")} />}
                      <span className="font-medium tabular-nums">{formatAmount(p.amount, p.currency)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex justify-between border-t border-border pt-3 text-sm">
              <span className="text-text-muted">{tr("Collected")} {formatAmount(collected, order.currency)}</span>
              <span className="font-medium">{tr("Outstanding")} {formatAmount(outstanding, order.currency)}</span>
            </div>
          </Panel>
          {!order.archived_at && <ActivityComposer links={{ order_id: order.id, company_id: order.company_id }} />}
          <Panel title={tr("Timeline")}>
            <Timeline entries={timeline} names={people.names} />
          </Panel>
          <Panel title={tr("Comments")}>
            <CommentComposer entityType="order" entityId={order.id} />
          </Panel>
        </div>
        <Panel title={tr("Details")}>
          <Facts
            className="sm:grid-cols-1"
            items={[
              [tr("Order date"), formatDate(order.order_date)],
              [tr("Payment due"), formatDate(order.payment_due_date)],
              [tr("Expected delivery"), formatDate(order.expected_delivery_date)],
              [tr("Delivered"), order.delivered_at ? formatDate(order.delivered_at) : null],
              [tr("Fulfillment"), humanizeStatus(order.fulfillment_status)],
              [tr("Owner"), people.names[order.owner_id]],
              [tr("Source deal"), deal ? <Link key="d" href={`/deals/${deal.id}`} className="text-brand hover:underline">{deal.name}</Link> : null],
            ]}
          />
          {order.notes && <p className="mt-4 border-t border-border pt-3 text-sm whitespace-pre-wrap">{order.notes}</p>}
        </Panel>
      </div>
    </div>
  );
}
