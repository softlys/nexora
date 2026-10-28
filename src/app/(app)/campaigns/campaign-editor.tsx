"use client";

import { Plus, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { FormField } from "@/components/patterns/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { previewSegmentAction, saveCampaignAction, sendCampaignAction } from "@/server/actions/campaigns";

type Option = { value: string; label: string };
type Segment = { tags: string[]; lifecycle: string[]; countries: string[]; owner_ids: string[] };

function Chips({ label, options, value, onChange }: { label: string; options: Option[]; value: string[]; onChange: (v: string[]) => void }) {
  if (!options.length) return null;
  return (
    <fieldset className="space-y-1">
      <legend className="text-xs text-text-muted">{label}</legend>
      <div className="flex flex-wrap gap-1">
        {options.map((o) => {
          const on = value.includes(o.value);
          return (
            <button key={o.value} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])} className={cn("rounded-full border px-2.5 py-0.5 text-xs", on ? "border-brand bg-brand/10 text-foreground" : "border-border text-text-subtle hover:bg-surface-subtle")}>
              {o.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** New mailing: channel, segment with a live count, subject and text with variables. */
export function NewCampaignButton({ tags, lifecycle, countries, owners }: { tags: Option[]; lifecycle: Option[]; countries: Option[]; owners: Option[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [channel, setChannel] = useState<"email" | "sms">("email");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [segment, setSegment] = useState<Segment>({ tags: [], lifecycle: [], countries: [], owner_ids: [] });
  const [preview, setPreview] = useState<{ reachable: number; skipped: number; sample: string[] } | null>(null);
  const [pending, start] = useTransition();
  const key = JSON.stringify({ segment, channel });

  useEffect(() => {
    if (!open) return;
    let live = true;
    const timer = setTimeout(async () => {
      const r = await previewSegmentAction({ segment, channel });
      if (live && r.ok) setPreview(r.data);
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, open]);

  const save = () =>
    start(async () => {
      const r = await saveCampaignAction({ name, channel, subject, body, segment });
      if (!r.ok) return void toast.error(r.fieldErrors ? Object.values(r.fieldErrors)[0]?.[0] ?? r.error : r.error);
      toast.success(tr("Mailing saved as a draft"));
      setOpen(false);
      router.refresh();
    });

  return (
    <>
      <Button onClick={() => setOpen(true)} data-testid="new-campaign">
        <Plus aria-hidden />
        {tr("New mailing")}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{tr("New mailing")}</DialogTitle>
            <DialogDescription>{tr("Contacts tagged “unsubscribed” never receive mailings; every e-mail has an unsubscribe link.")}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
              <FormField id="campaign-name" label={tr("Name")}>
                <Input id="campaign-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={tr("e.g. Autumn price list")} />
              </FormField>
              <div className="flex items-end gap-1" role="radiogroup" aria-label={tr("Channel")}>
                {(["email", "sms"] as const).map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={channel === c} onClick={() => setChannel(c)} className={cn("h-9 rounded-md border px-3 text-sm", channel === c ? "border-brand bg-brand/10 font-medium" : "border-border")}>
                    {c === "email" ? "E-mail" : "SMS"}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-3 rounded-md border border-border p-3">
              <p className="text-sm font-medium">{tr("Who gets it")}</p>
              <Chips label={tr("Contact tags (any)")} options={tags} value={segment.tags} onChange={(v) => setSegment((s) => ({ ...s, tags: v }))} />
              <Chips label={tr("Company lifecycle stage")} options={lifecycle} value={segment.lifecycle} onChange={(v) => setSegment((s) => ({ ...s, lifecycle: v }))} />
              <Chips label={tr("Company country")} options={countries} value={segment.countries} onChange={(v) => setSegment((s) => ({ ...s, countries: v }))} />
              <Chips label={tr("Owner")} options={owners} value={segment.owner_ids} onChange={(v) => setSegment((s) => ({ ...s, owner_ids: v }))} />
              <p className="text-sm" data-testid="segment-count">
                {preview ? tr("Reaches {p0} contacts", { p0: preview.reachable }) : tr("Counting…")}
                {preview && preview.skipped > 0 && <span className="text-text-muted"> · {tr("{p0} without an address or number", { p0: preview.skipped })}</span>}
                {preview && preview.sample.length > 0 && <span className="block text-xs text-text-muted">{preview.sample.join(", ")}…</span>}
              </p>
            </div>
            {channel === "email" && (
              <FormField id="campaign-subject" label={tr("Subject")}>
                <Input id="campaign-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
              </FormField>
            )}
            <FormField id="campaign-body" label={tr("Message")} hint={tr("Variables: {{contact.first_name}}, {{contact.full_name}}, {{company.name}}, {{me.name}}.")}>
              <Textarea id="campaign-body" value={body} onChange={(e) => setBody(e.target.value)} rows={channel === "sms" ? 3 : 8} maxLength={channel === "sms" ? 1000 : 10000} />
            </FormField>
            {channel === "sms" && <p className="text-xs text-text-muted">{tr("{p0} characters; one SMS holds 70 Cyrillic characters.", { p0: body.length })}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                {tr("Cancel")}
              </Button>
              <Button type="submit" disabled={pending || !name.trim() || !body.trim() || (channel === "email" && !subject.trim())} data-testid="save-campaign">
                {tr("Save draft")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function SendCampaignButton({ id, name, simulateNote }: { id: string; name: string; simulateNote: string | null }) {
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm" data-testid={`send-campaign-${id}`}>
          <Send aria-hidden />
          {tr("Send")}
        </Button>
      }
      title={tr("Send “{p0}”?", { p0: name })}
      description={simulateNote ?? tr("The mailing goes out now to every contact of the segment. It cannot be recalled.")}
      confirmLabel={tr("Send")}
      onConfirm={async () => {
        const r = await sendCampaignAction({ id });
        if (!r.ok) {
          toast.error(r.error);
          return false;
        }
        toast.success(r.data.simulated ? tr("Simulated: {p0} recipients", { p0: r.data.sent }) : tr("Sent: {p0}, failed: {p1}", { p0: r.data.sent, p1: r.data.failed }));
        router.refresh();
      }}
    />
  );
}
