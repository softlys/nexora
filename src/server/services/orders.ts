import type { z } from "zod";
import type { Order, OrderItem, Payment } from "@/domain/entities";
import { diffFields } from "@/domain/diff";
import type { orderInput, orderStatusInput, orderUpdateInput, paymentInput } from "@/domain/inputs";
import { applyListQuery, type ListQuery } from "@/domain/list";
import { derivePaymentStatus } from "@/domain/orders/payment-status";
import { computeLineTotals, computeOrderTotals, roundMoney } from "@/domain/orders/totals";
import { applyStatusEffects, canTransition, isEditable } from "@/domain/rules/orders";
import { buildTimeline } from "@/domain/timeline";
import { UniqueViolation, type Tx } from "@/server/db/types";
import { DomainError } from "@/server/repositories/types";
import { emit, findVisible, trackRead, newId, nowOf, requireCan, resolveOwner, type ServiceContext } from "./context";
import { assertLinksVisible, byId, getOwned } from "./records";

const today = (ctx: ServiceContext) => nowOf(ctx).toISOString().slice(0, 10);

/** Payment status depends on the date, so it is re-derived whenever an order is read. */
function livePaymentStatus(ctx: ServiceContext, order: Order, payments: Payment[]): Order["payment_status"] {
  const collected = payments.filter((p) => p.order_id === order.id).reduce((s, p) => s + p.amount, 0);
  return derivePaymentStatus({ total: order.total, collected, status: order.status, payment_due_date: order.payment_due_date, today: today(ctx) });
}

export type OrderFilters = {
  status?: Order["status"];
  payment?: Order["payment_status"];
  owner?: string;
  company?: string;
  /** Drill-down from "Outstanding receivables": confirmed+ orders with money still owed. */
  receivable?: boolean;
};

export async function listOrders(ctx: ServiceContext, query: ListQuery, filters: OrderFilters) {
  return ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const [rows, companies, payments, profiles] = await Promise.all([
      findVisible(tx, ctx, "orders", "order", (r) => r.owner_id),
      tx.find("companies"),
      tx.find("payments"),
      tx.find("profiles"),
    ]);
    const companyById = byId(companies);
    const profileById = byId(profiles);
    const enriched = rows
      .filter((o) => (query.archived === "1" ? o.archived_at !== null : o.archived_at === null))
      .map((o) => {
        const collected = roundMoney(payments.filter((p) => p.order_id === o.id).reduce((s, p) => s + p.amount, 0));
        return {
          ...o,
          payment_status: livePaymentStatus(ctx, o, payments),
          collected,
          company_name: companyById.get(o.company_id)?.name ?? "Unknown company",
          owner_name: profileById.get(o.owner_id)?.full_name ?? "Unknown",
        };
      })
      .filter(
        (o) =>
          (!filters.status || o.status === filters.status) &&
          (!filters.payment || o.payment_status === filters.payment) &&
          (!filters.owner || o.owner_id === filters.owner) &&
          (!filters.company || o.company_id === filters.company) &&
          (!filters.receivable || (["confirmed", "processing", "shipped", "delivered"].includes(o.status) && o.total - o.collected > 0.005)),
      );
    const page = applyListQuery(enriched, query, {
      searchText: (o) => `${o.order_number} ${o.company_name} ${o.owner_name}`,
      sorters: {
        number: (o) => o.order_number,
        company: (o) => o.company_name.toLowerCase(),
        total: (o) => o.total,
        date: (o) => o.order_date,
        status: (o) => o.status,
        due: (o) => o.payment_due_date,
      },
      defaultSort: { key: "date", dir: "desc" },
    });
    trackRead(ctx, "order", page.rows.length);
    return page;
  });
}

