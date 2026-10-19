/**
 * Order money math. All amounts are rounded to cents per line, then summed,
 * so the stored totals always equal the sum of the visible line totals.
 */

export type LineInput = {
  quantity: number;
  unit_price: number;
  /** Percent, 0-100. */
  discount_pct: number;
  /** Percent, 0-100. */
  tax_rate: number;
};

export type LineTotals = {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
};

export type OrderTotals = {
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
};

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function computeLineTotals(line: LineInput): LineTotals {
  if (line.quantity <= 0) throw new RangeError("Quantity must be positive");
  if (line.unit_price < 0) throw new RangeError("Unit price cannot be negative");
  if (line.discount_pct < 0 || line.discount_pct > 100) throw new RangeError("Discount must be between 0 and 100");
  if (line.tax_rate < 0 || line.tax_rate > 100) throw new RangeError("Tax rate must be between 0 and 100");

  const subtotal = roundMoney(line.quantity * line.unit_price);
  const discount = roundMoney((subtotal * line.discount_pct) / 100);
  const taxable = roundMoney(subtotal - discount);
  const tax = roundMoney((taxable * line.tax_rate) / 100);
  return { subtotal, discount, tax, total: roundMoney(taxable + tax) };
}

export function computeOrderTotals(lines: readonly LineInput[]): OrderTotals {
  const totals = lines.map(computeLineTotals).reduce(
    (acc, l) => ({
      subtotal: acc.subtotal + l.subtotal,
      discount_total: acc.discount_total + l.discount,
      tax_total: acc.tax_total + l.tax,
      total: acc.total + l.total,
    }),
    { subtotal: 0, discount_total: 0, tax_total: 0, total: 0 },
  );
  return {
    subtotal: roundMoney(totals.subtotal),
    discount_total: roundMoney(totals.discount_total),
    tax_total: roundMoney(totals.tax_total),
    total: roundMoney(totals.total),
  };
}
