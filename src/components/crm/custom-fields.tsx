"use client";

import { Controller, type Control, type FieldValues, type Path } from "react-hook-form";
import { DateField, TextField } from "@/components/forms/fields";
import { FormField } from "@/components/patterns/form-field";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CustomFieldDef, CustomValues } from "@/domain/custom-fields";
import { tr } from "@/lib/i18n";

/** Form values for custom fields: text inputs hold strings, dates null when empty, checkboxes booleans. */
export type CustomFormValues = Record<string, string | boolean | null>;

const NONE = "__none";

export function customFormValues(defs: CustomFieldDef[] | undefined, values: CustomValues | undefined): CustomFormValues {
  return Object.fromEntries(
    (defs ?? []).map((d) => {
      const v = values?.[d.key];
      if (d.type === "checkbox") return [d.key, v === true];
      if (d.type === "date") return [d.key, typeof v === "string" && v ? v : null];
      return [d.key, v === undefined || v === null ? "" : String(v)];
    }),
  );
}

/** The organization's own fields (Settings → Fields) inside a record form, named custom.<key>. */
export function CustomFieldsSection<T extends FieldValues>({ control, defs }: { control: Control<T>; defs: CustomFieldDef[] | undefined }) {
  if (!defs?.length) return null;
  return (
    <fieldset className="space-y-4 border-t border-border pt-4" data-testid="custom-fields">
      <legend className="sr-only">{tr("Custom fields")}</legend>
      <div className="grid gap-4 sm:grid-cols-2">
        {defs.map((d) => {
          const name = `custom.${d.key}` as Path<T>;
          const label = d.required ? `${d.label} *` : d.label;
          const id = `field-custom-${d.key}`;
          switch (d.type) {
            case "date":
              return <DateField key={d.id} control={control} name={name} label={label} />;
            case "number":
              return <TextField key={d.id} control={control} name={name} label={label} inputMode="decimal" />;
            case "url":
              return <TextField key={d.id} control={control} name={name} label={label} inputMode="url" placeholder="https://" />;
            case "select":
              return (
                <Controller
                  key={d.id}
                  control={control}
                  name={name}
                  render={({ field, fieldState }) => (
                    <FormField id={id} label={label} error={fieldState.error?.message}>
                      <Select value={field.value || (d.required ? "" : NONE)} onValueChange={(v) => field.onChange(v === NONE ? "" : v)}>
                        <SelectTrigger id={id} className="w-full" aria-invalid={!!fieldState.error} onBlur={field.onBlur}>
                          <SelectValue placeholder={tr("Select…")} />
                        </SelectTrigger>
                        <SelectContent>
                          {!d.required && <SelectItem value={NONE}>—</SelectItem>}
                          {d.options.map((o) => (
                            <SelectItem key={o} value={o}>
                              {o}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>
                  )}
                />
              );
            case "checkbox":
              return (
                <Controller
                  key={d.id}
                  control={control}
                  name={name}
                  render={({ field }) => (
                    <label htmlFor={id} className="flex items-center gap-2 self-end pb-2 text-sm">
                      <Checkbox id={id} checked={field.value === true} onCheckedChange={(v) => field.onChange(v === true)} />
                      {d.label}
                    </label>
                  )}
                />
              );
            default:
              return <TextField key={d.id} control={control} name={name} label={label} />;
          }
        })}
      </div>
    </fieldset>
  );
}
