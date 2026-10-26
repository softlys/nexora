"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SlidersHorizontal } from "lucide-react";
import { tr } from "@/lib/i18n";

/** Close-date and amount range filters stored in the URL (?from=&to=&min=&max=). */
export function RangeFilters({ dateLabel = "Close date" }: { dateLabel?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const [values, setValues] = useState({ from: params.get("from") ?? "", to: params.get("to") ?? "", min: params.get("min") ?? "", max: params.get("max") ?? "" });
  const activeCount = (["from", "to", "min", "max"] as const).filter((k) => params.get(k)).length;

  const apply = (next: typeof values) => {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    sp.delete("page");
    startTransition(() => router.replace(`${pathname}?${sp}`, { scroll: false }));
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant={activeCount ? "secondary" : "outline"} size="sm">
          <SlidersHorizontal aria-hidden />{tr("Ranges")}{activeCount ? ` (${activeCount})` : ""}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-3">
        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium text-text-muted">{dateLabel}</legend>
          <div className="flex items-center gap-2">
            <Input type="date" aria-label={`${dateLabel} from`} value={values.from} onChange={(e) => setValues({ ...values, from: e.target.value })} />
            <Input type="date" aria-label={`${dateLabel} to`} value={values.to} onChange={(e) => setValues({ ...values, to: e.target.value })} />
          </div>
        </fieldset>
        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium text-text-muted">{tr("Amount")}</legend>
          <div className="flex items-center gap-2">
            <Input inputMode="decimal" placeholder={tr("Min")} aria-label={tr("Minimum amount")} value={values.min} onChange={(e) => setValues({ ...values, min: e.target.value.replace(/[^0-9.]/g, "") })} />
            <Input inputMode="decimal" placeholder={tr("Max")} aria-label={tr("Maximum amount")} value={values.max} onChange={(e) => setValues({ ...values, max: e.target.value.replace(/[^0-9.]/g, "") })} />
          </div>
        </fieldset>
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const cleared = { from: "", to: "", min: "", max: "" };
              setValues(cleared);
              apply(cleared);
            }}
          >{tr("Reset")}</Button>
          <Button size="sm" onClick={() => apply(values)}>{tr("Apply")}</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
