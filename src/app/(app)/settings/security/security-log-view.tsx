"use client";

import { CheckCircle2, CircleDashed, Link as LinkIcon, ShieldAlert, ShieldCheck, XCircle } from "lucide-react";
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

type Link = { sequence: number; hash: string; prev_hash: string };

const STEPS = [
  { key: "schema_invalid", title: "Schema check", detail: "Every entry matches the security event schema" },
  { key: "sequence_gap", title: "Sequence check", detail: "Sequence numbers run 1, 2, 3… with no gaps" },
  { key: "prev_hash_mismatch", title: "Link verification", detail: "Each prev_hash equals the previous entry's hash" },
  { key: "hash_mismatch", title: "Hash validation", detail: "SHA-256 of each entry's content matches its hash" },
] as const;

const short = (h: string) => `sha256:${h.slice(0, 8)}`;

/**
 * Chain integrity: the verification steps with their result, and the most recent links of the
 * chain. Verification runs on the server over the whole log ("Verify now" re-runs it).
 */
export function ChainStatus({ initial, recent }: { initial: ChainVerification & { verified_at: string }; recent: Link[] }) {
  const [state, setState] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const failedStep = state.ok ? -1 : STEPS.findIndex((s) => s.key === state.reason);
  const links = [...recent].sort((a, b) => a.sequence - b.sequence).slice(-3);
  const valid = (seq: number) => state.ok || seq < state.failedAt;
  const steps = [...STEPS, { key: "tamper", title: "Tamper detection", detail: "No entry was changed, removed or inserted" }];
  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="chain-status">
      <section className="rounded-xl border border-border bg-surface p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className={`flex size-10 items-center justify-center rounded-xl ${state.ok ? "bg-success-bg text-success" : "bg-danger-bg text-danger"}`}>
              {state.ok ? <ShieldCheck className="size-5" aria-hidden /> : <ShieldAlert className="size-5" aria-hidden />}
            </span>
            <div>
              <h3 className="text-base font-semibold">Chain integrity</h3>
              <p className="text-xs text-text-muted">
                {steps.length}-step validation · checked {formatRelative(state.verified_at)}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
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
        <ol className="mt-4 space-y-2">
          {steps.map((step, i) => {
            const last = i === steps.length - 1;
            const status = state.ok ? "pass" : i === failedStep || last ? "fail" : i < failedStep ? "pass" : "stopped";
            return (
              <li key={step.key} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-subtle px-3 py-2">
                <span className="flex min-w-0 items-center gap-2.5">
                  {status === "pass" ? (
                    <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden />
                  ) : status === "fail" ? (
                    <XCircle className="size-5 shrink-0 text-danger" aria-hidden />
                  ) : (
                    <CircleDashed className="size-5 shrink-0 text-text-muted" aria-hidden />
                  )}
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{step.title}</span>
                    <span className="block truncate text-xs text-text-muted">{step.detail}</span>
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ${status === "pass" ? "bg-success-bg text-success ring-1 ring-success-border" : status === "fail" ? "bg-danger-bg text-danger ring-1 ring-danger-border" : "bg-surface-muted text-text-muted"}`}
                >
                  {status === "pass" ? "PASS" : status === "fail" ? "FAIL" : "NOT REACHED"}
                </span>
              </li>
            );
          })}
        </ol>
        <div className={`mt-4 rounded-lg border p-3 text-sm ${state.ok ? "border-success-border bg-success-bg" : "border-danger-border bg-danger-bg"}`}>
          <p className={`font-semibold ${state.ok ? "text-success" : "text-danger"}`}>{state.ok ? "Chain intact" : "Chain broken"}</p>
          <p className="text-text-subtle">
            {state.ok
              ? `All ${state.checked} entries verified; last sequence ${state.lastSequence}. No tampering detected.`
              : `${state.detail} Verified ${state.checked} entries before the break (sequence ${state.failedAt}).`}
          </p>
          {error && <p className="text-danger">{error}</p>}
        </div>
      </section>

      <section className="rounded-xl border border-sidebar-border bg-sidebar p-4 text-sidebar-foreground shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-sidebar-hover">
            <LinkIcon className="size-5" aria-hidden />
          </span>
          <div>
            <h3 className="text-base font-semibold">Chain links</h3>
            <p className="text-xs text-sidebar-muted">The newest entries and the hashes that tie them together</p>
          </div>
        </div>
        {links.length === 0 ? (
          <p className="mt-4 text-sm text-sidebar-muted">No events yet.</p>
        ) : (
          <ol className="mt-4">
            {links.map((l, i) => (
              <li key={l.sequence}>
                {i > 0 && <div className="ml-6 h-3 border-l-2 border-emerald-400/60" aria-hidden />}
                <div className={`rounded-lg border p-3 ${valid(l.sequence) ? "border-emerald-400/30 bg-white/[0.03]" : "border-red-400/50 bg-red-500/10"}`}>
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-brand px-1.5 py-0.5 text-xs font-semibold text-brand-foreground tabular-nums">#{l.sequence}</span>
                    <span className={`text-xs font-semibold ${valid(l.sequence) ? "text-emerald-400" : "text-red-400"}`}>{valid(l.sequence) ? "VALID" : "INVALID"}</span>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-2 font-mono text-[11px]">
                    <div className="min-w-0">
                      <dt className="text-[10px] tracking-wider text-sidebar-muted uppercase">Hash</dt>
                      <dd className="truncate text-sky-300" title={l.hash}>
                        {short(l.hash)}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-[10px] tracking-wider text-sidebar-muted uppercase">Previous</dt>
                      <dd className="truncate text-sidebar-foreground/80" title={l.prev_hash}>
                        {short(l.prev_hash)}
                      </dd>
                    </div>
                  </dl>
                </div>
              </li>
            ))}
          </ol>
        )}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-emerald-500/10 p-3 text-center">
            <p className="text-xl font-semibold text-emerald-400 tabular-nums">{state.checked}</p>
            <p className="text-xs text-sidebar-muted">Entries verified</p>
          </div>
          <div className={`rounded-lg p-3 text-center ${state.ok ? "bg-white/[0.04]" : "bg-red-500/10"}`}>
            <p className={`text-xl font-semibold tabular-nums ${state.ok ? "text-sidebar-foreground" : "text-red-400"}`}>{state.ok ? 0 : 1}</p>
            <p className="text-xs text-sidebar-muted">Breaks found</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-sidebar-muted">Each hash covers the entry and the previous hash, so changing any past entry breaks every link after it.</p>
      </section>
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
