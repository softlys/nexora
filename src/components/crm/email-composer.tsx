"use client";

import { Mail, Send, SquareArrowOutUpRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FormField } from "@/components/patterns/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { renderEmail } from "@/domain/email-templates";
import { tr } from "@/lib/i18n";
import { sendEmailAction } from "@/server/actions/email";
import type { EmailComposer } from "@/server/services/email";

const NONE = "__none";

/**
 * "Write e-mail" on a record page: pick a recipient and a template, edit the text, then send it
 * through the configured provider (logged on the timeline) or open it in the user's mail app.
 */
/** Without `reply`, a "Write e-mail" button; with it, a small "Reply" button for a thread. */
export function EmailComposerButton({ composer, reply }: { composer: EmailComposer; reply?: { to: string | null; subject: string; inReplyTo: string | null } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(composer.recipients[0]?.email ?? "");
  const [template, setTemplate] = useState(NONE);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  const recipient = composer.recipients.find((r) => r.email === to);
  const choose = (id: string) => {
    setTemplate(id);
    const t = composer.templates.find((x) => x.id === id);
    if (!t) return;
    // Variables of the chosen recipient when it is another contact of the company.
    const vars = recipient && recipient.contact_id !== composer.links.contact_id ? { ...composer.vars, "contact.first_name": recipient.label.split(" ")[0] ?? "", "contact.full_name": recipient.label } : composer.vars;
    setSubject(renderEmail(t.subject, vars));
    setBody(renderEmail(t.body, vars));
  };
  const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const send = () =>
    start(async () => {
      const r = await sendEmailAction({ to, subject, body, ...composer.links, contact_id: recipient?.contact_id ?? composer.links.contact_id, ...(reply?.inReplyTo && { in_reply_to: reply.inReplyTo }) });
      if (!r.ok) {
        setErrors({ to: r.fieldErrors?.to?.[0] ?? "", subject: r.fieldErrors?.subject?.[0] ?? "", body: r.fieldErrors?.body?.[0] ?? "", _form: r.fieldErrors ? "" : r.error });
        return;
      }
      toast.success(tr("E-mail sent to {p0}", { p0: to }));
      setOpen(false);
      router.refresh();
    });

  return (
    <>
      <Button
        variant={reply ? "ghost" : "outline"}
        size={reply ? "sm" : "default"}
        onClick={() => {
          setErrors({});
          if (reply) {
            if (reply.to) setTo(reply.to);
            setSubject(/^re:/i.test(reply.subject) ? reply.subject : `Re: ${reply.subject}`);
          }
          setOpen(true);
        }}
        data-testid={reply ? "reply-email" : "write-email"}
      >
        <Mail aria-hidden />
        {reply ? tr("Reply to e-mail") : tr("Write e-mail")}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{tr("New e-mail")}</DialogTitle>
            <DialogDescription>
              {composer.configured ? tr("Replies come to your own address. The e-mail is saved on the timeline.") : tr("E-mail sending is not set up yet: the e-mail opens in your mail app instead.")}
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (composer.configured) send();
              else window.location.href = mailto;
            }}
          >
            <FormField id="email-to" label={tr("Recipient")} error={errors.to || undefined}>
              <Input id="email-to" type="email" list="email-recipients" value={to} onChange={(e) => setTo(e.target.value)} required autoComplete="off" />
              <datalist id="email-recipients">
                {composer.recipients.map((r) => (
                  <option key={r.email} value={r.email}>
                    {r.label}
                  </option>
                ))}
              </datalist>
            </FormField>
            {composer.templates.length > 0 && (
              <FormField id="email-template" label={tr("Template")}>
                <Select value={template} onValueChange={choose}>
                  <SelectTrigger id="email-template" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{tr("No template")}</SelectItem>
                    {composer.templates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
            <FormField id="email-subject" label={tr("Subject")} error={errors.subject || undefined}>
              <Input id="email-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} required />
            </FormField>
            <FormField id="email-body" label={tr("Message")} error={errors.body || undefined}>
              <Textarea id="email-body" value={body} onChange={(e) => setBody(e.target.value)} rows={10} maxLength={10000} required />
            </FormField>
            {errors._form && <p className="text-sm text-danger">{errors._form}</p>}
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" asChild>
                <a href={mailto} onClick={() => setOpen(false)}>
                  <SquareArrowOutUpRight aria-hidden />
                  {tr("Open in mail app")}
                </a>
              </Button>
              {composer.configured && (
                <Button type="submit" disabled={pending || !to || !subject.trim() || !body.trim()}>
                  <Send aria-hidden />
                  {pending ? tr("Sending…") : tr("Send")}
                </Button>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
