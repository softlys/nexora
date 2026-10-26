"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm, type Resolver } from "react-hook-form";
import { toast } from "sonner";
import { ComboboxField, SelectField, TextareaField, TextField } from "@/components/forms/fields";
import { RecordSheet, useAutoOpen } from "@/components/forms/record-sheet";
import { humanizeStatus } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { COMPANY_SIZES, LIFECYCLE_STAGES, type Company } from "@/domain/entities";
import { companyInput } from "@/domain/inputs";
import { COUNTRY_OPTIONS } from "@/lib/countries";
import { applyServerErrors } from "@/lib/forms";
import { createCompanyAction, updateCompanyAction } from "@/server/actions/crm";
import { tr } from "@/lib/i18n";
import { CustomFieldsSection, customFormValues, type CustomFormValues } from "./custom-fields";
import type { CustomFieldDef } from "@/domain/custom-fields";

type Values = {
  name: string;
  website: string;
  industry: string;
  size: Company["size"];
  country: string;
  city: string;
  address: string;
  phone: string;
  lifecycle_stage: Company["lifecycle_stage"];
  notes: string;
  owner_id?: string;
  custom?: CustomFormValues;
};

const EMPTY: Values = { name: "", website: "", industry: "", size: "11-50", country: "US", city: "", address: "", phone: "", lifecycle_stage: "prospect", notes: "" };

export function CompanyFormButton({
  company,
  owners,
  variant = company ? "outline" : "default",
  autoOpen = false,
  fields,
}: {
  /** Custom field definitions for companies (Settings → Fields). */
  fields?: CustomFieldDef[];
  company?: Company;
  owners: Array<{ value: string; label: string }>;
  variant?: "default" | "outline";
  autoOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useAutoOpen(autoOpen);
  const defaults: Values = {
    ...(company
    ? {
        name: company.name,
        website: company.website ?? "",
        industry: company.industry,
        size: company.size,
        country: company.country,
        city: company.city,
        address: company.address,
        phone: company.phone ?? "",
        lifecycle_stage: company.lifecycle_stage,
        notes: company.notes,
        ...(owners.length > 0 && { owner_id: company.owner_id }),
      }
    : EMPTY),
    ...(fields?.length ? { custom: customFormValues(fields, company?.custom) } : {}),
  };
  const form = useForm<Values>({ resolver: zodResolver(companyInput) as unknown as Resolver<Values>, defaultValues: defaults });
  const { control, handleSubmit, formState, setError, reset } = form;

  const onSubmit = handleSubmit(async (values) => {
    const result = company ? await updateCompanyAction({ id: company.id, ...values }) : await createCompanyAction(values);
    if (!result.ok) return applyServerErrors(result, setError);
    toast.success(company ? tr("Company updated") : tr("Company created"));
    reset(values);
    setOpen(false);
    if (company) router.refresh();
    else router.push(`/companies/${result.data.id}`);
  });

  return (
    <>
      <Button
        variant={variant}
        onClick={() => {
          reset(defaults);
          setOpen(true);
        }}
      >
        {company ? <Pencil aria-hidden /> : <Plus aria-hidden />}
        {company ? tr("Edit") : tr("New company")}
      </Button>
      <RecordSheet
        error={formState.errors.root?.server?.message}
        open={open}
        onOpenChange={setOpen}
        title={company ? tr("Edit {p0}", { p0: company.name }) : tr("New company")}
        dirty={formState.isDirty}
        submitting={formState.isSubmitting}
        onSubmit={onSubmit}
        submitLabel={company ? tr("Save changes") : tr("Create company")}
      >
        <TextField control={control} name="name" label={tr("Name")} autoComplete="organization" />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField control={control} name="industry" label={tr("Industry")} placeholder={tr("e.g. Food Processing")} />
          <SelectField control={control} name="size" label={tr("Employees")} options={COMPANY_SIZES.map((s) => ({ value: s, label: s }))} />
          <ComboboxField control={control} name="country" label={tr("Country")} options={COUNTRY_OPTIONS} />
          <TextField control={control} name="city" label={tr("City")} />
        </div>
        <TextField control={control} name="address" label={tr("Address")} autoComplete="street-address" />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField control={control} name="website" label={tr("Website")} placeholder="https://" inputMode="url" />
          <TextField control={control} name="phone" label={tr("Phone")} type="tel" inputMode="tel" />
          <SelectField control={control} name="lifecycle_stage" label={tr("Lifecycle stage")} options={LIFECYCLE_STAGES.map((s) => ({ value: s, label: humanizeStatus(s) }))} />
          {owners.length > 0 && <SelectField control={control} name="owner_id" label={tr("Owner")} options={owners} />}
        </div>
        <CustomFieldsSection control={control} defs={fields} />
        <TextareaField control={control} name="notes" label={tr("Notes")} hint={tr("Plain text, visible to everyone who can see this company.")} />
      </RecordSheet>
    </>
  );
}
