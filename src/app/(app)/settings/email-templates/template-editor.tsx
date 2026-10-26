"use client";

import { Archive, Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { FormField } from "@/components/patterns/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EMAIL_TEMPLATE_VARIABLES } from "@/domain/email-templates";
import { tr } from "@/lib/i18n";
import { archiveEmailTemplateAction, saveEmailTemplateAction } from "@/server/actions/email";

type Template = { id: string; name: string; subject: string; body: string };

/** Add a template or edit one. */
export function TemplateButton({ template }: { template?: Template }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      const r = await saveEmailTemplateAction({ ...(template && { id: template.id }), name, subject, body });
      if (!r.ok) return void setErrors({ name: r.fieldErrors?.name?.[0] ?? "", subject: r.fieldErrors?.subject?.[0] ?? "", body: r.fieldErrors?.body?.[0] ?? "", _form: r.fieldErrors ? "" : r.error });
      toast.success(template ? tr("Template updated") : tr("Template added"));
      setOpen(false);
      router.refresh();
    });

  return (
    <>
      <Button
        variant={template ? "ghost" : "default"}
        size={template ? "sm" : "default"}
        aria-label={template ? tr("Edit {p0}", { p0: template.name }) : undefined}
        data-testid={template ? `edit-template-${template.id}` : "new-template"}
        onClick={() => {
          setName(template?.name ?? "");
          setSubject(template?.subject ?? "");
          setBody(template?.body ?? "");
          setErrors({});
          setOpen(true);
        }}
      >
        {template ? <Pencil aria-hidden /> : <Plus aria-hidden />}
        {template ? null : tr("New template")}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{template ? tr("Edit template") : tr("New template")}</DialogTitle>
            <DialogDescription>{tr("Variables are filled in from the record when the template is chosen; the text can still be edited before sending.")}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <FormField id="template-name" label={tr("Name")} error={errors.name || undefined}>
              <Input id="template-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoFocus />
            </FormField>
            <FormField id="template-subject" label={tr("Subject")} error={errors.subject || undefined}>
              <Input id="template-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} required />
            </FormField>
            <FormField id="template-body" label={tr("Message")} error={errors.body || undefined}>
              <Textarea id="template-body" value={body} onChange={(e) => setBody(e.target.value)} rows={10} maxLength={10000} required />
            </FormField>
            <p className="text-xs text-text-muted">
              {tr("Variables:")} {EMAIL_TEMPLATE_VARIABLES.map((v) => <code key={v} className="mr-1.5 inline-block font-mono">{`{{${v}}}`}</code>)}
            </p>
            {errors._form && <p className="text-sm text-danger">{errors._form}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                {tr("Cancel")}
              </Button>
              <Button type="submit" disabled={pending || !name.trim() || !subject.trim() || !body.trim()}>
                {pending ? tr("Saving…") : tr("Save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ArchiveTemplateButton({ template }: { template: Template }) {
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm" variant="ghost" aria-label={tr("Remove {p0}", { p0: template.name })}>
          <Archive aria-hidden />
        </Button>
      }
      title={tr("Remove the template {p0}?", { p0: template.name })}
      description={tr("It is no longer offered when writing e-mails. E-mails already sent stay on the timelines.")}
      confirmLabel={tr("Remove template")}
      destructive
      onConfirm={async () => {
        const r = await archiveEmailTemplateAction({ id: template.id });
        if (!r.ok) {
          toast.error(r.error);
          return false;
        }
        toast.success(tr("Template removed"));
        router.refresh();
      }}
    />
  );
}
