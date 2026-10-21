"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm, type Resolver } from "react-hook-form";
import { toast } from "sonner";
import { ComboboxField, SelectField, TextField } from "@/components/forms/fields";
import { RecordSheet, useAutoOpen } from "@/components/forms/record-sheet";
import { humanizeStatus } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { LEAD_QUALIFICATIONS, LEAD_SOURCES, type Lead } from "@/domain/entities";
import { leadInput } from "@/domain/inputs";
import { COUNTRY_OPTIONS } from "@/lib/countries";
import { applyServerErrors } from "@/lib/forms";
import { createLeadAction, updateLeadAction } from "@/server/actions/crm";

type Values = {
  title: string;
  company_name: string;
  contact_name: string;
  email: string;
  phone: string;
  country: string | null;
  source: Lead["source"];
  status: Exclude<Lead["status"], "converted">;
  qualification: Lead["qualification"];
  next_action: string;
  next_action_at: string;
  estimated_value: string;
  owner_id?: string | null;
};

const toDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const fromDateInput = (value: string) => (value ? new Date(`${value}T09:00:00Z`).toISOString() : null);

const AUTO = "__auto";

export function LeadFormButton({ lead, owners, variant = lead ? "outline" : "default", autoOpen = false }: { lead?: Lead; owners: Array<{ value: string; label: string }>; variant?: "default" | "outline"; autoOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useAutoOpen(autoOpen);
  const defaults: Values = lead
    ? {
        title: lead.title,
        company_name: lead.company_name,
        contact_name: lead.contact_name,
        email: lead.email ?? "",
        phone: lead.phone ?? "",
        country: lead.country,
        source: lead.source,
        status: lead.status === "converted" ? "qualified" : lead.status,
        qualification: lead.qualification,
        next_action: lead.next_action,
        next_action_at: toDateInput(lead.next_action_at),
        estimated_value: String(lead.estimated_value),
        ...(owners.length > 0 && { owner_id: lead.owner_id }),
      }
    : {
        title: "",
        company_name: "",
        contact_name: "",
        email: "",
        phone: "",
        country: null,
        source: "website",
        status: "new",
        qualification: "warm",
        next_action: "",
        next_action_at: "",
        estimated_value: "0",
        // Admins and managers can leave a new lead unassigned so the New lead automation routes it.
        ...(owners.length > 0 && { owner_id: AUTO }),
      };
  const ownerOptions = lead ? owners : [{ value: AUTO, label: "Unassigned (route automatically)" }, ...owners];
  const toPayloadOwner = (v: string | null | undefined) => (v === AUTO ? null : v);

  const resolver = zodResolver(leadInput) as unknown as Resolver<Values>;
  const { control, handleSubmit, formState, setError, reset } = useForm<Values>({
    resolver: async (values, ctx, options) => {
      const result = await resolver({ ...values, owner_id: toPayloadOwner(values.owner_id), next_action_at: fromDateInput(values.next_action_at) as unknown as string }, ctx, options);
      // Keep the form's own values (the "automatic" owner placeholder) on success.
      return Object.keys(result.errors).length ? result : { values, errors: {} };
    },
    defaultValues: defaults,
  });

  const onSubmit = handleSubmit(async (values) => {
    const payload = { ...values, ...(values.owner_id !== undefined && { owner_id: toPayloadOwner(values.owner_id) }), next_action_at: fromDateInput(values.next_action_at) };
    const result = lead ? await updateLeadAction({ id: lead.id, ...payload }) : await createLeadAction(payload);
    if (!result.ok) return applyServerErrors(result, setError);
    toast.success(lead ? "Lead updated" : "Lead created");
    reset(values);
    setOpen(false);
    if (lead) router.refresh();
    else router.push(`/leads/${result.data.id}`);
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
        {lead ? <Pencil aria-hidden /> : <Plus aria-hidden />}
        {lead ? "Edit" : "New lead"}
      </Button>
      <RecordSheet error={formState.errors.root?.server?.message} open={open} onOpenChange={setOpen} title={lead ? "Edit lead" : "New lead"} dirty={formState.isDirty} submitting={formState.isSubmitting} onSubmit={onSubmit} submitLabel={lead ? "Save changes" : "Create lead"}>
        <TextField control={control} name="title" label="Title" placeholder="e.g. Compressor replacement inquiry" />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField control={control} name="company_name" label="Company" />
          <TextField control={control} name="contact_name" label="Contact name" />
          <TextField control={control} name="email" label="Email" type="email" inputMode="email" />
          <TextField control={control} name="phone" label="Phone" type="tel" inputMode="tel" />
          <ComboboxField control={control} name="country" label="Country" options={COUNTRY_OPTIONS} placeholder="Unknown" />
          <SelectField control={control} name="source" label="Source" options={LEAD_SOURCES.map((s) => ({ value: s, label: humanizeStatus(s) }))} />
          <SelectField control={control} name="status" label="Status" options={(["new", "contacted", "qualified", "unqualified"] as const).map((s) => ({ value: s, label: humanizeStatus(s) }))} />
          <SelectField control={control} name="qualification" label="Qualification" options={LEAD_QUALIFICATIONS.map((s) => ({ value: s, label: humanizeStatus(s) }))} />
          <TextField control={control} name="estimated_value" label="Estimated value" inputMode="decimal" />
          {owners.length > 0 && <SelectField control={control} name="owner_id" label="Owner" options={ownerOptions} />}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField control={control} name="next_action" label="Next action" />
          <TextField control={control} name="next_action_at" label="Next action date" type="date" />
        </div>
      </RecordSheet>
    </>
  );
}
