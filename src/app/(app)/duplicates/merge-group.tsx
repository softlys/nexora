"use client";

import { Merge } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { MATCH_REASON_LABELS, type MatchReason } from "@/domain/duplicates";
import { tr } from "@/lib/i18n";
import { mergeDuplicatesAction } from "@/server/actions/duplicates";

type Record = { id: string; label: string; detail: string; href: string };

/** One group of possible duplicates: pick the record to keep and the ones to merge into it. */
export function MergeGroup({ entity, records, reasons, canMerge, index }: { entity: "company" | "contact"; records: Record[]; reasons: MatchReason[]; canMerge: boolean; index: number }) {
  const router = useRouter();
  const [keep, setKeep] = useState(records[0]!.id);
  const [selected, setSelected] = useState(() => new Set(records.map((r) => r.id)));
  const merging = records.filter((r) => r.id !== keep && selected.has(r.id));
  const keptLabel = records.find((r) => r.id === keep)!.label;

  return (
    <section className="rounded-lg border border-border bg-surface" data-testid={`duplicate-group-${index}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-medium">{reasons.map((r) => tr(MATCH_REASON_LABELS[r])).join(", ")}</h2>
        {canMerge && (
          <ConfirmDialog
            trigger={
              <Button size="sm" disabled={merging.length === 0}>
                <Merge aria-hidden />
                {tr("Merge")}
              </Button>
            }
            title={tr("Merge into {p0}?", { p0: keptLabel })}
            description={tr("{p0} will be merged: their deals, contacts, orders, tasks, activities and comments move to {p1}, empty fields are filled from them, and they are archived.", { p0: merging.map((r) => r.label).join(", "), p1: keptLabel })}
            confirmLabel={tr("Merge")}
            onConfirm={async () => {
              const r = await mergeDuplicatesAction({ entity, keep_id: keep, merge_ids: merging.map((m) => m.id) });
              if (!r.ok) {
                toast.error(r.error);
                return false;
              }
              toast.success(tr("Merged {p0} into {p1}", { p0: r.data.merged, p1: keptLabel }));
              router.refresh();
            }}
          />
        )}
      </div>
      <ul className="divide-y divide-border">
        {records.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
            {canMerge && (
              <>
                <label className="flex items-center gap-1.5 text-xs text-text-muted">
                  <input type="radio" name={`keep-${index}`} checked={keep === r.id} onChange={() => setKeep(r.id)} className="accent-[var(--color-brand)]" />
                  {tr("Keep")}
                </label>
                <Checkbox
                  aria-label={tr("Merge {p0}", { p0: r.label })}
                  checked={keep === r.id || selected.has(r.id)}
                  disabled={keep === r.id}
                  onCheckedChange={(v) => setSelected((s) => {
                    const next = new Set(s);
                    if (v === true) next.add(r.id);
                    else next.delete(r.id);
                    return next;
                  })}
                />
              </>
            )}
            <span className="min-w-0 flex-1">
              <Link href={r.href} className="font-medium hover:underline">
                {r.label}
              </Link>
              {r.detail && <span className="text-text-muted"> · {r.detail}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
