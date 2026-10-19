"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CalendarDays, GripVertical, MoreHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { DealDrawer, type DrawerDeal } from "@/components/crm/deal-drawer";
import type { DealFormOptions } from "@/components/crm/deal-form";
import { LostReasonDialog } from "@/components/crm/stage-controls";
import { DatePicker } from "@/components/patterns/date-picker";
import { FormField } from "@/components/patterns/form-field";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { PipelineStage } from "@/domain/entities";
import { summarizeStages } from "@/domain/rules/pipeline";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { convertDealToOrderAction, moveDealStageAction, quickEditDealAction } from "@/server/actions/crm";

export type BoardDeal = DrawerDeal & { can_edit: boolean };

type Props = {
  stages: PipelineStage[];
  deals: BoardDeal[];
  options: DealFormOptions;
  currency: string;
  durations: Record<string, { visits: number; averageDays: number; medianDays: number }>;
};

// Prefer the column under the pointer; fall back to rectangle overlap for keyboard drags.
const collision: CollisionDetection = (args) => {
  const pointer = pointerWithin(args);
  return pointer.length > 0 ? pointer : rectIntersection(args);
};

export function PipelineBoard({ stages, deals: serverDeals, options, currency, durations }: Props) {
  const router = useRouter();
  const [deals, setDeals] = useState(serverDeals);
  const [prevServerDeals, setPrevServerDeals] = useState(serverDeals);
  if (prevServerDeals !== serverDeals) {
    setPrevServerDeals(serverDeals);
    setDeals(serverDeals);
  }
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openDealId, setOpenDealId] = useState<string | null>(null);
  const [lostMove, setLostMove] = useState<{ dealId: string; stageId: string } | null>(null);
  const [, startTransition] = useTransition();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const stageById = useMemo(() => new Map(stages.map((s) => [s.id, s])), [stages]);
  const summary = useMemo(() => summarizeStages(stages, deals), [stages, deals]);
  const summaryById = new Map(summary.stages.map((s) => [s.stage_id, s]));
  const activeDeal = deals.find((d) => d.id === activeId) ?? null;
  const openDeal = deals.find((d) => d.id === openDealId) ?? null;

  /** Optimistic move: update locally, persist, roll back with an error toast on failure. */
  const moveDeal = (dealId: string, stageId: string, lostReason?: string) => {
    const before = deals;
    const deal = deals.find((d) => d.id === dealId);
    const stage = stageById.get(stageId);
    if (!deal || !stage || deal.stage_id === stageId) return;
    setDeals((current) =>
      current.map((d) =>
        d.id === dealId
          ? { ...d, stage_id: stageId, stage_name: stage.name, is_won: stage.is_won, is_lost: stage.is_lost, probability: stage.probability, days_in_stage: 0, lost_reason: lostReason ?? null }
          : d,
      ),
    );
    startTransition(async () => {
      const result = await moveDealStageAction({ deal_id: dealId, stage_id: stageId, ...(lostReason && { lost_reason: lostReason }) });
      if (!result.ok) {
        setDeals(before);
        toast.error(`Could not move "${deal.name}"`, { description: result.error });
        return;
      }
      if (stage.is_won) {
        toast.success(`${deal.name} won`, {
          description: "Create the order now or later from the deal.",
          action: {
            label: "Create order",
            onClick: async () => {
              const order = await convertDealToOrderAction({ deal_id: dealId });
              if (order.ok) router.push(`/orders/${order.data.order_id}`);
              else toast.error(order.error);
            },
          },
        });
      } else {
        toast.success(`Moved to ${stage.name}`);
      }
      router.refresh();
    });
  };

  const requestMove = (dealId: string, stageId: string) => {
    if (stageById.get(stageId)?.is_lost) setLostMove({ dealId, stageId });
    else moveDeal(dealId, stageId);
  };

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    if (e.over) requestMove(String(e.active.id), String(e.over.id));
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up deal ${deals.find((d) => d.id === active.id)?.name}. Use arrow keys to move between stages, space to drop, escape to cancel.`,
    onDragOver: ({ active, over }) => (over ? `Deal ${deals.find((d) => d.id === active.id)?.name} is over ${stageById.get(String(over.id))?.name}.` : "Not over a stage."),
    onDragEnd: ({ active, over }) => (over ? `Deal ${deals.find((d) => d.id === active.id)?.name} dropped in ${stageById.get(String(over.id))?.name}.` : "Drop cancelled."),
    onDragCancel: () => "Drag cancelled. The deal stayed in its stage.",
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Open pipeline" value={formatMoney(summary.openTotal, currency)} />
        <Stat label="Weighted forecast" value={formatMoney(summary.weightedTotal, currency)} hint="Amount × probability, open stages" />
        <Stat label="Open deals" value={String(deals.filter((d) => !d.is_won && !d.is_lost).length)} />
        <Stat label="Won in view" value={formatMoney(deals.filter((d) => d.is_won).reduce((s, d) => s + d.amount, 0), currency)} />
      </div>

      <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)} accessibility={{ announcements }}>
        <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6" data-testid="pipeline-board">
          <div className="flex min-w-max gap-3">
            {stages.map((stage) => {
              const s = summaryById.get(stage.id)!;
              const d = durations[stage.id];
              return (
                <Column key={stage.id} stage={stage} count={s.count} total={s.total} weighted={s.weighted} currency={currency} avgDays={d?.averageDays}>
                  {deals
                    .filter((deal) => deal.stage_id === stage.id)
                    .sort((a, b) => (a.expected_close_date ?? "9999").localeCompare(b.expected_close_date ?? "9999"))
                    .map((deal) => (
                      <DealCard key={deal.id} deal={deal} stages={stages} currency={currency} onOpen={() => setOpenDealId(deal.id)} onMove={(stageId) => requestMove(deal.id, stageId)} dragging={activeId === deal.id} />
                    ))}
                </Column>
              );
            })}
          </div>
        </div>
        <DragOverlay dropAnimation={null}>{activeDeal ? <CardBody deal={activeDeal} currency={currency} overlay /> : null}</DragOverlay>
      </DndContext>

      <DealDrawer
        deal={openDeal}
        open={openDeal !== null}
        onOpenChange={(open) => !open && setOpenDealId(null)}
        stages={stages}
        options={options}
        canEdit={openDeal?.can_edit ?? false}
      />
      <LostReasonDialog
        open={lostMove !== null}
        dealName={deals.find((d) => d.id === lostMove?.dealId)?.name ?? ""}
        onCancel={() => setLostMove(null)}
        onSubmit={(reason) => {
          const move = lostMove!;
          setLostMove(null);
          moveDeal(move.dealId, move.stageId, reason);
        }}
      />
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3" title={hint}>
      <div className="text-xs text-text-muted">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-[11px] text-text-muted">{hint}</div>}
    </div>
  );
}

function Column({
  stage,
  count,
  total,
  weighted,
  currency,
  avgDays,
  children,
}: {
  stage: PipelineStage;
  count: number;
  total: number;
  weighted: number;
  currency: string;
  avgDays?: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <section
      ref={setNodeRef}
      aria-label={`${stage.name}, ${count} deals`}
      data-testid={`stage-column-${stage.name}`}
      className={cn("flex w-72 shrink-0 flex-col rounded-lg border border-border bg-surface-subtle transition-colors", isOver && "border-brand bg-brand-subtle/40")}
    >
      <header className="space-y-0.5 border-b border-border px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-medium">
            <span className={cn("size-2 rounded-full", stage.is_won ? "bg-success" : stage.is_lost ? "bg-text-muted" : "bg-brand")} aria-hidden />
            {stage.name}
          </h2>
          <span className="rounded bg-surface-muted px-1.5 text-xs text-text-subtle tabular-nums" data-testid="stage-count">
            {count}
          </span>
        </div>
        <div className="flex justify-between text-xs text-text-muted tabular-nums">
          <span data-testid="stage-total">{formatMoney(total, currency, "en-US", true)}</span>
          {!stage.is_won && !stage.is_lost && <span title="Weighted: amount × probability">wtd {formatMoney(weighted, currency, "en-US", true)}</span>}
        </div>
        {avgDays !== undefined && !stage.is_won && !stage.is_lost && <div className="text-[11px] text-text-muted">Avg. {avgDays} days in stage</div>}
      </header>
      <div className="flex min-h-24 flex-1 flex-col gap-2 p-2">{children}</div>
    </section>
  );
}

function CardBody({ deal, currency, overlay = false }: { deal: BoardDeal; currency: string; overlay?: boolean }) {
  const overdue = deal.expected_close_date && !deal.is_won && !deal.is_lost && deal.expected_close_date < new Date().toISOString().slice(0, 10);
  return (
    <div className={cn("rounded-md border border-border bg-surface p-2.5 text-left shadow-xs", overlay && "w-68 rotate-1 shadow-lg")}>
      <div className="line-clamp-2 text-sm font-medium">{deal.name}</div>
      <div className="mt-0.5 truncate text-xs text-text-muted">{deal.company_name}</div>
      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="font-medium tabular-nums">{formatMoney(deal.amount, deal.currency || currency)}</span>
        <span className="text-text-muted">{deal.owner_name}</span>
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[11px] text-text-muted">
        <span className={cn("inline-flex items-center gap-1", overdue && "text-danger")}>
          <CalendarDays className="size-3" aria-hidden />
          {formatDate(deal.expected_close_date)}
        </span>
        <span>{deal.days_in_stage}d in stage</span>
      </div>
    </div>
  );
}

function DealCard({
  deal,
  stages,
  currency,
  onOpen,
  onMove,
  dragging,
}: {
  deal: BoardDeal;
  stages: PipelineStage[];
  currency: string;
  onOpen: () => void;
  onMove: (stageId: string) => void;
  dragging: boolean;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef } = useDraggable({ id: deal.id, disabled: !deal.can_edit });
  return (
    <div ref={setNodeRef} className={cn("group relative", dragging && "opacity-40")} data-testid="deal-card" data-deal-name={deal.name}>
      <button type="button" onClick={onOpen} className="block w-full rounded-md focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none" aria-label={`Open ${deal.name}`}>
        <CardBody deal={deal} currency={currency} />
      </button>
      {deal.can_edit && (
        <div className="absolute top-1.5 right-1.5 flex gap-0.5 opacity-100 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
          <QuickEdit deal={deal} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label={`Move ${deal.name} to another stage`} className="bg-surface">
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Move to</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {stages.map((s) => (
                <DropdownMenuItem key={s.id} disabled={s.id === deal.stage_id} onSelect={() => onMove(s.id)}>
                  {s.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            ref={setActivatorNodeRef}
            type="button"
            className="flex size-6 cursor-grab items-center justify-center rounded bg-surface text-text-muted hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none active:cursor-grabbing"
            {...attributes}
            {...listeners}
            aria-label={`Drag ${deal.name}`}
          >
            <GripVertical className="size-3.5" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}

/** Quick edit of amount, probability and close date from the card. */
function QuickEdit({ deal }: { deal: BoardDeal }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({ amount: String(deal.amount), probability: String(deal.probability), close: deal.expected_close_date });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setValues({ amount: String(deal.amount), probability: String(deal.probability), close: deal.expected_close_date });
          setError(null);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={`Quick edit ${deal.name}`} className="bg-surface">
          <span aria-hidden className="text-[10px] font-semibold">$</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64" align="end">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const result = await quickEditDealAction({ id: deal.id, amount: values.amount, probability: values.probability, expected_close_date: values.close });
              if (!result.ok) {
                setError(result.error);
                return;
              }
              toast.success("Deal updated");
              setOpen(false);
              router.refresh();
            });
          }}
        >
          <FormField id={`qe-amount-${deal.id}`} label="Amount">
            <Input id={`qe-amount-${deal.id}`} inputMode="decimal" value={values.amount} onChange={(e) => setValues({ ...values, amount: e.target.value })} />
          </FormField>
          <FormField id={`qe-prob-${deal.id}`} label="Probability (%)">
            <Input id={`qe-prob-${deal.id}`} inputMode="numeric" value={values.probability} onChange={(e) => setValues({ ...values, probability: e.target.value })} />
          </FormField>
          <FormField id={`qe-close-${deal.id}`} label="Expected close">
            <DatePicker id={`qe-close-${deal.id}`} value={values.close} onChange={(v) => setValues({ ...values, close: v })} />
          </FormField>
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
