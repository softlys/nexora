"use client";

import { ShieldAlert, ShieldCheck } from "lucide-react";
import { useState, useTransition } from "react";
import { StatusBadge, type Tone } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { SecurityEvent } from "@/domain/entities";
import type { ChainVerification } from "@/domain/security/events";
import { formatDate, formatRelative } from "@/lib/format";
import { verifySecurityLogAction } from "@/server/actions/security";

type Row = SecurityEvent & { actor_label: string };

const SEVERITY_TONE: Record<SecurityEvent["severity"], Tone> = { info: "neutral", low: "info", medium: "warning", high: "danger" };

export function ChainStatus({ initial }: { initial: ChainVerification & { verified_at: string } }) {
  const [state, setState] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className={`flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between ${state.ok ? "border-success-border bg-success-bg" : "border-danger-border bg-danger-bg"}`} data-testid="chain-status">
      <div className="flex items-start gap-3">
        {state.ok ? <ShieldCheck className="mt-0.5 size-5 text-success" aria-hidden /> : <ShieldAlert className="mt-0.5 size-5 text-danger" aria-hidden />}
        <div className="text-sm">
          <p className={`font-medium ${state.ok ? "text-success" : "text-danger"}`}>{state.ok ? "Chain intact" : "Chain broken"}</p>
          <p className="text-text-subtle">
            {state.ok
              ? `${state.checked} events verified; last sequence ${state.lastSequence}.`
              : `${state.detail} Verified ${state.checked} events before the break (sequence ${state.failedAt}).`}{" "}
            Checked {formatRelative(state.verified_at)}.
          </p>
          {error && <p className="text-danger">{error}</p>}
        </div>
      </div>
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await verifySecurityLogAction({});
            if (!result.ok) setError(result.error);
            else {
              setError(null);
              setState(result.data);
            }
          })
        }
      >
        {pending ? "Verifying…" : "Verify now"}
      </Button>
    </div>
  );
}

export function SecurityEventsTable({ events }: { events: Row[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = events.find((e) => e.event_id === openId) ?? null;
  if (events.length === 0) return <p className="rounded-lg border border-dashed border-border-strong p-6 text-center text-sm text-text-muted">No security events match these filters.</p>;
  return (
    <>
      <div className="relative overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <caption className="sr-only">Security events</caption>
          <thead className="border-b border-border bg-surface-subtle text-xs text-text-muted">
            <tr>
              <th scope="col" className="h-9 px-3 text-right font-medium">#</th>
              <th scope="col" className="h-9 px-3 text-left font-medium">Time</th>
              <th scope="col" className="h-9 px-3 text-left font-medium">Action</th>
              <th scope="col" className="h-9 px-3 text-left font-medium">Severity</th>
              <th scope="col" className="hidden h-9 px-3 text-left font-medium md:table-cell">Actor</th>
              <th scope="col" className="hidden h-9 px-3 text-left font-medium lg:table-cell">Target</th>
              <th scope="col" className="hidden h-9 px-3 text-left font-medium lg:table-cell">Source IP</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr
                key={e.event_id}
                tabIndex={0}
                onClick={() => setOpenId(e.event_id)}
                onKeyDown={(k) => k.key === "Enter" && setOpenId(e.event_id)}
                className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-subtle focus-visible:bg-surface-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              >
                <td className="px-3 py-2 text-right text-text-muted tabular-nums">{e.sequence}</td>
                <td className="px-3 py-2 whitespace-nowrap text-text-subtle">
                  <time dateTime={e.occurred_at} title={formatDate(e.occurred_at)}>
                    {formatRelative(e.occurred_at)}
                  </time>
                </td>
                <td className="px-3 py-2">
                  <span className="font-mono text-xs">{e.action}</span>
                  {e.outcome === "failure" && <span className="ml-2 text-xs text-danger">failure</span>}
                </td>
                <td className="px-3 py-2">
                  <StatusBadge label={e.severity} tone={SEVERITY_TONE[e.severity]} />
                </td>
                <td className="hidden px-3 py-2 text-text-subtle md:table-cell">{e.actor_label}</td>
                <td className="hidden max-w-48 truncate px-3 py-2 text-text-subtle lg:table-cell">{e.target.type ? `${e.target.type}${e.target.id ? ` · ${e.target.id.slice(0, 8)}` : ""}` : "—"}</td>
                <td className="hidden px-3 py-2 font-mono text-xs text-text-subtle lg:table-cell">{e.source.ip ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Sheet open={open !== null} onOpenChange={(v) => !v && setOpenId(null)}>
        <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
          {open && (
            <>
              <SheetHeader className="border-b border-border px-5 py-4">
                <SheetTitle className="font-mono text-base">{open.action}</SheetTitle>
                <SheetDescription>
                  Sequence {open.sequence} · {formatDate(open.occurred_at)} · {open.category}
                </SheetDescription>
              </SheetHeader>
              <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
                <dl className="grid grid-cols-2 gap-3">
                  {[
                    ["Outcome", open.outcome],
                    ["Severity", open.severity],
                    ["Actor", open.actor_label],
                    ["Request id", open.source.request_id ?? "—"],
                    ["IP", open.source.ip ?? "—"],
                    ["Target", open.target.type ? `${open.target.type} ${open.target.id ?? ""}` : "—"],
                  ].map(([label, value]) => (
                    <div key={label} className="min-w-0">
                      <dt className="text-xs text-text-muted">{label}</dt>
                      <dd className="truncate">{value}</dd>
                    </div>
                  ))}
                </dl>
                <div>
                  <p className="mb-1 text-xs text-text-muted">Raw event</p>
                  <pre className="max-h-96 overflow-auto rounded bg-surface-muted p-2 font-mono text-[11px] whitespace-pre-wrap">{JSON.stringify(open, null, 2)}</pre>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
