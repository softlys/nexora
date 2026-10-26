"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Controller, useForm, useWatch, type Resolver } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ComboboxField, DateField, SelectField, TextareaField, TextField } from "@/components/forms/fields";
import { RecordSheet, useAutoOpen } from "@/components/forms/record-sheet";
import { Combobox } from "@/components/patterns/combobox";
import { FormField } from "@/components/patterns/form-field";
import { humanizeStatus } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { LEAD_SOURCES, type Deal } from "@/domain/entities";
import { dealFields, newCompanyInput } from "@/domain/inputs";
import { COUNTRY_OPTIONS } from "@/lib/countries";
import { applyServerErrors } from "@/lib/forms";
import { createDealAction, updateDealAction } from "@/server/actions/crm";
import { tr } from "@/lib/i18n";

type Option = { value: string; label: string };

type Values = {
  name: string;
  company_id: string;
  /** A company typed by name; created (or matched by name) when the deal is saved. */
  new_company: { name: string; industry: string; country: string } | null;
  primary_contact_id: string | null;
  amount: string;
  currency: string;
  probability: string;
  expected_close_date: string | null;
  source: Deal["source"];
  next_activity: string;
  notes: string;
  owner_id?: string;
  /** New deals only: the pipeline whose first stage the deal starts in. */
  pipeline_id?: string;
};

const formSchema = z
  .object({ ...dealFields, company_id: z.string(), new_company: newCompanyInput.nullable(), pipeline_id: z.string().optional(), probability: z.union([z.literal(""), z.coerce.number().int().min(0).max(100)]) })
  .refine((d) => d.company_id || d.new_company, { path: ["company_id"], message: tr("Choose a company or type a new name") });

export type DealFormOptions = {
  pipelines?: Option[];
  owners: Option[];
  companies: Option[];
  contacts: Array<Option & { company_id: string | null }>;
  currency: string;
};

