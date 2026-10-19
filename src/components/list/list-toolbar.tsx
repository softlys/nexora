"use client";

import { Archive, Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type FilterDef = {
  key: string;
  label: string;
  options: Array<{ value: string; label: string }>;
};

const ALL = "__all";

/**
 * Search box, filter selects and archive toggle that write to the URL.
 * The server page reads the same params, so lists are shareable and survive reloads.
 */
export function ListToolbar({
  filters = [],
  searchPlaceholder = "Search…",
  showArchivedToggle = true,
  children,
}: {
  filters?: FilterDef[];
  searchPlaceholder?: string;
  showArchivedToggle?: boolean;
  children?: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");
  const firstRender = useRef(true);

  const update = (patch: Record<string, string | null>) => {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") sp.delete(k);
      else sp.set(k, v);
    }
    sp.delete("page");
    const qs = sp.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  // Debounced search.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const t = setTimeout(() => {
      if ((params.get("q") ?? "") !== q.trim()) update({ q: q.trim() || null });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const archived = params.get("archived") === "1";
  const active = filters.some((f) => params.get(f.key)) || Boolean(params.get("q")) || archived;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", pending && "opacity-80")} aria-busy={pending}>
      <div className="relative w-full sm:w-64">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-text-muted" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value.slice(0, 100))} placeholder={searchPlaceholder} aria-label="Search" className="pl-8" maxLength={100} />
      </div>
      {filters.map((f) => (
        <Select key={f.key} value={params.get(f.key) ?? ALL} onValueChange={(v) => update({ [f.key]: v === ALL ? null : v })}>
          <SelectTrigger size="sm" className="h-8 w-auto min-w-32" aria-label={f.label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All {f.label.toLowerCase()}</SelectItem>
            {f.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}
      {showArchivedToggle && (
        <Button variant={archived ? "secondary" : "ghost"} size="sm" aria-pressed={archived} onClick={() => update({ archived: archived ? null : "1" })}>
          <Archive aria-hidden />
          {archived ? "Showing archived" : "Archived"}
        </Button>
      )}
      {active && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setQ("");
            startTransition(() => router.replace(pathname, { scroll: false }));
          }}
        >
          <X aria-hidden />
          Clear
        </Button>
      )}
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  );
}