export async function getOrder(ctx: ServiceContext, id: string) {
  return ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const order = await getOwned(tx, ctx, "orders", id);
    const [items, payments, company, deal, activities, tasks, comments] = await Promise.all([
      tx.find("order_items", { order_id: id }),
      tx.find("payments", { order_id: id }),
      tx.get("companies", order.company_id),
      order.source_deal_id ? tx.get("deals", order.source_deal_id) : Promise.resolve(null),
      tx.find("activities", { order_id: id }),
      findVisible(tx, ctx, "tasks", "task", (r) => r.assignee_id, { order_id: id }),
      tx.find("comments", { entity_type: "order", entity_id: id }),
    ]);
    const collected = roundMoney(payments.reduce((s, p) => s + p.amount, 0));
    return {
      order: { ...order, payment_status: livePaymentStatus(ctx, order, payments) },
      items: items.sort((a, b) => a.position - b.position),
      payments: payments.sort((a, b) => b.paid_at.localeCompare(a.paid_at)),
      collected,
      outstanding: roundMoney(Math.max(0, order.total - collected)),
      company,
      deal,
      tasks: tasks.filter((t) => !t.archived_at),
      timeline: buildTimeline({ activities, tasks: tasks.filter((t) => !t.archived_at), comments }),
    };
  });
}

function buildItems(ctx: ServiceContext, orderId: string, items: z.output<typeof orderInput>["items"], at: string): OrderItem[] {
  return items.map((item, position) => ({
    id: newId(),
    organization_id: ctx.actor.organization_id,
    order_id: orderId,
    product_id: item.product_id,
    description: item.description,
    quantity: item.quantity,
    unit_price: item.unit_price,
    discount_pct: item.discount_pct,
    tax_rate: item.tax_rate,
    line_total: computeLineTotals(item).total,
    position,
    created_at: at,
    updated_at: at,
  }));
}

async function assertProducts(tx: Tx, items: Array<{ product_id: string | null }>) {
  for (const item of items) {
    if (item.product_id && !(await tx.get("products", item.product_id))) throw new DomainError("Unknown product.", "not_found");
  }
}

async function generateOrderNumber(tx: Tx, date: string): Promise<string> {
  return tx.nextOrderNumber(Number(date.slice(0, 4)));
}

async function insertOrder(
  tx: Tx,
  ctx: ServiceContext,
  fields: { company_id: string; currency: string; order_date: string; expected_delivery_date: string | null; notes: string; owner_id: string; source_deal_id: string | null; status: Order["status"] },
  items: z.output<typeof orderInput>["items"],
): Promise<Order> {
  const at = nowOf(ctx).toISOString();
  const id = newId();
  const totals = computeOrderTotals(items);
  const base: Order = {
    id,
    organization_id: ctx.actor.organization_id,
    order_number: await generateOrderNumber(tx, fields.order_date),
    company_id: fields.company_id,
    source_deal_id: fields.source_deal_id,
    status: "draft",
    payment_status: "unpaid",
    fulfillment_status: "unfulfilled",
    currency: fields.currency,
    ...totals,
    order_date: fields.order_date,
    payment_due_date: null,
    expected_delivery_date: fields.expected_delivery_date,
    delivered_at: null,
    owner_id: fields.owner_id,
    notes: fields.notes,
    created_at: at,
    updated_at: at,
    archived_at: null,
  };
  const order: Order = fields.status === "draft" ? base : { ...base, status: fields.status, ...applyStatusEffects(base, fields.status, nowOf(ctx)) };
  order.payment_status = derivePaymentStatus({ total: order.total, collected: 0, status: order.status, payment_due_date: order.payment_due_date, today: today(ctx) });
  // Another user may take the same number between generating and inserting it (Supabase mode).
  for (let attempt = 0; ; attempt++) {
    try {
      await tx.insert("orders", order);
      break;
    } catch (error) {
      const numberClash = error instanceof UniqueViolation && /order_number/.test(error.constraint) && !/source_deal_id/.test(error.constraint);
      if (!numberClash || attempt >= 2) throw error;
      order.order_number = await generateOrderNumber(tx, fields.order_date);
    }
  }
  for (const item of buildItems(ctx, id, items, at)) await tx.insert("order_items", item);
  await emit(tx, ctx, { type: "record.created", payload: { entity: "order", id, after: { ...order, items: items.length } } });
  return order;
}

