"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { FormField, SettingsCard } from "@/components/patterns/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateOrganizationInput } from "@/domain/entities";
import { applyServerErrors } from "@/lib/forms";
import { updateOrganizationAction } from "@/server/actions/settings";

type Values = z.input<typeof updateOrganizationInput>;

const CURRENCIES = ["USD", "EUR", "GBP", "SEK", "PLN", "CHF"];
const LOCALES: Array<[Values["locale"], string]> = [
  ["en-US", "English (United States)"],
  ["en-GB", "English (United Kingdom)"],
  ["de-DE", "German (Germany)"],
  ["fr-FR", "French (France)"],
  ["nl-NL", "Dutch (Netherlands)"],
  ["sv-SE", "Swedish (Sweden)"],
];

export function OrganizationForm({ defaults }: { defaults: Values }) {
  const { register, handleSubmit, formState, setError, reset, control } = useForm<Values>({
    resolver: zodResolver(updateOrganizationInput),
    defaultValues: defaults,
  });

  const onSubmit = handleSubmit(async (values) => {
    const result = await updateOrganizationAction(values);
    if (!result.ok) return applyServerErrors(result, setError);
    reset(values);
    toast.success("Organization settings saved");
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <SettingsCard
        title="Organization"
        description="Applies to everyone in the organization."
        footer={
          <Button type="submit" disabled={formState.isSubmitting || !formState.isDirty}>
            {formState.isSubmitting ? "Saving…" : "Save changes"}
          </Button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="org-name" label="Organization name" error={formState.errors.name?.message} className="sm:col-span-2">
            <Input id="org-name" aria-invalid={!!formState.errors.name} {...register("name")} />
          </FormField>
          <FormField id="currency" label="Default currency" error={formState.errors.currency?.message} hint="Used for new deals and orders.">
            <Controller
              control={control}
              name="currency"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="currency" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </FormField>
          <FormField id="locale" label="Locale" error={formState.errors.locale?.message} hint="Number and date formatting.">
            <Controller
              control={control}
              name="locale"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="locale" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LOCALES.map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </FormField>
          <FormField
            id="conversion"
            label="Order created from a won deal"
            className="sm:col-span-2"
            hint="Whether converting a won deal creates a draft order for review or a confirmed order."
          >
            <Controller
              control={control}
              name="order_conversion_mode"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="conversion" className="w-full sm:w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft order</SelectItem>
                    <SelectItem value="confirmed">Confirmed order</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </FormField>
        </div>
      </SettingsCard>
    </form>
  );
}
