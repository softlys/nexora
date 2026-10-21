"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useForm, useWatch, type Resolver } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ComboboxField, DateField, SelectField, TextareaField, TextField } from "@/components/forms/fields";
import { RecordSheet, useAutoOpen } from "@/components/forms/record-sheet";
import { humanizeStatus } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { LEAD_SOURCES, type Deal } from "@/domain/entities";
import { dealFields } from "@/domain/inputs";
import { applyServerErrors } from "@/lib/forms";
import { createDealAction, updateDealAction } from "@/server/actions/crm";

type Option = { value: string; label: string };

type Values = {
  name: string;
  company_id: string;
  primary_contact_id: string | null;
  amount: string;
  currency: string;
  probability: string;
  expected_close_date: string | null;
  source: Deal["source"];
  next_activity: string;
  notes: string;
  owner_id?: string;
};

const formSchema = z.object({ ...dealFields, probability: z.union([z.literal(""), z.coerce.number().int().min(0).max(100)]) });

export type DealFormOptions = {
  owners: Option[];
  companies: Option[];
  contacts: Array<Option & { company_id: string | null }>;
  currency: string;
};

export function DealFormButton({
  deal,
  options,
  defaultCompanyId,
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
    : { name: "", company_id: defaultCompanyId ?? "", primary_contact_id: null, amount: "", currency: options.currency, probability: "", expected_close_date: null, source: "outbound", next_activity: "", notes: "" };
  const { control, handleSubmit, formState, setError, reset } = useForm<Values>({ resolver: zodResolver(formSchema) as unknown as Resolver<Values>, defaultValues: defaults });
  const companyId = useWatch({ control, name: "company_id" });
  // Load fresh values whenever the sheet opens (also when opened from the pipeline drawer).
  useEffect(() => {
    if (open) reset(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, deal?.id, deal?.updated_at]);

  const onSubmit = handleSubmit(async (values) => {
    const { probability, ...rest } = values;
    const payload = { ...rest, ...(probability !== "" && { probability }) };
    const result = deal ? await updateDealAction({ id: deal.id, ...payload }) : await createDealAction(payload);
    if (!result.ok) return applyServerErrors(result, setError);
    toast.success(deal ? "Deal updated" : "Deal created");
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
          {deal ? "Edit" : "New deal"}
        </Button>
      )}
      <RecordSheet error={formState.errors.root?.server?.message} open={open} onOpenChange={setOpen} title={deal ? `Edit ${deal.name}` : "New deal"} dirty={formState.isDirty} submitting={formState.isSubmitting} onSubmit={onSubmit} submitLabel={deal ? "Save changes" : "Create deal"}>
        <TextField control={control} name="name" label="Deal name" />
        <ComboboxField control={control} name="company_id" label="Company" options={options.companies} placeholder="Choose company" />
        <ComboboxField
          control={control}
          name="primary_contact_id"
          label="Primary contact"
          options={options.contacts.filter((c) => c.company_id === companyId)}
          placeholder={companyId ? "No contact" : "Choose a company first"}
          disabled={!companyId}
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField control={control} name="amount" label="Amount" inputMode="decimal" className="sm:col-span-2" />
          <TextField control={control} name="currency" label="Currency" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField control={control} name="probability" label="Probability (%)" inputMode="numeric" hint={deal ? "Reset to the stage default when the stage changes." : "Leave empty to use the stage default."} />
          <DateField control={control} name="expected_close_date" label="Expected close" />
          <SelectField control={control} name="source" label="Source" options={LEAD_SOURCES.map((s) => ({ value: s, label: humanizeStatus(s) }))} />
          {options.owners.length > 0 && <SelectField control={control} name="owner_id" label="Owner" options={options.owners} />}
        </div>
        <TextField control={control} name="next_activity" label="Next activity" />
        <TextareaField control={control} name="notes" label="Notes" />
      </RecordSheet>
    </>
  );
}