export async function createOrder(ctx: ServiceContext, input: z.output<typeof orderInput>): Promise<Order> {
  requireCan(ctx, "create", "order");
  return ctx.db.write(ctx.actor.organization_id, async (tx) => {
    await assertLinksVisible(tx, ctx, { company_id: input.company_id });
    await assertProducts(tx, input.items);
    const owner = (await resolveOwner(tx, ctx, "order", input.owner_id ?? ctx.actor.id, ctx.actor.id, null))!;
    return insertOrder(tx, ctx, { ...input, owner_id: owner, source_deal_id: null, status: "draft" }, input.items);
  });
}

export async function updateOrder(ctx: ServiceContext, input: z.output<typeof orderUpdateInput>): Promise<Order> {
  return ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const current = await getOwned(tx, ctx, "orders", input.id);
    requireCan(ctx, "update", "order", current.owner_id, current.id);
    if (!isEditable(current.status)) throw new DomainError(`A ${current.status} order can no longer be edited.`, "conflict");
    if (input.company_id !== current.company_id) await assertLinksVisible(tx, ctx, { company_id: input.company_id });
    await assertProducts(tx, input.items);
    const owner = (await resolveOwner(tx, ctx, "order", input.owner_id, current.owner_id, current.id))!;
    const payments = await tx.find("payments", { order_id: current.id });
    const totals = computeOrderTotals(input.items);
    const collected = payments.reduce((s, p) => s + p.amount, 0);
    if (roundMoney(collected) > totals.total) throw new DomainError("The new total is lower than the payments already recorded.");

    const at = nowOf(ctx).toISOString();
    for (const old of await tx.find("order_items", { order_id: current.id })) await tx.remove("order_items", old.id);
    for (const item of buildItems(ctx, current.id, input.items, at)) await tx.insert("order_items", item);

    const patch = {
      company_id: input.company_id,
      currency: input.currency,
      order_date: input.order_date,
      expected_delivery_date: input.expected_delivery_date,
      notes: input.notes,
      owner_id: owner,
      ...totals,
      payment_status: derivePaymentStatus({ total: totals.total, collected, status: current.status, payment_due_date: current.payment_due_date, today: today(ctx) }),
    };
    const changes = diffFields(current as unknown as Record<string, unknown>, patch);
    const updated = await tx.update("orders", current.id, { ...patch, updated_at: at });
    await emit(tx, ctx, { type: "record.updated", payload: { entity: "order", id: current.id, changes: { ...changes, items: { before: null, after: input.items.length } } } });
    if (changes.owner_id) await emit(tx, ctx, { type: "record.owner_changed", payload: { entity: "order", id: current.id, from: current.owner_id, to: owner } });
    return updated;
  });
}

/** Status changes follow ORDER_TRANSITIONS; anything else is refused on the server. */
export async function changeOrderStatus(ctx: ServiceContext, input: z.output<typeof orderStatusInput>): Promise<Order> {
  return ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const order = await getOwned(tx, ctx, "orders", input.id);
    requireCan(ctx, "update", "order", order.owner_id, order.id);
    if (order.status === input.status) return order;
    if (!canTransition(order.status, input.status)) {
      throw new DomainError(`An order cannot go from ${order.status} to ${input.status}.`, "conflict");
    }
    const effects = applyStatusEffects(order, input.status, nowOf(ctx));
    const payments = await tx.find("payments", { order_id: order.id });
    const collected = payments.reduce((s, p) => s + p.amount, 0);
    const next = { ...order, ...effects, status: input.status };
    const updated = await tx.update("orders", order.id, {
      ...effects,
      status: input.status,
      payment_status: derivePaymentStatus({ total: next.total, collected, status: next.status, payment_due_date: next.payment_due_date, today: today(ctx) }),
      updated_at: nowOf(ctx).toISOString(),
    });
    await emit(tx, ctx, { type: "order.status_changed", payload: { order_id: order.id, from: order.status, to: input.status } });
    return updated;
  });
}

