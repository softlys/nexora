"use client";

import { Archive, Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { FormField } from "@/components/patterns/form-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CUSTOM_FIELD_TYPE_LABELS as TYPE_LABELS, CUSTOM_FIELD_TYPES, type CustomFieldEntity, type CustomFieldType } from "@/domain/custom-fields";
import { tr } from "@/lib/i18n";
import { archiveCustomFieldAction, saveCustomFieldAction } from "@/server/actions/custom-fields";

export type FieldRow = { id: string; entity: CustomFieldEntity; key: string; label: string; type: CustomFieldType; options: string[]; required: boolean };

/** Add a field to one kind of record, or edit an existing field (its type stays). */
export function FieldButton({ entity, field }: { entity: CustomFieldEntity; field?: FieldRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [type, setType] = useState<CustomFieldType>("text");
  const [options, setOptions] = useState("");
  const [required, setRequired] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  const reset = () => {
    setLabel(field?.label ?? "");
    setType(field?.type ?? "text");
    setOptions(field?.options.join("\n") ?? "");
    setRequired(field?.required ?? false);
    setErrors({});
  };
  const save = () =>
    start(async () => {
      const r = await saveCustomFieldAction({
        ...(field && { id: field.id }),
        entity,
        label,
        type,
        options: type === "select" ? options.split("\n").map((o) => o.trim()).filter(Boolean) : [],
        required,
      });
      if (!r.ok) return void setErrors({ label: r.fieldErrors?.label?.[0] ?? "", options: r.fieldErrors?.options?.[0] ?? "", _form: r.fieldErrors ? "" : r.error });
      toast.success(field ? tr("Field updated") : tr("Field added"));
      setOpen(false);
      router.refresh();
    });

  return (
    <>
      <Button
        variant={field ? "ghost" : "outline"}
        size="sm"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        data-testid={field ? `edit-field-${field.key}` : `new-field-${entity}`}
        aria-label={field ? tr("Edit {p0}", { p0: field.label }) : undefined}
      >
        {field ? <Pencil aria-hidden /> : <Plus aria-hidden />}
        {field ? null : tr("Add field")}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{field ? tr("Edit field") : tr("New field")}</DialogTitle>
            <DialogDescription>{field ? tr("The type of a field cannot be changed.") : tr("Shown in the form and on the page of every record of this kind.")}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <FormField id="field-label" label={tr("Name")} error={errors.label || undefined}>
              <Input id="field-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} required autoFocus placeholder={tr("e.g. Tax ID")} />
            </FormField>
            <FormField id="field-type" label={tr("Type")}>
              <Select value={type} onValueChange={(v) => setType(v as CustomFieldType)} disabled={!!field}>
                <SelectTrigger id="field-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CUSTOM_FIELD_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {tr(TYPE_LABELS[t])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            {type === "select" && (
              <FormField id="field-options" label={tr("Values")} hint={tr("One per line.")} error={errors.options || undefined}>
                <Textarea id="field-options" value={options} onChange={(e) => setOptions(e.target.value)} rows={5} />
              </FormField>
            )}
            {type !== "checkbox" && (
              <label htmlFor="field-required" className="flex items-center gap-2 text-sm">
                <Checkbox id="field-required" checked={required} onCheckedChange={(v) => setRequired(v === true)} />
                {tr("Required")}
              </label>
            )}
            {errors._form && <p className="text-sm text-danger">{errors._form}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                {tr("Cancel")}
              </Button>
              <Button type="submit" disabled={pending || !label.trim()}>
                {pending ? tr("Saving…") : tr("Save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ArchiveFieldButton({ field }: { field: FieldRow }) {
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm" variant="ghost" aria-label={tr("Remove {p0}", { p0: field.label })} data-testid={`archive-field-${field.key}`}>
          <Archive aria-hidden />
        </Button>
      }
      title={tr("Remove the field {p0}?", { p0: field.label })}
      description={tr("It disappears from forms and record pages. Values already filled in are kept on the records.")}
      confirmLabel={tr("Remove field")}
      destructive
      onConfirm={async () => {
        const r = await archiveCustomFieldAction({ id: field.id });
        if (!r.ok) {
          toast.error(r.error);
          return false;
        }
        toast.success(tr("Field removed"));
        router.refresh();
      }}
    />
  );
}
