"use client";

import { Copy, Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FormField } from "@/components/patterns/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { WEB_FORM_FIELDS, type WebFormField } from "@/domain/entities";
import { tr } from "@/lib/i18n";
import { saveWebFormAction } from "@/server/actions/web-forms";

type Mode = "off" | "optional" | "required";
export type FormDraft = { id?: string; name: string; title: string; button_text: string; success_text: string; fields: Record<WebFormField, Mode>; owner_id: string | null; is_active: boolean };

const FIELD_LABELS: Record<WebFormField, string> = { phone: "Phone", email: "E-mail", company: "Company", message: "Message" };
const MODE_LABELS: Record<Mode, string> = { off: "Not asked", optional: "Optional", required: "Required" };
const NOBODY = "none";

const blank = (): FormDraft => ({
  name: tr("Request from the website"),
  title: tr("Get a quote"),
  button_text: tr("Send"),
  success_text: tr("Thank you! A manager will contact you shortly."),
  fields: { phone: "required", email: "optional", company: "optional", message: "optional" },
  owner_id: null,
  is_active: true,
});

/** Add a form or edit one. */
export function WebFormButton({ form, users }: { form?: FormDraft; users: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FormDraft>(blank);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof FormDraft>(k: K, v: FormDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const text = (k: "name" | "title" | "button_text" | "success_text", label: string, max: number) => (
    <FormField id={`form-${k}`} label={label}>
      <Input id={`form-${k}`} value={draft[k]} onChange={(e) => set(k, e.target.value)} maxLength={max} required />
    </FormField>
  );

  const save = () =>
    start(async () => {
      const r = await saveWebFormAction(draft);
      if (!r.ok) return void setError(r.fieldErrors?.fields?.[0] ?? r.error);
      toast.success(form ? tr("Form saved") : tr("Form added"));
      setOpen(false);
      router.refresh();
    });

  return (
    <>
      <Button
        variant={form ? "ghost" : "default"}
        size={form ? "sm" : "default"}
        aria-label={form ? tr("Edit {p0}", { p0: form.name }) : undefined}
        data-testid={form ? `edit-form-${form.id}` : "new-form"}
        onClick={() => {
          setDraft(form ?? blank());
          setError(null);
          setOpen(true);
        }}
      >
        {form ? <Pencil aria-hidden /> : <Plus aria-hidden />}
        {form ? null : tr("New form")}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{form ? tr("Edit form") : tr("New form")}</DialogTitle>
            <DialogDescription>{tr("The visitor's name is always asked. Each submission becomes a lead.")}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            {text("name", tr("Name (only in NEXORA)"), 120)}
            {text("title", tr("Heading on the form"), 160)}
            <div className="grid gap-4 sm:grid-cols-2">
              {text("button_text", tr("Button"), 60)}
              <FormField id="form-owner" label={tr("Leads go to")}>
                <Select value={draft.owner_id ?? NOBODY} onValueChange={(v) => set("owner_id", v === NOBODY ? null : v)}>
                  <SelectTrigger id="form-owner">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NOBODY}>{tr("Nobody (admins and managers are notified)")}</SelectItem>
                    {users.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            </div>
            {text("success_text", tr("Thank-you text"), 500)}
            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="mb-2 text-sm font-medium">{tr("Fields")}</legend>
              {WEB_FORM_FIELDS.map((f) => (
                <label key={f} className="flex items-center justify-between gap-2 text-sm">
                  {tr(FIELD_LABELS[f])}
                  <Select value={draft.fields[f]} onValueChange={(v) => set("fields", { ...draft.fields, [f]: v as Mode })}>
                    <SelectTrigger size="sm" className="w-36" aria-label={tr(FIELD_LABELS[f])}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
                        <SelectItem key={m} value={m}>
                          {tr(MODE_LABELS[m])}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              ))}
            </fieldset>
            <label className="flex items-center gap-3 text-sm">
              <Switch checked={draft.is_active} onCheckedChange={(v) => set("is_active", v)} />
              {tr("The form accepts submissions")}
            </label>
            {error && <p className="text-sm text-danger">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                {tr("Cancel")}
              </Button>
              <Button type="submit" disabled={pending} data-testid="save-form">
                {pending ? tr("Saving…") : tr("Save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The code to paste on the website, with a copy button. */
export function EmbedCode({ code }: { code: string }) {
  return (
    <div className="flex items-start gap-2">
      <code className="min-w-0 flex-1 rounded-md border border-border bg-surface-subtle p-2 font-mono text-xs break-all">{code}</code>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          void navigator.clipboard?.writeText(code);
          toast.success(tr("Code copied: paste it into your website"));
        }}
      >
        <Copy aria-hidden />
        {tr("Copy")}
      </Button>
    </div>
  );
}