export function DealFormButton({
  deal,
  options,
  defaultCompanyId,
  defaultPipelineId,
  variant = deal ? "outline" : "default",
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
  autoOpen = false,
}: {
  autoOpen?: boolean;
  deal?: Deal;
  options: DealFormOptions;
  defaultCompanyId?: string;
  defaultPipelineId?: string;
  variant?: "default" | "outline";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
}) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = useAutoOpen(autoOpen);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (v: boolean) => (onOpenChange ? onOpenChange(v) : setInternalOpen(v));
  const defaults: Values = deal
    ? {
        name: deal.name,
        company_id: deal.company_id,
        new_company: null,
        primary_contact_id: deal.primary_contact_id,
        amount: String(deal.amount),
        currency: deal.currency,
        probability: String(deal.probability),
        expected_close_date: deal.expected_close_date,
        source: deal.source,
        next_activity: deal.next_activity,
        notes: deal.notes,
        ...(options.owners.length > 0 && { owner_id: deal.owner_id }),
      }
    : { name: "", company_id: defaultCompanyId ?? "", new_company: null, primary_contact_id: null, amount: "", currency: options.currency, probability: "", expected_close_date: null, source: "outbound", next_activity: "", notes: "", pipeline_id: defaultPipelineId ?? options.pipelines?.[0]?.value };
  const { control, handleSubmit, formState, setError, reset, setValue } = useForm<Values>({ resolver: zodResolver(formSchema) as unknown as Resolver<Values>, defaultValues: defaults });
  const companyId = useWatch({ control, name: "company_id" });
  const newCompany = useWatch({ control, name: "new_company" });
  // Load fresh values whenever the sheet opens (also when opened from the pipeline drawer).
  useEffect(() => {
    if (open) reset(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, deal?.id, deal?.updated_at]);

  const onSubmit = handleSubmit(async (values) => {
    const { probability, company_id, new_company, pipeline_id, ...rest } = values;
    const payload = { ...rest, ...(company_id ? { company_id } : new_company && { new_company }), ...(probability !== "" && { probability }) };
    const result = deal ? await updateDealAction({ id: deal.id, ...payload }) : await createDealAction({ ...payload, ...(pipeline_id && { pipeline_id }) });
    if (!result.ok) return applyServerErrors(result, setError);
    toast.success(deal ? tr("Deal updated") : tr("Deal created"));
    reset(values);
    setOpen(false);
    if (deal) router.refresh();
    else router.push(`/deals/${result.data.id}`);
  });

  return (
    <>
      {!hideTrigger && (
        <Button
          variant={variant}
          onClick={() => setOpen(true)}
        >
          {deal ? <Pencil aria-hidden /> : <Plus aria-hidden />}
          {deal ? tr("Edit") : tr("New deal")}
        </Button>
      )}
      <RecordSheet error={formState.errors.root?.server?.message} open={open} onOpenChange={setOpen} title={deal ? tr("Edit {p0}", { p0: deal.name }) : tr("New deal")} dirty={formState.isDirty} submitting={formState.isSubmitting} onSubmit={onSubmit} submitLabel={deal ? tr("Save changes") : tr("Create deal")}>
        <TextField control={control} name="name" label={tr("Deal name")} />
        {!deal && (options.pipelines?.length ?? 0) > 1 && <SelectField control={control} name="pipeline_id" label={tr("Pipeline")} options={options.pipelines!.map((p) => ({ value: p.value, label: tr(p.label) }))} />}
        <Controller
          control={control}
          name="company_id"
          render={({ field, fieldState }) => (
            <FormField id="field-company_id" label={tr("Company")} hint={tr("Pick a company, or type any name to add a new one.")} error={fieldState.error?.message}>
              <Combobox
                id="field-company_id"
                options={options.companies}
                value={field.value || null}
                onChange={(v) => {
                  field.onChange(v ?? "");
                  setValue("new_company", null, { shouldDirty: true });
                  setValue("primary_contact_id", null);
                }}
                onCreate={(name) => {
                  field.onChange("");
                  setValue("new_company", { name, industry: "", country: "" }, { shouldDirty: true });
                  setValue("primary_contact_id", null);
                }}
                createdLabel={newCompany ? `${newCompany.name} (new)` : null}
                placeholder={tr("Choose or type a company")}
                invalid={!!fieldState.error}
              />
            </FormField>
          )}
        />
        {newCompany && (
          <div className="grid gap-4 rounded-md border border-dashed border-border p-3 sm:grid-cols-2" data-testid="new-company">
            <p className="text-xs text-text-muted sm:col-span-2">
              “{newCompany.name}{tr("” is not in your companies yet. It is added as a prospect when you save the deal; fill in the rest on its page later.")}</p>
            <TextField control={control} name="new_company.industry" label={tr("Industry")} hint={tr("Optional")} />
            <ComboboxField control={control} name="new_company.country" label={tr("Country")} options={COUNTRY_OPTIONS} placeholder={tr("Choose country")} />
          </div>
        )}
        <ComboboxField
          control={control}
          name="primary_contact_id"
          label={tr("Primary contact")}
          options={options.contacts.filter((c) => c.company_id === companyId)}
          placeholder={companyId ? tr("No contact") : newCompany ? tr("Add contacts to the new company later") : tr("Choose a company first")}
          disabled={!companyId}
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField control={control} name="amount" label={tr("Amount")} inputMode="decimal" className="sm:col-span-2" />
          <TextField control={control} name="currency" label={tr("Currency")} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField control={control} name="probability" label={tr("Probability (%)")} inputMode="numeric" hint={deal ? tr("Reset to the stage default when the stage changes.") : tr("Leave empty to use the stage default.")} />
          <DateField control={control} name="expected_close_date" label={tr("Expected close")} />
          <SelectField control={control} name="source" label={tr("Source")} options={LEAD_SOURCES.map((s) => ({ value: s, label: humanizeStatus(s) }))} />
          {options.owners.length > 0 && <SelectField control={control} name="owner_id" label={tr("Owner")} options={options.owners} />}
        </div>
        <TextField control={control} name="next_activity" label={tr("Next activity")} />
        <TextareaField control={control} name="notes" label={tr("Notes")} />
      </RecordSheet>
    </>
  );
}
