"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Combobox } from "@/components/patterns/combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { computeLineTotals, computeOrderTotals } from "@/domain/orders/totals";
import { formatMoney } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { setDealItemsAction } from "@/server/actions/deal-items";

type Line = { product_id: string | null; description: string; quantity: string; unit_price: string; discount_pct: string; tax_rate: string };
export type DealLine = { product_id: string | null; description: string; quantity: number; unit_price: number; discount_pct: number; tax_rate: number; line_total: number };
type ProductOption = { id: string; name: string; sku: string; unit_price: number; tax_rate: number };

const num = (v: string) => Number(v.replace(",", ".").replace(/\s/g, ""));
const lineTotal = (l: Line): number | null => {
  try {
    return computeLineTotals({ quantity: num(l.quantity), unit_price: num(l.unit_price), discount_pct: num(l.discount_pct || "0"), tax_rate: num(l.tax_rate || "0") }).total;
  } catch {
    return null;
  }
};
const toLine = (i: DealLine): Line => ({ product_id: i.product_id, description: i.description, quantity: String(i.quantity), unit_price: String(i.unit_price), discount_pct: String(i.discount_pct), tax_rate: String(i.tax_rate) });

/**
 * Products in a deal: the lines, their total, and an editor. Saving sets the deal amount to the
 * total; the order made from the won deal gets the same lines.
 */
export function DealProducts({ dealId, currency, items, products, canEdit }: { dealId: string; currency: string; items: DealLine[]; products: ProductOption[]; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [pending, start] = useTransition();

  const set = (index: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  const pick = (index: number, productId: string | null) => {
    const p = products.find((x) => x.id === productId);
    set(index, p ? { product_id: p.id, description: p.name, unit_price: String(p.unit_price), tax_rate: String(p.tax_rate) } : { product_id: null });
  };
  const valid = lines.every((l) => l.description.trim() && lineTotal(l) !== null);
  const draftTotal = valid ? lines.reduce((s, l) => s + (lineTotal(l) ?? 0), 0) : null;
  const totals = computeOrderTotals(items);

  const save = () =>
    start(async () => {
      const r = await setDealItemsAction({
        deal_id: dealId,
        items: lines.map((l) => ({ product_id: l.product_id, description: l.description.trim(), quantity: num(l.quantity), unit_price: num(l.unit_price), discount_pct: num(l.discount_pct || "0"), tax_rate: num(l.tax_rate || "0") })),
      });
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.data.count ? tr("Products saved. Deal amount: {p0}", { p0: formatMoney(r.data.total, currency) }) : tr("Products removed"));
      setEditing(false);
      router.refresh();
    });

  if (!editing) {
    return (
      <div className="space-y-3" data-testid="deal-products">
        {items.length === 0 ? (
          <p className="text-sm text-text-muted">{tr("No products yet. Add them to calculate the deal amount and prepare the order.")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-text-muted">
                <tr>
                  <th className="py-1 pr-2 text-left font-normal">{tr("Product")}</th>
                  <th className="px-2 py-1 text-right font-normal">{tr("Qty")}</th>
                  <th className="px-2 py-1 text-right font-normal">{tr("Price")}</th>
                  <th className="px-2 py-1 text-right font-normal">{tr("Discount %")}</th>
                  <th className="px-2 py-1 text-right font-normal">{tr("Tax %")}</th>
                  <th className="py-1 pl-2 text-right font-normal">{tr("Total")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i, n) => (
                  <tr key={n} className="border-t border-border">
                    <td className="py-1.5 pr-2">{i.description}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{i.quantity}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(i.unit_price, currency)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{i.discount_pct || "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{i.tax_rate || "—"}</td>
                    <td className="py-1.5 pl-2 text-right tabular-nums">{formatMoney(i.line_total, currency)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="text-sm">
                {totals.discount_total > 0 && (
                  <tr className="border-t border-border text-text-muted">
                    <td colSpan={5} className="py-1 text-right">{tr("Discount")}</td>
                    <td className="py-1 pl-2 text-right tabular-nums">−{formatMoney(totals.discount_total, currency)}</td>
                  </tr>
                )}
                {totals.tax_total > 0 && (
                  <tr className="text-text-muted">
                    <td colSpan={5} className="py-1 text-right">{tr("Tax")}</td>
                    <td className="py-1 pl-2 text-right tabular-nums">{formatMoney(totals.tax_total, currency)}</td>
                  </tr>
                )}
                <tr className="border-t border-border font-semibold">
                  <td colSpan={5} className="py-1.5 text-right">{tr("Total")}</td>
                  <td className="py-1.5 pl-2 text-right tabular-nums" data-testid="deal-products-total">{formatMoney(totals.total, currency)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {canEdit && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setLines(items.length ? items.map(toLine) : [{ product_id: null, description: "", quantity: "1", unit_price: "0", discount_pct: "0", tax_rate: "0" }]);
              setEditing(true);
            }}
            data-testid="edit-deal-products"
          >
            {items.length ? <Pencil aria-hidden /> : <Plus aria-hidden />}
            {items.length ? tr("Edit products") : tr("Add products")}
          </Button>
        )}
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) save();
      }}
    >
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="grid gap-2 rounded-md border border-border p-2 sm:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_auto]">
            <div className="space-y-1 sm:col-span-1">
              <Combobox options={products.map((p) => ({ value: p.id, label: p.name, hint: p.sku }))} value={l.product_id} onChange={(v) => pick(i, v)} placeholder={tr("Custom line")} searchPlaceholder={tr("Search products…")} />
              <Input aria-label={tr("Line {p0} description", { p0: i + 1 })} placeholder={tr("Description")} value={l.description} onChange={(e) => set(i, { description: e.target.value })} maxLength={255} />
            </div>
            {(
              [
                ["quantity", tr("Qty")],
                ["unit_price", tr("Price")],
                ["discount_pct", tr("Discount %")],
                ["tax_rate", tr("Tax %")],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="space-y-1 text-xs text-text-muted">
                {label}
                <Input aria-label={`${label} ${i + 1}`} inputMode="decimal" className="text-right" value={l[key]} onChange={(e) => set(i, { [key]: e.target.value })} />
              </label>
            ))}
            <div className="flex items-end justify-between gap-2 sm:flex-col sm:items-end">
              <span className="text-sm tabular-nums">{lineTotal(l) === null ? "—" : formatMoney(lineTotal(l)!, currency)}</span>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={tr("Remove line {p0}", { p0: i + 1 })} onClick={() => setLines((ls) => ls.filter((_, n) => n !== i))}>
                <Trash2 aria-hidden />
              </Button>
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setLines((ls) => [...ls, { product_id: null, description: "", quantity: "1", unit_price: "0", discount_pct: "0", tax_rate: "0" }])}>
          <Plus aria-hidden />
          {tr("Add line")}
        </Button>
        <span className="text-sm font-semibold tabular-nums">
          {tr("Total")}: {draftTotal === null ? "—" : formatMoney(draftTotal, currency)}
        </span>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => setEditing(false)} disabled={pending}>
          {tr("Cancel")}
        </Button>
        <Button type="submit" disabled={pending || !valid} data-testid="save-deal-products">
          {pending ? tr("Saving…") : tr("Save")}
        </Button>
      </div>
    </form>
  );
}
