"use client";

import { ArrowRightLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Combobox } from "@/components/patterns/combobox";
import { DatePicker } from "@/components/patterns/date-picker";
import { FormField } from "@/components/patterns/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { COMPANY_SIZES, type Lead } from "@/domain/entities";
import { COUNTRY_OPTIONS } from "@/lib/countries";
import { convertLeadAction } from "@/server/actions/crm";

type Option = { value: string; label: string };

/** Converts a lead into a deal: create or link a company and contact, then the deal in the first stage. */
export function ConvertLeadDialog({
  lead,
  companies,
  contacts,
}: {
  lead: Lead;
  companies: Option[];
  contacts: Array<Option & { company_id: string | null }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const matching = companies.find((c) => c.label.toLowerCase() === lead.company_name.toLowerCase());
  const [companyMode, setCompanyMode] = useState<"new" | "existing">(matching ? "existing" : "new");
  const [companyId, setCompanyId] = useState<string | null>(matching?.value ?? null);
  const [newCompany, setNewCompany] = useState({ name: lead.company_name, industry: "", size: "11-50", country: lead.country ?? "US" });
  const [contactMode, setContactMode] = useState<"new" | "existing" | "none">("new");
  const [contactId, setContactId] = useState<string | null>(null);
  const [deal, setDeal] = useState({ name: lead.title, amount: String(lead.estimated_value), close: null as string | null });

  const submit = () =>
    startTransition(async () => {
      setError(null);
      const result = await convertLeadAction({
        lead_id: lead.id,
        company: companyMode === "existing" ? { mode: "existing", company_id: companyId } : { mode: "new", ...newCompany },
        contact: contactMode === "existing" ? { mode: "existing", contact_id: contactId } : { mode: contactMode },
        deal: { name: deal.name, amount: deal.amount, expected_close_date: deal.close },
      });
      if (!result.ok) {
        setError(result.fieldErrors ? `${result.error} (${Object.keys(result.fieldErrors).join(", ")})` : result.error);
        return;
      }
      toast.success("Lead converted to a deal");
      setOpen(false);
      router.push(`/deals/${result.data.deal_id}`);
    });

  const companyContacts = contacts.filter((c) => companyMode === "existing" && c.company_id === companyId);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <ArrowRightLeft aria-hidden />
        Convert to deal
      </Button>
      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Convert lead to deal</DialogTitle>
            <DialogDescription>Creates the deal in the first pipeline stage. A lead can be converted only once.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-5 overflow-y-auto pr-1">
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">Company</legend>
              <Select value={companyMode} onValueChange={(v) => setCompanyMode(v as "new" | "existing")}>
                <SelectTrigger className="w-full" aria-label="Company source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">Create a new company</SelectItem>
                  <SelectItem value="existing" disabled={companies.length === 0}>
                    Link an existing company
                  </SelectItem>
                </SelectContent>
              </Select>
              {companyMode === "existing" ? (
                <Combobox options={companies} value={companyId} onChange={setCompanyId} placeholder="Choose company" />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField id="cv-name" label="Name" className="sm:col-span-2">
                    <Input id="cv-name" value={newCompany.name} onChange={(e) => setNewCompany({ ...newCompany, name: e.target.value })} />
                  </FormField>
                  <FormField id="cv-industry" label="Industry">
                    <Input id="cv-industry" value={newCompany.industry} onChange={(e) => setNewCompany({ ...newCompany, industry: e.target.value })} />
                  </FormField>
                  <FormField id="cv-size" label="Employees">
                    <Select value={newCompany.size} onValueChange={(v) => setNewCompany({ ...newCompany, size: v })}>
                      <SelectTrigger id="cv-size" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {COMPANY_SIZES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                  <FormField id="cv-country" label="Country" className="sm:col-span-2">
                    <Combobox id="cv-country" options={COUNTRY_OPTIONS} value={newCompany.country} onChange={(v) => setNewCompany({ ...newCompany, country: v ?? "US" })} />
                  </FormField>
                </div>
              )}
            </fieldset>
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">Contact</legend>
              <Select value={contactMode} onValueChange={(v) => setContactMode(v as "new" | "existing" | "none")}>
                <SelectTrigger className="w-full" aria-label="Contact source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">Create {lead.contact_name}</SelectItem>
                  <SelectItem value="existing" disabled={companyContacts.length === 0}>
                    Link an existing contact
                  </SelectItem>
                  <SelectItem value="none">No contact</SelectItem>
                </SelectContent>
              </Select>
              {contactMode === "existing" && <Combobox options={companyContacts} value={contactId} onChange={setContactId} placeholder="Choose contact" />}
            </fieldset>
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">Deal</legend>
              <FormField id="cv-deal" label="Deal name">
                <Input id="cv-deal" value={deal.name} onChange={(e) => setDeal({ ...deal, name: e.target.value })} />
              </FormField>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField id="cv-amount" label="Amount">
                  <Input id="cv-amount" inputMode="decimal" value={deal.amount} onChange={(e) => setDeal({ ...deal, amount: e.target.value })} />
                </FormField>
                <FormField id="cv-close" label="Expected close">
                  <DatePicker id="cv-close" value={deal.close} onChange={(v) => setDeal({ ...deal, close: v })} />
                </FormField>
              </div>
            </fieldset>
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending ? "Converting…" : "Convert"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
