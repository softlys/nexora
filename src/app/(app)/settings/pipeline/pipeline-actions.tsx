"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { FormField } from "@/components/patterns/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { tr } from "@/lib/i18n";
import { deletePipelineAction, savePipelineAction } from "@/server/actions/settings";

/** Create a pipeline (it starts with default stages) or rename one. */
export function PipelineNameButton({ pipeline }: { pipeline?: { id: string; name: string } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(pipeline?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const r = await savePipelineAction({ ...(pipeline && { id: pipeline.id }), name });
      if (!r.ok) return void setError(r.fieldErrors?.name?.[0] ?? r.error);
      toast.success(pipeline ? tr("Pipeline renamed") : tr("Pipeline created"));
      setOpen(false);
      router.refresh();
    });
  return (
    <>
      <Button
        variant={pipeline ? "outline" : "default"}
        size={pipeline ? "sm" : "default"}
        onClick={() => {
          setName(pipeline?.name ?? "");
          setError(null);
          setOpen(true);
        }}
        data-testid={pipeline ? `rename-pipeline-${pipeline.id}` : "new-pipeline"}
      >
        {pipeline ? <Pencil aria-hidden /> : <Plus aria-hidden />}
        {pipeline ? tr("Rename") : tr("New pipeline")}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{pipeline ? tr("Rename pipeline") : tr("New pipeline")}</DialogTitle>
            <DialogDescription>{pipeline ? tr("Deals and stages stay as they are.") : tr("For example Wholesale, Retail or Tenders. It starts with default stages that you can rename, reorder and extend.")}</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <FormField id="pipeline-name" label={tr("Name")} error={error ?? undefined}>
              <Input id="pipeline-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoFocus />
            </FormField>
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                {tr("Cancel")}
              </Button>
              <Button type="submit" disabled={pending || !name.trim()}>
                {pending ? tr("Saving…") : tr("Save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Delete a pipeline without deals (the last pipeline cannot be deleted). */
export function DeletePipelineButton({ pipeline }: { pipeline: { id: string; name: string } }) {
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm" variant="ghost" className="text-danger">
          <Trash2 aria-hidden />
          {tr("Delete")}
        </Button>
      }
      title={tr("Delete the pipeline {p0}?", { p0: tr(pipeline.name) })}
      description={tr("Its stages are deleted too. Only a pipeline without deals can be deleted: move its deals to another pipeline first.")}
      confirmLabel={tr("Delete pipeline")}
      destructive
      onConfirm={async () => {
        const r = await deletePipelineAction({ id: pipeline.id });
        if (!r.ok) {
          toast.error(r.error);
          return false;
        }
        toast.success(tr("Pipeline deleted"));
        router.refresh();
      }}
    />
  );
}
