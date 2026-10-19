"use client";

import { ExternalLink as ExternalIcon, Eye, Pencil } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { Deal } from "@/domain/entities";
import { formatDate, formatMoney } from "@/lib/format";
import { DealFormButton, type DealFormOptions } from "./deal-form";
import { CreateOrderButton, StageSelect, type StageOption } from "./stage-controls";

export type DrawerDeal = Deal & { stage_name: string; is_won: boolean; is_lost: boolean; company_name: string; owner_name: string; days_in_stage: number };

/** Deal summary in a side drawer, with stage change and full edit. Used by lists and the pipeline. */
export function DealDrawer({
  deal,
  open,
  onOpenChange,
  stages,
  options,
  canEdit,
}: {
  deal: DrawerDeal | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stages: StageOption[];
  options: DealFormOptions;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  if (!deal) return null;
  const facts: Array<[string, string]> = [
    ["Company", deal.company_name],
    ["Amount", formatMoney(deal.amount, deal.currency)],
    ["Probability", `${deal.probability}%`],
    ["Weighted", formatMoney((deal.amount * deal.probability) / 100, deal.currency)],
    ["Expected close", formatDate(deal.expected_close_date)],
    ["Owner", deal.owner_name],
    ["Days in stage", String(deal.days_in_stage)],
    ["Next activity", deal.next_activity || "—"],
  ];
  return (
    <>
      <Sheet open={open && !editing} onOpenChange={onOpenChange}>
        <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b border-border px-5 py-4">
            <SheetTitle className="pr-6">{deal.name}</SheetTitle>
            <SheetDescription className="flex items-center gap-2">
              <StatusBadge label={deal.stage_name} tone={deal.is_won ? "success" : deal.is_lost ? "neutral" : "accent"} />
              {deal.company_name}
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
            {canEdit && (
              <div className="flex flex-wrap items-center gap-2">
                <StageSelect dealId={deal.id} dealName={deal.name} stageId={deal.stage_id} stages={stages} />
                <Button variant="outline" onClick={() => setEditing(true)}>
                  <Pencil aria-hidden />
                  Edit
                </Button>
                {deal.is_won && <CreateOrderButton dealId={deal.id} existing={null} />}
              </div>
            )}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {facts.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-text-muted">{label}</dt>
                  <dd className="mt-0.5">{value}</dd>
                </div>
              ))}
            </dl>
            {deal.lost_reason && (
              <p className="rounded-md bg-surface-muted px-3 py-2 text-sm">
                <span className="text-text-muted">Lost reason: </span>
                {deal.lost_reason}
              </p>
            )}
            {deal.notes && <p className="text-sm whitespace-pre-wrap text-text-subtle">{deal.notes}</p>}
          </div>
          <div className="border-t border-border px-5 py-3">
            <Button asChild variant="ghost" className="w-full">
              <Link href={`/deals/${deal.id}`}>
                <ExternalIcon aria-hidden />
                Open full deal page
              </Link>
            </Button>
          </div>
        </SheetContent>
      </Sheet>
      {canEdit && (
        <DealFormButton
          deal={deal}
          options={options}
          hideTrigger
          open={editing}
          onOpenChange={(v) => {
            setEditing(v);
            if (!v) onOpenChange(false);
          }}
        />
      )}
    </>
  );
}

/** Small button that opens the drawer for one deal (used in tables). */
export function DealPreviewButton(props: { deal: DrawerDeal; stages: StageOption[]; options: DealFormOptions; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="icon-sm" aria-label={`Preview ${props.deal.name}`} onClick={() => setOpen(true)}>
        <Eye aria-hidden />
      </Button>
      {open && <DealDrawer {...props} open={open} onOpenChange={setOpen} />}
    </>
  );
}
