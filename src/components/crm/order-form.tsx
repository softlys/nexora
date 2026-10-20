"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm, useWatch, type Resolver } from "react-hook-form";
import { toast } from "sonner";
import { ComboboxField, DateField, SelectField, TextareaField, TextField } from "@/components/forms/fields";
import { RecordSheet, useAutoOpen } from "@/components/forms/record-sheet";
import { Combobox } from "@/components/patterns/combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Order, OrderItem } from "@/domain/entities";
import { orderInput } from "@/domain/inputs";
import { computeLineTotals, computeOrderTotals } from "@/domain/orders/totals";
import { formatAmount as formatMoney } from "@/lib/format";
import { applyServerErrors } from "@/lib/forms";
import { createOrderAction, updateOrderAction } from "@/server/actions/crm";

type Option = { value: string; label: string };
export type ProductOption = { id: string; name: string; sku: string; unit_price: number; tax_rate: number };

type Line = { product_id: string | null; description: string; quantity: string; unit_price: string; discount_pct: string; tax_rate: string };
type Values = {
  company_id: string;
  currency: string;
  order_date: string;
  expected_delivery_date: string | null;
  notes: string;
  items: Line[];
  owner_id?: string;
};

const num = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Order editor with a line-item table; totals use the same domain function as the server. */
export function OrderFormButton({
  order,
  items,
  companies,
  products,
  owners,
  currency,
  defaultCompanyId,
  autoOpen = false,
}: {
  autoOpen?: boolean;
  order?: Order;
  items?: OrderItem[];
  companies: Option[];
  products: ProductOption[];
  owners: Option[];
  currency: string;
  defaultCompanyId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useAutoOpen(autoOpen);
  const today = new Date().toISOString().slice(0, 10);
  const defaults: Values = order
    ? {
        company_id: order.company_id,
        currency: order.currency,
        order_date: order.order_date,
        expected_delivery_date: order.expected_delivery_date,
        notes: order.notes,
        items: (items ?? []).map((i) => ({
          product_id: i.product_id,
          description: i.description,
          quantity: String(i.quantity),
          unit_price: String(i.unit_price),
          discount_pct: String(i.discount_pct),
          tax_rate: String(i.tax_rate),
        })),
        ...(owners.length > 0 && { owner_id: order.owner_id }),
      }
    : { company_id: defaultCompanyId ?? "", currency, order_date: today, expected_delivery_date: null, notes: "", items: [{ product_id: null, description: "", quantity: "1", unit_price: "0", discount_pct: "0", tax_rate: "20" }] };

  const { control, handleSubmit, formState, setError, reset, setValue, register } = useForm<Values>({ resolver: zodResolver(orderInput) as unknown as Resolver<Values>, defaultValues: defaults });
  const { fields, append, remove } = useFieldArray({ control, name: "items" });
  const lines = useWatch({ control, name: "items" }) ?? [];
  const validLines = lines.filter((l) => num(l.quantity) > 0 && num(l.unit_price) >= 0 && num(l.discount_pct) <= 100 && num(l.tax_rate) <= 100);
  const totals = computeOrderTotals(validLines.map((l) => ({ quantity: num(l.quantity), unit_price: num(l.unit_price), discount_pct: num(l.discount_pct), tax_rate: num(l.tax_rate) })));
  const cur = useWatch({ control, name: "currency" }) || currency;

  const onSubmit = handleSubmit(async (values) => {
    const result = order ? await updateOrderAction({ id: order.id, ...values }) : await createOrderAction(values);
    if (!result.ok) return applyServerErrors(result, setError);
    toast.success(order ? "Order updated" : "Order created");
    reset(values);
    setOpen(false);
    if (order) router.refresh();
    else router.push(`/orders/${result.data.id}`);
  });

  const pickProduct = (index: number, productId: string | null) => {
    setValue(`items.${index}.product_id`, productId, { shouldDirty: true });
    const p = products.find((x) => x.id === productId);
    if (p) {
      setValue(`items.${index}.description`, p.name, { shouldDirty: true });
      setValue(`items.${index}.unit_price`, String(p.unit_price), { shouldDirty: true });
      setValue(`items.${index}.tax_rate`, String(p.tax_rate), { shouldDirty: true });
    }
  };

  const itemErrors = formState.errors.items;

  return (
    <>
      <Button
        variant={order ? "outline" : "default"}
        onClick={() => {
          reset(defaults);
          setOpen(true);
        }}
      >
        {order ? <Pencil aria-hidden /> : <Plus aria-hidden />}
        {order ? "Edit" : "New order"}
      </Button>
      <RecordSheet
        wide
        open={open}
        onOpenChange={setOpen}
        title={order ? `Edit ${order.order_number}` : "New order"}
        description={order ? "Only draft and confirmed orders can be edited." : "Orders start as drafts. Confirm them when the customer agrees."}
        dirty={formState.isDirty}
        submitting={formState.isSubmitting}
        onSubmit={onSubmit}
        submitLabel={order ? "Save changes" : "Create order"}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <ComboboxField control={control} name="company_id" label="Company" options={companies} placeholder="Choose company" className="sm:col-span-2" />
          <TextField control={control} name="order_date" label="Order date" type="date" />
          <DateField control={control} name="expected_delivery_date" label="Expected delivery" />
          <TextField control={control} name="currency" label="Currency" />
          {owners.length > 0 && <SelectField control={control} name="owner_id" label="Owner" options={owners} />}
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Line items</legend>
          <div className="relative overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-surface-subtle text-xs text-text-muted">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">Product / description</th>
                  <th className="w-16 px-2 py-1.5 text-right font-medium">Qty</th>
                  <th className="w-24 px-2 py-1.5 text-right font-medium">Unit price</th>
                  <th className="w-16 px-2 py-1.5 text-right font-medium">Disc. %</th>
                  <th className="w-16 px-2 py-1.5 text-right font-medium">Tax %</th>
                  <th className="w-24 px-2 py-1.5 text-right font-medium">Total</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {fields.map((field, index) => {
                  const line = lines[index];
                  let lineTotal: number | null = null;
                  try {
                    if (line) lineTotal = computeLineTotals({ quantity: num(line.quantity), unit_price: num(line.unit_price), discount_pct: num(line.discount_pct), tax_rate: num(line.tax_rate) }).total;
                  } catch {
                    lineTotal = null;
                  }
                  const err = itemErrors?.[index];
                  return (
                    <tr key={field.id} className="border-t border-border align-top">
                      <td className="space-y-1 px-2 py-1.5">
                        <Combobox
                          options={products.map((p) => ({ value: p.id, label: p.name, hint: p.sku }))}
                          value={line?.product_id ?? null}
                          onChange={(v) => pickProduct(index, v)}
                          placeholder="Custom line"
                          searchPlaceholder="Search products…"
                        />
                        <Input aria-label={`Line ${index + 1} description`} aria-invalid={!!err?.description} placeholder="Description" {...register(`items.${index}.description`)} />
                      </td>
                      {(["quantity", "unit_price", "discount_pct", "tax_rate"] as const).map((key) => (
                        <td key={key} className="px-2 py-1.5">
                          <Input aria-label={`Line ${index + 1} ${key.replace("_", " ")}`} aria-invalid={!!err?.[key]} inputMode="decimal" className="text-right" {...register(`items.${index}.${key}`)} />
                        </td>
                      ))}
                      <td className="px-2 py-2.5 text-right tabular-nums">{lineTotal === null ? "—" : formatMoney(lineTotal, cur)}</td>
                      <td className="px-1 py-1.5">
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove line ${index + 1}`} disabled={fields.length === 1} onClick={() => remove(index)}>
                          <Trash2 aria-hidden />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {typeof itemErrors?.message === "string" && (
            <p role="alert" className="text-xs text-danger">
              {itemErrors.message}
            </p>
          )}
          {Array.isArray(itemErrors) && itemErrors.some(Boolean) && (
            <p role="alert" className="text-xs text-danger">
              Check the highlighted line values: quantity above 0, discount and tax between 0 and 100.
            </p>
          )}
          <Button type="button" variant="outline" size="sm" onClick={() => append({ product_id: null, description: "", quantity: "1", unit_price: "0", discount_pct: "0", tax_rate: "20" })} disabled={fields.length >= 50}>
            <Plus aria-hidden />
            Add line
          </Button>
        </fieldset>

        <dl className="ml-auto w-full max-w-xs space-y-1 text-sm">
          {[
            ["Subtotal", totals.subtotal],
            ["Discount", -totals.discount_total],
            ["Tax", totals.tax_total],
          ].map(([label, value]) => (
            <div key={label as string} className="flex justify-between text-text-subtle">
              <dt>{label}</dt>
              <dd className="tabular-nums">{formatMoney(value as number, cur)}</dd>
            </div>
          ))}
          <div className="flex justify-between border-t border-border pt-1 font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatMoney(totals.total, cur)}</dd>
          </div>
        </dl>
        <TextareaField control={control} name="notes" label="Notes" rows={3} />
      </RecordSheet>
    </>
  );
}
