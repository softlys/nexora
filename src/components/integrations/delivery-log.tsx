"use client";

import { RotateCcw } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { WebhookDelivery } from "@/domain/entities";
import { formatDate, formatRelative } from "@/lib/format";
import { redeliverAction } from "@/server/actions/integrations";

const ALL = "__all";

/** Every delivery attempt with status, payload and response; Redeliver keeps the event_id. */
export function DeliveryLog({ deliveries, eventTypes, canManage }: { deliveries: WebhookDelivery[]; eventTypes: string[]; canManage: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const open = deliveries.find((d) => d.id === openId) ?? null;

  const setFilter = (key: string, value: string) => {
    const sp = new URLSearchParams(params.toString());
    if (value === ALL) sp.delete(key);
    else sp.set(key, value);
    router.replace(sp.size ? `${pathname}?${sp}` : pathname, { scroll: false });
  };

  const redeliver = (id: string) =>
    startTransition(async () => {
      const result = await redeliverAction({ delivery_id: id });
      if (!result.ok) return void toast.error(result.error);
      if (result.data.status === "success") toast.success(`Redelivered (HTTP ${result.data.status_code})`);
      else toast.error(`Redelivery failed: ${result.data.error ?? "unknown error"}`);
      setOpenId(null);
      router.refresh();
    });

  return (
    <section className="space-y-3" aria-labelledby="deliveries-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="deliveries-heading" className="text-md font-semibold">
            Delivery log
          </h2>
          <p className="text-xs text-text-muted">Last 100 attempts. Failed events are retried by the scheduler after 1 and 4 minutes (3 attempts).</p>
        </div>
        <div className="flex gap-2">
          <Select value={params.get("status") ?? ALL} onValueChange={(v) => setFilter("status", v)}>
            <SelectTrigger size="sm" className="w-36" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={params.get("event") ?? ALL} onValueChange={(v) => setFilter("event", v)}>
            <SelectTrigger size="sm" className="w-44" aria-label="Filter by event type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All event types</SelectItem>
              {eventTypes.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {deliveries.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-strong p-6 text-center text-sm text-text-muted">No deliveries yet. Send a test event to see one here.</p>
      ) : (
        <div className="relative overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <caption className="sr-only">Webhook deliveries</caption>
            <thead className="border-b border-border bg-surface-subtle text-xs text-text-muted">
              <tr>
                <th scope="col" className="h-9 px-3 text-left font-medium">Sent</th>
                <th scope="col" className="h-9 px-3 text-left font-medium">Status</th>
                <th scope="col" className="h-9 px-3 text-left font-medium">Event</th>
                <th scope="col" className="hidden h-9 px-3 text-left font-medium sm:table-cell">Attempt</th>
                <th scope="col" className="hidden h-9 px-3 text-right font-medium md:table-cell">HTTP</th>
                <th scope="col" className="hidden h-9 px-3 text-right font-medium md:table-cell">Duration</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((d) => (
                <tr
                  key={d.id}
                  tabIndex={0}
                  onClick={() => setOpenId(d.id)}
                  onKeyDown={(k) => k.key === "Enter" && setOpenId(d.id)}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-subtle focus-visible:bg-surface-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                  data-testid="delivery-row"
                >
                  <td className="px-3 py-2 whitespace-nowrap text-text-subtle">
                    <time dateTime={d.created_at} title={formatDate(d.created_at)}>
                      {formatRelative(d.created_at)}
                    </time>
                    {d.reason !== "event" && <span className="ml-2 rounded bg-surface-muted px-1 text-[11px]">{d.reason}</span>}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={d.status} dot />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{d.event_type}</td>
                  <td className="hidden px-3 py-2 text-text-subtle sm:table-cell">
                    {d.attempt}
                    {d.next_retry_at && <span className="ml-1 text-xs text-text-muted">· retry {formatRelative(d.next_retry_at)}</span>}
                  </td>
                  <td className="hidden px-3 py-2 text-right text-text-subtle tabular-nums md:table-cell">{d.status_code ?? "—"}</td>
                  <td className="hidden px-3 py-2 text-right text-text-subtle tabular-nums md:table-cell">{d.duration_ms === null ? "—" : `${d.duration_ms} ms`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Sheet open={open !== null} onOpenChange={(v) => !v && setOpenId(null)}>
        <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
          {open && (
            <>
              <SheetHeader className="border-b border-border px-5 py-4">
                <SheetTitle className="flex items-center gap-2">
                  Delivery <StatusBadge status={open.status} />
                </SheetTitle>
                <SheetDescription>
                  {formatDate(open.created_at)} · attempt {open.attempt} · {open.reason} · {open.duration_ms ?? "—"} ms
                </SheetDescription>
              </SheetHeader>
              <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
                {open.error && (
                  <div role="alert" className="rounded-md border border-danger-border bg-danger-bg p-3 text-danger">
                    {open.error}
                  </div>
                )}
                <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-xs">
                  <dt className="text-text-muted">Event id</dt>
                  <dd className="font-mono break-all">{open.event_id}</dd>
                  <dt className="text-text-muted">URL</dt>
                  <dd className="font-mono break-all">{open.url}</dd>
                  <dt className="text-text-muted">HTTP status</dt>
                  <dd>{open.status_code ?? "No response"}</dd>
                  {open.next_retry_at && (
                    <>
                      <dt className="text-text-muted">Next retry</dt>
                      <dd>{formatDate(open.next_retry_at)}</dd>
                    </>
                  )}
                </dl>
                <div>
                  <h3 className="mb-1 text-xs font-medium text-text-muted">Payload</h3>
                  <pre className="max-h-72 overflow-auto rounded bg-surface-muted p-2 font-mono text-[11px] whitespace-pre-wrap">{JSON.stringify(open.request_body, null, 2)}</pre>
                </div>
                <div>
                  <h3 className="mb-1 text-xs font-medium text-text-muted">Response (first 1,000 characters)</h3>
                  <pre className="max-h-40 overflow-auto rounded bg-surface-muted p-2 font-mono text-[11px] whitespace-pre-wrap">{open.response_excerpt ?? "—"}</pre>
                </div>
              </div>
              {canManage && (
                <div className="border-t border-border px-5 py-3">
                  <Button className="w-full" disabled={pending} onClick={() => redeliver(open.id)}>
                    <RotateCcw aria-hidden />
                    {pending ? "Sending…" : "Redeliver with the same event_id"}
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
