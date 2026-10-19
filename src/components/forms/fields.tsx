"use client";

import type { ReactNode } from "react";
import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form";
import { Combobox, type ComboboxOption } from "@/components/patterns/combobox";
import { DatePicker } from "@/components/patterns/date-picker";
import { FormField } from "@/components/patterns/form-field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type Base<T extends FieldValues> = {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  hint?: ReactNode;
  className?: string;
};

const idFor = (name: string) => `field-${name.replace(/\./g, "-")}`;

export function TextField<T extends FieldValues>({
  control,
  name,
  label,
  hint,
  className,
  type = "text",
  placeholder,
  autoComplete,
  inputMode,
}: Base<T> & { type?: string; placeholder?: string; autoComplete?: string; inputMode?: "decimal" | "numeric" | "email" | "tel" | "url" }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FormField id={idFor(name)} label={label} hint={hint} error={fieldState.error?.message} className={className}>
          <Input
            id={idFor(name)}
            type={type}
            placeholder={placeholder}
            autoComplete={autoComplete}
            inputMode={inputMode}
            aria-invalid={!!fieldState.error}
            aria-describedby={fieldState.error ? `${idFor(name)}-error` : hint ? `${idFor(name)}-hint` : undefined}
            {...field}
            value={field.value ?? ""}
          />
        </FormField>
      )}
    />
  );
}

export function TextareaField<T extends FieldValues>({ control, name, label, hint, className, rows = 4 }: Base<T> & { rows?: number }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FormField id={idFor(name)} label={label} hint={hint} error={fieldState.error?.message} className={className}>
          <Textarea id={idFor(name)} rows={rows} aria-invalid={!!fieldState.error} {...field} value={field.value ?? ""} />
        </FormField>
      )}
    />
  );
}

export function SelectField<T extends FieldValues>({
  control,
  name,
  label,
  hint,
  className,
  options,
  placeholder = "Select…",
}: Base<T> & { options: Array<{ value: string; label: string }>; placeholder?: string }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FormField id={idFor(name)} label={label} hint={hint} error={fieldState.error?.message} className={className}>
          <Select value={field.value ?? ""} onValueChange={field.onChange}>
            <SelectTrigger id={idFor(name)} className="w-full" aria-invalid={!!fieldState.error} onBlur={field.onBlur}>
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      )}
    />
  );
}

export function ComboboxField<T extends FieldValues>({
  control,
  name,
  label,
  hint,
  className,
  options,
  placeholder,
  disabled,
}: Base<T> & { options: ComboboxOption[]; placeholder?: string; disabled?: boolean }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FormField id={idFor(name)} label={label} hint={hint} error={fieldState.error?.message} className={className}>
          <Combobox id={idFor(name)} options={options} value={field.value ?? null} onChange={field.onChange} placeholder={placeholder} invalid={!!fieldState.error} disabled={disabled} />
        </FormField>
      )}
    />
  );
}

export function DateField<T extends FieldValues>({ control, name, label, hint, className }: Base<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FormField id={idFor(name)} label={label} hint={hint} error={fieldState.error?.message} className={className}>
          <DatePicker id={idFor(name)} value={field.value ?? null} onChange={field.onChange} invalid={!!fieldState.error} />
        </FormField>
      )}
    />
  );
}
