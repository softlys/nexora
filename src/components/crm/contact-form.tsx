"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm, type Resolver } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ComboboxField, SelectField, TextField } from "@/components/forms/fields";
import { RecordSheet, useAutoOpen } from "@/components/forms/record-sheet";
import { Button } from "@/components/ui/button";
import type { Contact } from "@/domain/entities";
import { contactFields } from "@/domain/inputs";
import { applyServerErrors } from "@/lib/forms";
import { createContactAction, updateContactAction } from "@/server/actions/crm";

type Values = {
  company_id: string | null;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  job_title: string;
  tags: string;
  owner_id?: string;
};

/** Client-side mirror of the server schema; tags are typed as a comma-separated list. */
const formSchema = z.object({ ...contactFields, tags: z.string().max(400) });
const toTags = (value: string) => [...new Set(value.split(",").map((t) => t.trim()).filter(Boolean))].slice(0, 10);

export function ContactFormButton({
  contact,
  owners,
  companies,
  defaultCompanyId,
  variant = contact ? "outline" : "default",
  label,
  autoOpen = false,
}: {
  autoOpen?: boolean;
  contact?: Contact;
  owners: Array<{ value: string; label: string }>;
  companies: Array<{ value: string; label: string }>;
  defaultCompanyId?: string;
  variant?: "default" | "outline";
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useAutoOpen(autoOpen);
  const defaults: Values = contact
    ? {
        company_id: contact.company_id,
        first_name: contact.first_name,
        last_name: contact.last_name,
        email: contact.email ?? "",
        phone: contact.phone ?? "",
        job_title: contact.job_title,
        tags: contact.tags.join(", "),
        ...(owners.length > 0 && { owner_id: contact.owner_id }),
      }
    : { company_id: defaultCompanyId ?? null, first_name: "", last_name: "", email: "", phone: "", job_title: "", tags: "" };
  const { control, handleSubmit, formState, setError, reset } = useForm<Values>({
    resolver: zodResolver(formSchema) as unknown as Resolver<Values>,
    defaultValues: defaults,
  });

  const onSubmit = handleSubmit(async (values) => {
    const payload = { ...values, tags: toTags(values.tags) };
    const result = contact ? await updateContactAction({ id: contact.id, ...payload }) : await createContactAction(payload);
    if (!result.ok) return applyServerErrors(result, setError);
    toast.success(contact ? "Contact updated" : "Contact created");
    reset(values);
    setOpen(false);
    if (contact) router.refresh();
    else router.push(`/contacts/${result.data.id}`);
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
        {contact ? <Pencil aria-hidden /> : <Plus aria-hidden />}
        {label ?? (contact ? "Edit" : "New contact")}
      </Button>
      <RecordSheet
        error={formState.errors.root?.server?.message}
        open={open}
        onOpenChange={setOpen}
        title={contact ? `Edit ${contact.first_name} ${contact.last_name}` : "New contact"}
        dirty={formState.isDirty}
        submitting={formState.isSubmitting}
        onSubmit={onSubmit}
        submitLabel={contact ? "Save changes" : "Create contact"}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField control={control} name="first_name" label="First name" autoComplete="given-name" />
          <TextField control={control} name="last_name" label="Last name" autoComplete="family-name" />
        </div>
        <ComboboxField control={control} name="company_id" label="Company" options={companies} placeholder="No company" />
        <TextField control={control} name="job_title" label="Job title" />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField control={control} name="email" label="Email" type="email" inputMode="email" autoComplete="email" />
          <TextField control={control} name="phone" label="Phone" type="tel" inputMode="tel" autoComplete="tel" />
        </div>
        <TextField control={control} name="tags" label="Tags" hint="Comma-separated, up to 10. For example: decision-maker, technical" />
        {owners.length > 0 && <SelectField control={control} name="owner_id" label="Owner" options={owners} />}
      </RecordSheet>
    </>
  );
}
