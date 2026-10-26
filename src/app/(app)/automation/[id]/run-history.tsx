"use client";

import { RotateCcw } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { AutomationExecution } from "@/domain/entities";
import { formatDate, formatRelative } from "@/lib/format";
import { retryRunAction } from "@/server/actions/automation";
import { tr } from "@/lib/i18n";

type StepResult = { step_id: string; type: string; name: string | null; status: string; output?: Record<string, unknown>; error?: string; duration_ms: number };

const ALL = "__all";

/** Run history with status and mode filters (in the URL), a detail drawer and Retry for failed runs. */
export function RunHistory({ executions, canRetry }: { executions: AutomationExecution[]; canRetry: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const open = executions.find((e) => e.id === openId) ?? null;

  const setFilter = (key: string, value: string) => {
    const sp = new URLSearchParams(params.toString());
    if (value === ALL) sp.delete(key);
    else sp.set(key, value);
    sp.delete("edit");
    router.replace(sp.size ? `${pathname}?${sp}` : pathname, { scroll: false });
  };

  const retry = (id: string) =>
    startTransition(async () => {
      const result = await retryRunAction({ execution_id: id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(tr("Retry {p0}", { p0: result.data.status }));
      setOpenId(null);
      router.refresh();
    });

  return (
    <section className="space-y-3" aria-labelledby="runs-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="runs-heading" className="text-md font-semibold">{tr("Run history")}</h2>
        <div className="flex gap-2">
          <Select value={params.get("status") ?? ALL} onValueChange={(v) => setFilter("status", v)}>
            <SelectTrigger size="sm" className="w-36" aria-label={tr("Filter by status")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{tr("All statuses")}</SelectItem>
              {["success", "failed", "skipped", "running"].map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={params.get("mode") ?? ALL} onValueChange={(v) => setFilter("mode", v)}>
            <SelectTrigger size="sm" className="w-32" aria-label={tr("Filter by mode")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{tr("Live and test")}</SelectItem>
              <SelectItem value="live">{tr("Live runs")}</SelectItem>
              <SelectItem value="test">{tr("Test runs")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {executions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-strong p-6 text-center text-sm text-text-muted">{tr("No runs match these filters.")}</p>
      ) : (
        <div className="relative overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <caption className="sr-only">{tr("Runs")}</caption>
            <thead className="border-b border-border bg-surface-subtle text-xs text-text-muted">
              <tr>
                <th scope="col" className="h-9 px-3 text-left font-medium">{tr("Started")}</th>
                <th scope="col" className="h-9 px-3 text-left font-medium">{tr("Status")}</th>
                <th scope="col" className="hidden h-9 px-3 text-left font-medium sm:table-cell">{tr("Trigger")}</th>
                <th scope="col" className="hidden h-9 px-3 text-right font-medium md:table-cell">{tr("Duration")}</th>
                <th scope="col" className="h-9 px-3 text-left font-medium">{tr("Result")}</th>
              </tr>
            </thead>
            <tbody>
              {executions.map((e) => {
                const event = (e.trigger_payload.event ?? {}) as { type?: string };
                return (
                  <tr
                    key={e.id}
                    tabIndex={0}
                    onClick={() => setOpenId(e.id)}
                    onKeyDown={(k) => k.key === "Enter" && setOpenId(e.id)}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-subtle focus-visible:bg-surface-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                    data-testid="run-row"
                  >
                    <td className="px-3 py-2 whitespace-nowrap text-text-subtle">
                      <time dateTime={e.started_at} title={formatDate(e.started_at)}>
                        {formatRelative(e.started_at)}
                      </time>
                      {e.trigger_payload.mode === "test" && <span className="ml-2 rounded bg-surface-muted px-1 text-[11px]">{tr("test")}</span>}
                      {e.retry_of && <span className="ml-2 rounded bg-surface-muted px-1 text-[11px]">{tr("retry")}</span>}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={e.status} dot />
                    </td>
                    <td className="hidden px-3 py-2 text-text-subtle sm:table-cell">{event.type ?? "—"}</td>
                    <td className="hidden px-3 py-2 text-right text-text-subtle tabular-nums md:table-cell">{e.duration_ms === null ? "—" : `${e.duration_ms} ms`}</td>
                    <td className="max-w-xs truncate px-3 py-2 text-text-subtle">{e.error ?? `${(e.steps as StepResult[]).length} step${(e.steps as StepResult[]).length === 1 ? "" : "s"}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Sheet open={open !== null} onOpenChange={(v) => !v && setOpenId(null)}>
        <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
          {open && (
            <>
              <SheetHeader className="border-b border-border px-5 py-4">
                <SheetTitle className="flex items-center gap-2">{tr("Run details")} <StatusBadge status={open.status} />
                </SheetTitle>
                <SheetDescription>
                  {formatDate(open.started_at)} · {open.duration_ms ?? "—"} {tr("ms · version")} {open.workflow_version}
                  {open.trigger_payload.mode === "test" ? tr(" · test run, nothing was changed") : ""}
                </SheetDescription>
              </SheetHeader>
              <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
                {open.error && (
                  <div role="alert" className="rounded-md border border-danger-border bg-danger-bg p-3 text-sm text-danger">
                    {open.error}
                  </div>
                )}
                {open.resume_at && <p className="text-sm text-text-muted">{tr("Waiting until")} {formatDate(open.resume_at)}{tr("; the scheduler continues it.")}</p>}
                <ol className="space-y-2">
                  {(open.steps as StepResult[]).map((s, i) => (
                    <li key={`${s.step_id}-${i}`} className="rounded-md border border-border p-3">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="font-medium">
                          {i + 1}. {s.name ?? s.step_id}
                        </span>
                        <StatusBadge status={s.status} />
                      </div>
                      <p className="text-xs text-text-muted">
                        {s.type} · {s.duration_ms} {tr("ms")}</p>
                      {s.error && <p className="mt-1 text-sm text-danger">{s.error}</p>}
                      {s.output && Object.keys(s.output).length > 0 && (
                        <pre className="mt-2 max-h-40 overflow-auto rounded bg-surface-muted p-2 font-mono text-[11px] whitespace-pre-wrap">{JSON.stringify(s.output, null, 2)}</pre>
                      )}
                    </li>
                  ))}
                </ol>
                <details className="text-xs">
                  <summary className="cursor-pointer text-text-muted">{tr("Trigger payload")}</summary>
                  <pre className="mt-2 max-h-60 overflow-auto rounded bg-surface-muted p-2 font-mono text-[11px] whitespace-pre-wrap">{JSON.stringify(open.trigger_payload, null, 2)}</pre>
                </details>
              </div>
              {canRetry && open.status === "failed" && (
                <div className="border-t border-border px-5 py-3">
                  <Button className="w-full" disabled={pending} onClick={() => retry(open.id)}>
                    <RotateCcw aria-hidden />
                    {pending ? tr("Retrying…") : tr("Retry from the failed step")}
                  </Button>
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>
    </section>
  );
}
