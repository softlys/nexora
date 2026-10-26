"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { EntityType } from "@/domain/entities";
import { addCommentAction, logActivityAction } from "@/server/actions/crm";
import { tr, trNode } from "@/lib/i18n";

type Links = Partial<Record<"company_id" | "contact_id" | "deal_id" | "order_id" | "lead_id", string>>;

const TYPES = [
  ["call", tr("Call")],
  ["meeting", tr("Meeting")],
  ["email", tr("Email")],
  ["note", tr("Note")],
  ["follow_up", tr("Follow-up")],
] as const;

/** Log a call, meeting, email, note or follow-up on a record. */
export function ActivityComposer({ links }: { links: Links }) {
  const router = useRouter();
  const [type, setType] = useState<(typeof TYPES)[number][0]>("call");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      setError(null);
      const result = await logActivityAction({
        type,
        subject,
        body,
        occurred_at: null,
        company_id: links.company_id ?? null,
        contact_id: links.contact_id ?? null,
        lead_id: links.lead_id ?? null,
        deal_id: links.deal_id ?? null,
        order_id: links.order_id ?? null,
      });
      if (!result.ok) {
        setError(result.fieldErrors?.subject?.[0] ?? result.error);
        return;
      }
      setSubject("");
      setBody("");
      toast.success(tr("Activity logged"));
      router.refresh();
    });

  return (
    <form
      className="space-y-2 rounded-lg border border-border bg-surface-subtle p-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      aria-label={tr("Log activity")}
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
          <SelectTrigger className="sm:w-36" aria-label={tr("Activity type")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TYPES.map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {trNode(label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={tr("Summary, e.g. Discussed delivery dates")} aria-label={tr("Activity summary")} maxLength={200} aria-invalid={!!error} />
      </div>
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={tr("Details (optional)")} aria-label={tr("Activity details")} rows={2} maxLength={5000} />
      <div className="flex items-center justify-between gap-2">
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
        <Button type="submit" size="sm" disabled={pending || !subject.trim()}>
          {pending ? tr("Saving…") : tr("Log activity")}
        </Button>
      </div>
    </form>
  );
}

/** Plain-text comment box. */
export function CommentComposer({ entityType, entityId }: { entityType: EntityType; entityId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="space-y-2"
      aria-label={tr("Add comment")}
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await addCommentAction({ entity_type: entityType, entity_id: entityId, body });
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          setBody("");
          toast.success(tr("Comment added"));
          router.refresh();
        });
      }}
    >
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={tr("Write a comment…")} aria-label={tr("Comment")} rows={2} maxLength={5000} />
      <div className="flex justify-end">
        <Button type="submit" size="sm" variant="outline" disabled={pending || !body.trim()}>
          {pending ? tr("Posting…") : tr("Comment")}
        </Button>
      </div>
    </form>
  );
}
