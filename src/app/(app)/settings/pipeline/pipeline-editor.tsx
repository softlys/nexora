"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowDown, ArrowUp, GripVertical, Pencil, Plus } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { FormField, SettingsCard } from "@/components/patterns/form-field";
import { IconButton } from "@/components/patterns/icon-button";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { pipelineStageInput } from "@/domain/entities";
import { applyServerErrors } from "@/lib/forms";
import { cn } from "@/lib/utils";
import { reorderPipelineStagesAction, savePipelineStageAction } from "@/server/actions/settings";
import { tr } from "@/lib/i18n";

type Stage = { id: string; name: string; probability: number; is_won: boolean; is_lost: boolean; position: number };

export function PipelineEditor({ stages: initial, openNew }: { stages: Stage[]; openNew: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [stages, setStages] = useState(initial);
  const [editing, setEditing] = useState<Stage | "new" | null>(openNew ? "new" : null);
  const [pending, startTransition] = useTransition();

  // Adopt fresh server data after router.refresh().
  const [prevInitial, setPrevInitial] = useState(initial);
  if (prevInitial !== initial) {
    setPrevInitial(initial);
    setStages(initial);
  }

  const dndId = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const persistOrder = (next: Stage[], previous: Stage[]) => {
    setStages(next);
    startTransition(async () => {
      const result = await reorderPipelineStagesAction({ ordered_ids: next.map((s) => s.id) });
      if (!result.ok) {
        setStages(previous);
        toast.error(result.error);
        return;
      }
      toast.success(tr("Stage order saved"));
      router.refresh();
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = stages.findIndex((s) => s.id === active.id);
    const to = stages.findIndex((s) => s.id === over.id);
    persistOrder(arrayMove(stages, from, to), stages);
  };

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= stages.length) return;
    persistOrder(arrayMove(stages, index, target), stages);
  };

  const closeDialog = () => {
    setEditing(null);
    if (openNew) router.replace(pathname);
  };

  return (
    <SettingsCard
      title={tr("Pipeline stages")}
      description={tr("Stages used by deals and the pipeline board. Probability is the default for deals entering the stage. The pipeline needs exactly one won and one lost stage.")}
      footer={
        <Button onClick={() => setEditing("new")}>
          <Plus aria-hidden />{tr("Add stage")}</Button>
      }
    >
      <p id="reorder-help" className="mb-3 text-xs text-text-muted">{tr("Drag a stage by its handle, or focus the handle and use Space and the arrow keys. The arrow buttons also reorder.")}</p>
      <DndContext id={dndId} sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={stages.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ol className="divide-y divide-border rounded-md border border-border" aria-label={tr("Pipeline stages in order")}>
            {stages.map((stage, index) => (
              <SortableStage
                key={stage.id}
                stage={stage}
                index={index}
                count={stages.length}
                disabled={pending}
                onMove={move}
                onEdit={() => setEditing(stage)}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>

      <StageDialog
        stage={editing === "new" ? null : editing}
        open={editing !== null}
        onClose={closeDialog}
        onSaved={() => {
          closeDialog();
          router.refresh();
        }}
      />
    </SettingsCard>
  );
}

function SortableStage({
  stage,
  index,
  count,
  disabled,
  onMove,
  onEdit,
}: {
  stage: Stage;
  index: number;
  count: number;
  disabled: boolean;
  onMove: (index: number, delta: -1 | 1) => void;
  onEdit: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: stage.id, disabled });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("flex items-center gap-2 bg-surface px-2 py-2", isDragging && "relative z-10 shadow-md")}
      data-testid="pipeline-stage"
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className="flex size-7 cursor-grab items-center justify-center rounded text-text-muted hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none active:cursor-grabbing"
        aria-label={tr("Reorder {p0}", { p0: stage.name })}
        {...attributes}
        {...listeners}
        aria-describedby="reorder-help"
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      <span className="w-5 text-right text-xs text-text-muted tabular-nums">{index + 1}</span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{stage.name}</span>
      {stage.is_won && <StatusBadge status="won" />}
      {stage.is_lost && <StatusBadge status="lost" />}
      <span className="w-12 text-right text-sm text-text-subtle tabular-nums">{stage.probability}%</span>
      <div className="flex items-center">
        <IconButton icon={ArrowUp} label={tr("Move {p0} up", { p0: stage.name })} size="sm" disabled={disabled || index === 0} onClick={() => onMove(index, -1)} />
        <IconButton icon={ArrowDown} label={tr("Move {p0} down", { p0: stage.name })} size="sm" disabled={disabled || index === count - 1} onClick={() => onMove(index, 1)} />
        <IconButton icon={Pencil} label={tr("Edit {p0}", { p0: stage.name })} size="sm" onClick={onEdit} />
      </div>
    </li>
  );
}

type FormValues = z.input<typeof pipelineStageInput>;

function StageDialog({ stage, open, onClose, onSaved }: { stage: Stage | null; open: boolean; onClose: () => void; onSaved: () => void }) {
  const { register, handleSubmit, formState, setError, reset, control } = useForm<FormValues>({
    resolver: zodResolver(pipelineStageInput),
  });

  useEffect(() => {
    if (open)
      reset(
        stage
          ? { id: stage.id, name: stage.name, probability: stage.probability, is_won: stage.is_won, is_lost: stage.is_lost }
          : { name: "", probability: 50, is_won: false, is_lost: false },
      );
  }, [open, stage, reset]);

  const onSubmit = handleSubmit(async (values) => {
    const result = await savePipelineStageAction(values);
    if (!result.ok) return applyServerErrors(result, setError);
    toast.success(stage ? tr("Stage updated") : tr("Stage added"));
    onSaved();
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{stage ? tr("Edit {p0}", { p0: stage.name }) : tr("Add stage")}</DialogTitle>
            <DialogDescription>{tr("New open stages are placed before the won and lost stages. You can reorder them afterwards.")}</DialogDescription>
          </DialogHeader>
          <FormField id="stage-name" label={tr("Name")} error={formState.errors.name?.message}>
            <Input id="stage-name" autoFocus aria-invalid={!!formState.errors.name} {...register("name")} />
          </FormField>
          <FormField id="stage-probability" label={tr("Default probability (%)")} error={formState.errors.probability?.message}>
            <Input id="stage-probability" type="number" min={0} max={100} step={1} className="w-28" aria-invalid={!!formState.errors.probability} {...register("probability")} />
          </FormField>
          <div className="flex flex-wrap gap-5">
            <Controller
              control={control}
              name="is_won"
              render={({ field }) => (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} />{tr("Won stage")}</label>
              )}
            />
            <Controller
              control={control}
              name="is_lost"
              render={({ field }) => (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} />{tr("Lost stage")}</label>
              )}
            />
          </div>
          {formState.errors.is_lost?.message && (
            <p role="alert" className="text-xs text-danger">
              {formState.errors.is_lost.message}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{tr("Cancel")}</Button>
            <Button type="submit" disabled={formState.isSubmitting}>
              {formState.isSubmitting ? tr("Saving…") : tr("Save stage")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