/** Records a simulated payment. NEXORA never talks to a payment provider. */
export async function recordPayment(ctx: ServiceContext, input: z.output<typeof paymentInput>): Promise<Payment> {
  return ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const order = await getOwned(tx, ctx, "orders", input.order_id);
    requireCan(ctx, "create", "payment", order.owner_id, order.id);
    if (order.status === "draft" || order.status === "cancelled") throw new DomainError(`Payments cannot be recorded on a ${order.status} order.`);
    const payments = await tx.find("payments", { order_id: order.id });
    const collected = roundMoney(payments.reduce((s, p) => s + p.amount, 0));
    const outstanding = roundMoney(order.total - collected);
    if (roundMoney(input.amount) > outstanding) throw new DomainError(`The payment exceeds the outstanding amount (${outstanding.toFixed(2)}).`);
    const at = nowOf(ctx).toISOString();
    const payment: Payment = {
      id: newId(),
      organization_id: ctx.actor.organization_id,
      order_id: order.id,
      amount: roundMoney(input.amount),
      currency: order.currency,
      paid_at: new Date(`${input.paid_at}T12:00:00Z`).toISOString(),
      method: input.method,
      reference: input.reference,
      is_simulated: true,
      recorded_by: ctx.actor.id,
      created_at: at,
      updated_at: at,
    };
    await tx.insert("payments", payment);
    await tx.update("orders", order.id, {
      payment_status: derivePaymentStatus({ total: order.total, collected: collected + payment.amount, status: order.status, payment_due_date: order.payment_due_date, today: today(ctx) }),
      updated_at: at,
    });
    await emit(tx, ctx, { type: "record.created", payload: { entity: "payment", id: payment.id, after: payment } });
    return payment;
  });
}

/**
 * Creates the order for a won deal. Idempotent: the unique orders.source_deal_id means one
 * order per deal, and a retry returns the existing order instead of creating another.
 * The mode (draft or confirmed) comes from the organization setting. Phase 3 automations
 * call this same function.
 */
export async function convertDealToOrder(ctx: ServiceContext, dealId: string): Promise<{ order: Order; created: boolean }> {
  const attempt = () =>
    ctx.db.write(ctx.actor.organization_id, async (tx) => {
      const deal = await getOwned(tx, ctx, "deals", dealId);
      const existing = (await tx.find("orders", { source_deal_id: deal.id }))[0];
      if (existing) return { order: existing, created: false };
      requireCan(ctx, "create", "order", deal.owner_id, deal.id);
      const stage = await tx.get("pipeline_stages", deal.stage_id);
      if (!stage?.is_won) throw new DomainError("Only won deals can be converted into an order.", "conflict");
      const org = await tx.get("organizations", ctx.actor.organization_id);
      const mode = org?.settings.order_conversion_mode ?? "draft";
      const order = await insertOrder(
        tx,
        ctx,
        {
          company_id: deal.company_id,
          currency: deal.currency,
          order_date: today(ctx),
          expected_delivery_date: null,
          notes: `Created from deal "${deal.name}".`,
          owner_id: deal.owner_id,
          source_deal_id: deal.id,
          status: mode,
        },
        [{ product_id: null, description: deal.name, quantity: 1, unit_price: deal.amount, discount_pct: 0, tax_rate: 0 }],
      );
      await emit(tx, ctx, { type: "order.created_from_deal", payload: { order_id: order.id, deal_id: deal.id, mode } });
      return { order, created: true };
    });
  try {
    return await attempt();
  } catch (error) {
    // A concurrent conversion won the race: return its order.
    if (error instanceof UniqueViolation) {
      return ctx.db.read(ctx.actor.organization_id, async (tx) => {
        const order = (await tx.find("orders", { source_deal_id: dealId }))[0];
        if (!order) throw error;
        return { order, created: false };
      });
    }
    throw error;
  }
}

export async function productOptions(ctx: ServiceContext) {
  return ctx.db.read(ctx.actor.organization_id, async (tx) =>
    (await tx.find("products", { archived_at: null, is_active: true }))
      .map((p) => ({ id: p.id, name: p.name, sku: p.sku, unit_price: p.unit_price, tax_rate: p.tax_rate }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
}
