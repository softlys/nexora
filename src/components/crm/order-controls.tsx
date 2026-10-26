"use client";

import { Banknote } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { FormField } from "@/components/patterns/form-field";
import { humanizeStatus } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { OrderStatus } from "@/domain/entities";
import { ORDER_TRANSITIONS } from "@/domain/rules/orders";
import { formatAmount } from "@/lib/format";
import { changeOrderStatusAction, recordPaymentAction } from "@/server/actions/crm";
import { tr } from "@/lib/i18n";

const ACTION_LABEL: Partial<Record<OrderStatus, string>> = {
  confirmed: tr("Confirm order"),
  processing: tr("Start processing"),
  shipped: tr("Mark shipped"),
  delivered: tr("Mark delivered"),
  cancelled: tr("Cancel order"),
};

/** Buttons for the allowed next statuses only. The server enforces the same transitions. */
export function OrderStatusActions({ orderId, status }: { orderId: string; status: OrderStatus }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const next = ORDER_TRANSITIONS[status];
  if (next.length === 0) return null;

  const change = async (to: OrderStatus) => {
    const result = await changeOrderStatusAction({ id: orderId, status: to });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success(tr("Order {p0}", { p0: humanizeStatus(to).toLowerCase() }));
    router.refresh();
  };

  return (
    <>
      {next
        .filter((s) => s !== "cancelled")
        .map((to) => (
          <Button key={to} disabled={pending} onClick={() => startTransition(async () => void (await change(to)))}>
            {ACTION_LABEL[to]}
          </Button>
        ))}
      {next.includes("cancelled") && (
        <ConfirmDialog
          trigger={
            <Button variant="outline" disabled={pending}>{tr("Cancel order")}</Button>
          }
          title={tr("Cancel this order?")}
          description={tr("A cancelled order cannot be reopened. Simulated payments already recorded stay on the order as history; NEXORA does not process refunds, so handle any refund outside the app.")}
          confirmLabel={tr("Cancel order")}
          cancelLabel={tr("Keep order")}
          destructive
          onConfirm={() => change("cancelled")}
        />
      )}
    </>
  );
}

/** Records a simulated payment. Clearly labelled: NEXORA never charges anyone. */
export function RecordPaymentButton({ orderId, outstanding, currency }: { orderId: string; outstanding: number; currency: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({ amount: String(outstanding), paid_at: new Date().toISOString().slice(0, 10), method: "bank_transfer", reference: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <Button
        variant="outline"
        disabled={outstanding <= 0}
        onClick={() => {
          setValues({ ...values, amount: String(outstanding) });
          setError(null);
          setOpen(true);
        }}
      >
        <Banknote aria-hidden />{tr("Record payment")}</Button>
      <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
        <DialogContent>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              startTransition(async () => {
                const result = await recordPaymentAction({ order_id: orderId, ...values });
                if (!result.ok) {
                  setError(Object.values(result.fieldErrors ?? {})[0]?.[0] ?? result.error);
                  return;
                }
                toast.success(tr("Simulated payment recorded"));
                setOpen(false);
                router.refresh();
              });
            }}
          >
            <DialogHeader>
              <DialogTitle>{tr("Record a simulated payment")}</DialogTitle>
              <DialogDescription>{tr("This is a demo record only. No money moves and no payment provider is contacted. Outstanding:")} {formatAmount(outstanding, currency)}.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField id="pay-amount" label={tr("Amount ({p0})", { p0: currency })}>
                <Input id="pay-amount" inputMode="decimal" value={values.amount} onChange={(e) => setValues({ ...values, amount: e.target.value })} />
              </FormField>
              <FormField id="pay-date" label={tr("Paid on")}>
                <Input id="pay-date" type="date" max={new Date().toISOString().slice(0, 10)} value={values.paid_at} onChange={(e) => setValues({ ...values, paid_at: e.target.value })} />
              </FormField>
              <FormField id="pay-method" label={tr("Method")}>
                <Select value={values.method} onValueChange={(v) => setValues({ ...values, method: v })}>
                  <SelectTrigger id="pay-method" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bank_transfer">{tr("Bank transfer")}</SelectItem>
                    <SelectItem value="card">{tr("Card")}</SelectItem>
                    <SelectItem value="other">{tr("Other")}</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
              <FormField id="pay-ref" label={tr("Reference")}>
                <Input id="pay-ref" value={values.reference} maxLength={120} onChange={(e) => setValues({ ...values, reference: e.target.value })} />
              </FormField>
            </div>
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>{tr("Cancel")}</Button>
              <Button type="submit" disabled={pending}>
                {pending ? tr("Saving…") : tr("Record simulated payment")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
