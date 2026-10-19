import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { derivePaymentStatus } from "@/domain/orders/payment-status";
import { computeLineTotals, computeOrderTotals } from "@/domain/orders/totals";
import { buildTokensCss, flattenTokens } from "@/lib/tokens/build";

describe("design tokens", () => {
  const tokens = JSON.parse(readFileSync("tokens/tokens.json", "utf8"));

  it("generated CSS is in sync with tokens.json (run npm run tokens:build)", () => {
    expect(readFileSync("src/styles/tokens.css", "utf8")).toBe(buildTokensCss(tokens));
  });

  it("every reference points at an existing token", () => {
    const flat = new Map(flattenTokens(tokens));
    for (const [path, leaf] of flat) {
      for (const [, ref] of leaf.$value.matchAll(/\{([^}]+)\}/g)) {
        expect(flat.has(ref!), `${path} -> ${ref}`).toBe(true);
      }
    }
  });

  it("light and dark themes define the same semantic tokens", () => {
    expect(Object.keys(tokens.semantic.dark).sort()).toEqual(Object.keys(tokens.semantic.light).sort());
  });
});

describe("order totals", () => {
  it("applies discount before tax and rounds per line", () => {
    expect(computeLineTotals({ quantity: 3, unit_price: 19.99, discount_pct: 10, tax_rate: 20 })).toEqual({
      subtotal: 59.97,
      discount: 6,
      tax: 10.79,
      total: 64.76,
    });
  });

  it("sums lines", () => {
    const totals = computeOrderTotals([
      { quantity: 2, unit_price: 100, discount_pct: 0, tax_rate: 20 },
      { quantity: 1, unit_price: 50, discount_pct: 50, tax_rate: 0 },
    ]);
    expect(totals).toEqual({ subtotal: 250, discount_total: 25, tax_total: 40, total: 265 });
  });

  it("rejects invalid lines", () => {
    expect(() => computeLineTotals({ quantity: 0, unit_price: 1, discount_pct: 0, tax_rate: 0 })).toThrow();
    expect(() => computeLineTotals({ quantity: 1, unit_price: 1, discount_pct: 120, tax_rate: 0 })).toThrow();
  });
});

describe("payment status derivation", () => {
  const base = { total: 100, status: "confirmed" as const, payment_due_date: "2026-10-10", today: "2026-10-19" };
  it("covers paid, overdue, partial and unpaid", () => {
    expect(derivePaymentStatus({ ...base, collected: 100 })).toBe("paid");
    expect(derivePaymentStatus({ ...base, collected: 40 })).toBe("overdue");
    expect(derivePaymentStatus({ ...base, collected: 40, payment_due_date: "2026-11-01" })).toBe("partially_paid");
    expect(derivePaymentStatus({ ...base, collected: 0, payment_due_date: "2026-11-01" })).toBe("unpaid");
  });
  it("never marks drafts or cancelled orders overdue", () => {
    expect(derivePaymentStatus({ ...base, collected: 0, status: "draft" })).toBe("unpaid");
    expect(derivePaymentStatus({ ...base, collected: 0, status: "cancelled" })).toBe("unpaid");
  });
});
