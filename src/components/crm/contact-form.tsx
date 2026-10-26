"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm, useWatch, type Resolver } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { ComboboxField, SelectField, TextField } from "@/components/forms/fields";
import { RecordSheet, useAutoOpen } from "@/components/forms/record-sheet";
import { Button } from "@/components/ui/button";
import type { Contact } from "@/domain/entities";
import { contactFields } from "@/domain/inputs";
import { applyServerErrors } from "@/lib/forms";
import { MESSENGER_CHANNELS, MESSENGERS, type MessengerChannel } from "@/lib/messengers";
import { createContactAction, updateContactAction } from "@/server/actions/crm";
import { tr } from "@/lib/i18n";
import { DuplicateWarning } from "./duplicate-warning";
import { CustomFieldsSection, customFormValues, type CustomFormValues } from "./custom-fields";
import type { CustomFieldDef } from "@/domain/custom-fields";

type Values = {
  company_id: string | null;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  job_title: string;
  tags: string;
  messengers: Record<MessengerChannel, string>;
  owner_id?: string;
  custom?: CustomFormValues;
};

const messengerDefaults = (m?: Contact["messengers"]) =>
  Object.fromEntries(MESSENGER_CHANNELS.map((c) => [c, m?.[c] ? (c === "telegram" && !m[c]!.startsWith("+") ? `@${m[c]}` : m[c]!) : ""])) as Record<MessengerChannel, string>;

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
  fields,
}: {
  /** Custom field definitions for contacts (Settings → Fields). */
  fields?: CustomFieldDef[];
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
  const defaults: Values = {
    ...(contact
    ? {
        company_id: contact.company_id,
        first_name: contact.first_name,
        last_name: contact.last_name,
        email: contact.email ?? "",
        phone: contact.phone ?? "",
        job_title: contact.job_title,
        tags: contact.tags.join(", "),
        messengers: messengerDefaults(contact.messengers),
        ...(owners.length > 0 && { owner_id: contact.owner_id }),
      }
    : { company_id: defaultCompanyId ?? null, first_name: "", last_name: "", email: "", phone: "", job_title: "", tags: "", messengers: messengerDefaults() }),
    ...(fields?.length ? { custom: customFormValues(fields, contact?.custom) } : {}),
  };
  const { control, handleSubmit, formState, setError, reset } = useForm<Values>({
    resolver: zodResolver(formSchema) as unknown as Resolver<Values>,
    defaultValues: defaults,
  });
  const [firstName, lastName, companyId, email, phone] = useWatch({ control, name: ["first_name", "last_name", "company_id", "email", "phone"] });

  const onSubmit = handleSubmit(async (values) => {
    const payload = { ...values, tags: toTags(values.tags) };
    const result = contact ? await updateContactAction({ id: contact.id, ...payload }) : await createContactAction(payload);
    if (!result.ok) return applyServerErrors(result, setError);
    toast.success(contact ? tr("Contact updated") : tr("Contact created"));
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
        {label ?? (contact ? tr("Edit") : tr("New contact"))}
      </Button>
      <RecordSheet
        error={formState.errors.root?.server?.message}
        open={open}
        onOpenChange={setOpen}
        title={contact ? tr("Edit {p0} {p1}", { p0: contact.first_name, p1: contact.last_name }) : tr("New contact")}
        dirty={formState.isDirty}
        submitting={formState.isSubmitting}
        onSubmit={onSubmit}
        submitLabel={contact ? tr("Save changes") : tr("Create contact")}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField control={control} name="first_name" label={tr("First name")} autoComplete="given-name" />
          <TextField control={control} name="last_name" label={tr("Last name")} autoComplete="family-name" />
        </div>
        <ComboboxField control={control} name="company_id" label={tr("Company")} options={companies} placeholder={tr("No company")} />
        <TextField control={control} name="job_title" label={tr("Job title")} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField control={control} name="email" label={tr("Email")} type="email" inputMode="email" autoComplete="email" />
          <TextField control={control} name="phone" label={tr("Phone")} type="tel" inputMode="tel" autoComplete="tel" />
        </div>
        {!contact && open && <DuplicateWarning probe={{ entity: "contact", first_name: firstName, last_name: lastName, company_id: companyId, email, phone }} />}
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">{tr("Messengers and social")}</legend>
          <p className="text-xs text-text-muted">{tr("Saved handles become one-click \"write\" links on the contact. Phone numbers in international format, e.g. +7 999 123-45-67.")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {MESSENGER_CHANNELS.map((c) => (
              <TextField key={c} control={control} name={`messengers.${c}`} label={MESSENGERS[c].label} placeholder={MESSENGERS[c].placeholder} autoComplete="off" />
            ))}
          </div>
        </fieldset>
        <CustomFieldsSection control={control} defs={fields} />
        <TextField control={control} name="tags" label={tr("Tags")} hint={tr("Comma-separated, up to 10. For example: decision-maker, technical")} />
        {owners.length > 0 && <SelectField control={control} name="owner_id" label={tr("Owner")} options={owners} />}
      </RecordSheet>
    </>
  );
}
