"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RANGE_LABELS, RANGE_PRESETS, type RangePreset } from "@/domain/metrics/period";

/** Date range filter for dashboards; the choice lives in the URL so links and reloads keep it. */
export function RangeFilter({ preset, from, to }: { preset: RangePreset; from: string; to: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [custom, setCustom] = useState({ from, to });

  const go = (patch: Record<string, string | null>) => {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) sp.delete(k);
      else sp.set(k, v);
    }
    startTransition(() => router.replace(`${pathname}?${sp}`, { scroll: false }));
  };

  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={pending}>
      <Select
        value={preset}
        onValueChange={(v) => (v === "custom" ? go({ range: "custom", from: custom.from, to: custom.to }) : go({ range: v, from: null, to: null }))}
      >
        <SelectTrigger className="w-40" aria-label="Date range">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RANGE_PRESETS.map((p) => (
            <SelectItem key={p} value={p}>
              {RANGE_LABELS[p]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {preset === "custom" ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            go({ range: "custom", from: custom.from, to: custom.to });
          }}
        >
          <Input type="date" aria-label="From" value={custom.from} max={custom.to} onChange={(e) => setCustom({ ...custom, from: e.target.value })} className="w-38" />
          <Input type="date" aria-label="To" value={custom.to} min={custom.from} onChange={(e) => setCustom({ ...custom, to: e.target.value })} className="w-38" />
          <Button type="submit" size="sm" variant="outline">
            Apply
          </Button>
        </form>
      ) : (
        <span className="text-xs text-text-muted tabular-nums">
          {from} – {to}
        </span>
      )}
    </div>
  );
}
