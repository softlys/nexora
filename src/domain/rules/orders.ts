import type { FULFILLMENT_STATUSES, Order, OrderStatus } from "../entities";

/** Allowed order status transitions. Anything else is refused on the server. */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  draft: ["confirmed", "cancelled"],
  confirmed: ["processing", "cancelled"],
  processing: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** Orders whose lines and prices can still be edited. */
export function isEditable(status: OrderStatus): boolean {
  return status === "draft" || status === "confirmed";
}

export const PAYMENT_TERMS_DAYS = 30;

/** Side effects of entering a status: fulfillment, delivery time and payment due date. */
export function applyStatusEffects(
  order: Pick<Order, "order_date" | "payment_due_date" | "fulfillment_status" | "delivered_at">,
  to: OrderStatus,
  now: Date,
): Partial<Pick<Order, "fulfillment_status" | "delivered_at" | "payment_due_date">> {
  const patch: Partial<Pick<Order, "fulfillment_status" | "delivered_at" | "payment_due_date">> = {};
  const fulfillment: Partial<Record<OrderStatus, (typeof FULFILLMENT_STATUSES)[number]>> = {
    processing: "unfulfilled",
    shipped: "fulfilled",
    delivered: "fulfilled",
  };
  if (fulfillment[to]) patch.fulfillment_status = fulfillment[to];
  if (to === "delivered") patch.delivered_at = now.toISOString();
  if (to === "confirmed" && !order.payment_due_date) {
    const due = new Date(`${order.order_date}T00:00:00Z`);
    due.setUTCDate(due.getUTCDate() + PAYMENT_TERMS_DAYS);
    patch.payment_due_date = due.toISOString().slice(0, 10);
  }
  return patch;
}

/** Next order number for the year: NX-YYYY-0001, NX-YYYY-0002, … */
export function nextOrderNumber(existing: string[], year: number): string {
  const prefix = `NX-${year}-`;
  const max = existing
    .filter((n) => n.startsWith(prefix))
    .map((n) => Number(n.slice(prefix.length)))
    .filter((n) => Number.isFinite(n))
    .reduce((a, b) => Math.max(a, b), 0);
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}
