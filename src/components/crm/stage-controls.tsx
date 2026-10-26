"use client";

import { PackagePlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FormField } from "@/components/patterns/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { convertDealToOrderAction, moveDealStageAction } from "@/server/actions/crm";
import { tr } from "@/lib/i18n";

export type StageOption = { id: string; name: string; is_won: boolean; is_lost: boolean };

/** Asks for the reason when a deal moves to a lost stage. Resolves with the reason or null when cancelled. */
export function LostReasonDialog({ open, dealName, onSubmit, onCancel }: { open: boolean; dealName: string; onSubmit: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim()) onSubmit(reason.trim());
          }}
          className="grid gap-4"
        >
          <DialogHeader>
            <DialogTitle>{tr("Why was this deal lost?")}</DialogTitle>
            <DialogDescription>{dealName}</DialogDescription>
          </DialogHeader>
          <FormField id="lost-reason" label={tr("Lost reason")} hint={tr("Used in win/loss analysis.")}>
            <Textarea id="lost-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={255} autoFocus placeholder={tr("e.g. Lost to competitor on price")} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>{tr("Cancel")}</Button>
            <Button type="submit" disabled={!reason.trim()}>{tr("Mark as lost")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Stage select on the deal page. Moving to a lost stage asks for a reason. */
export function StageSelect({ dealId, dealName, stageId, stages, disabled }: { dealId: string; dealName: string; stageId: string; stages: StageOption[]; disabled?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [lostTarget, setLostTarget] = useState<string | null>(null);

  const move = (target: string, lostReason?: string) =>
    startTransition(async () => {
      const result = await moveDealStageAction({ deal_id: dealId, stage_id: target, ...(lostReason && { lost_reason: lostReason }) });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(tr("Moved to {p0}", { p0: stages.find((s) => s.id === target)?.name }));
      router.refresh();
    });

  return (
    <>
      <Select
        value={stageId}
        disabled={disabled || pending}
        onValueChange={(target) => {
          if (stages.find((s) => s.id === target)?.is_lost) setLostTarget(target);
          else move(target);
        }}
      >
        <SelectTrigger className="w-44" aria-label={tr("Deal stage")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {stages.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {tr(s.name)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <LostReasonDialog
        open={lostTarget !== null}
        dealName={dealName}
        onCancel={() => setLostTarget(null)}
        onSubmit={(reason) => {
          const target = lostTarget!;
          setLostTarget(null);
          move(target, reason);
        }}
      />
    </>
  );
}

/** Create order button for won deals. Safe to click more than once: the server returns the existing order. */
export function CreateOrderButton({ dealId, existing }: { dealId: string; existing: { id: string; order_number: string } | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (existing)
    return (
      <Button asChild variant="outline">
        <Link href={`/orders/${existing.id}`}>
          <PackagePlus aria-hidden />{tr("Order")} {existing.order_number}
        </Link>
      </Button>
    );
  return (
    <Button
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await convertDealToOrderAction({ deal_id: dealId });
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success(result.data.created ? tr("Order {p0} created", { p0: result.data.order_number }) : tr("Order {p0} already exists", { p0: result.data.order_number }));
          router.push(`/orders/${result.data.order_id}`);
        })
      }
    >
      <PackagePlus aria-hidden />
      {pending ? tr("Creating…") : tr("Create order")}
    </Button>
  );
}
