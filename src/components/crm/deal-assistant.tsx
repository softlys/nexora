"use client";

import { Copy, Mail, Sparkles, Video } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { dealAssistAction, dealMeetingAction } from "@/server/actions/crm";

/** AI summary and email draft for a deal (YandexGPT or Claude, whichever the server is configured with). */
export function DealAssistant({ dealId, provider }: { dealId: string; provider: string | null }) {
  const [language, setLanguage] = useState<"ru" | "en">("ru");
  const [result, setResult] = useState<{ kind: "summary" | "email"; text: string } | null>(null);
  const [pending, start] = useTransition();
  if (!provider) {
    return <p className="text-sm text-text-muted">Not configured. Add YandexGPT or Claude keys on the server (Integrations → AI assistant) to get deal summaries and email drafts.</p>;
  }
  const run = (kind: "summary" | "email") =>
    start(async () => {
      const r = await dealAssistAction({ deal_id: dealId, kind, language });
      if (!r.ok) return void toast.error(r.error);
      setResult({ kind, text: r.data.text });
    });
  return (
    <div className="space-y-3" data-testid="deal-assistant">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => run("summary")} disabled={pending}>
          <Sparkles aria-hidden />
          Summary and next steps
        </Button>
        <Button size="sm" variant="outline" onClick={() => run("email")} disabled={pending}>
          <Mail aria-hidden />
          Draft email
        </Button>
        <div className="ml-auto flex overflow-hidden rounded-md border border-border text-xs" role="group" aria-label="Answer language">
          {(["ru", "en"] as const).map((l) => (
            <button key={l} type="button" onClick={() => setLanguage(l)} aria-pressed={language === l} className={language === l ? "bg-surface-muted px-2 py-1 font-medium" : "px-2 py-1 text-text-muted"}>
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      {pending && <p className="text-sm text-text-muted">{provider} is thinking…</p>}
      {result && !pending && (
        <div className="space-y-2 rounded-md border border-border bg-surface-subtle p-3">
          <p className="text-sm whitespace-pre-wrap" data-testid="deal-assistant-result">
            {result.text}
          </p>
          <div className="flex items-center justify-between gap-2 text-xs text-text-muted">
            <span>{provider} · check before you use it</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void navigator.clipboard?.writeText(result.text);
                toast.success("Copied");
              }}
            >
              <Copy aria-hidden />
              Copy
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Creates a Yandex Telemost meeting for the deal; the link is logged on the timeline. */
export function DealMeetingButton({ dealId }: { dealId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await dealMeetingAction({ deal_id: dealId });
            if (!r.ok) return void toast.error(r.error);
            setUrl(r.data.url);
          })
        }
      >
        <Video aria-hidden />
        {pending ? "Creating…" : "Create Telemost meeting"}
      </Button>
      {url && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-surface-subtle p-2 text-xs">
          <a href={url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate font-mono text-brand hover:underline">
            {url}
          </a>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void navigator.clipboard?.writeText(url);
              toast.success("Link copied");
            }}
            aria-label="Copy meeting link"
          >
            <Copy aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}
