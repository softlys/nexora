import type { OrderStatus, PaymentStatus } from "../entities";
import { roundMoney } from "./totals";

/**
 * Payment status is derived, never edited directly:
 * - paid            collected >= total (and total > 0)
 * - overdue         not fully paid and the due date has passed
 * - partially_paid  something collected, not overdue
 * - unpaid          nothing collected, not overdue
 * Draft and cancelled orders are never overdue because nothing is owed yet / anymore.
 */
export function derivePaymentStatus(input: {
  total: number;
  collected: number;
  status: OrderStatus;
  payment_due_date: string | null;
  today: string;
}): PaymentStatus {
  const collected = roundMoney(input.collected);
  const total = roundMoney(input.total);
  if (total > 0 && collected >= total) return "paid";
  const owed = input.status !== "draft" && input.status !== "cancelled";
  if (owed && input.payment_due_date !== null && input.payment_due_date < input.today) return "overdue";
  return collected > 0 ? "partially_paid" : "unpaid";
}
