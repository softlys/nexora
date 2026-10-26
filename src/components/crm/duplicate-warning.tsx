"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { MATCH_REASON_LABELS as REASON_LABELS } from "@/domain/duplicates";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { findDuplicatesAction } from "@/server/actions/duplicates";
import type { DuplicateMatch } from "@/server/services/duplicates";

type Probe = { entity: "company" | "contact" | "lead"; exclude_id?: string } & Record<string, string | null | undefined>;

/**
 * Shows records that look like the one being entered (checked shortly after typing stops).
 * It only warns: saving stays possible, since two records may legitimately look alike.
 */
export function DuplicateWarning({ probe, className }: { probe: Probe; className?: string }) {
  // Results are kept with the input they were found for, so stale ones are never shown.
  const [found, setFound] = useState<{ key: string; matches: DuplicateMatch[] }>({ key: "", matches: [] });
  const key = JSON.stringify(probe);
  const filled = Object.entries(probe).some(([k, v]) => k !== "entity" && k !== "exclude_id" && k !== "company_id" && typeof v === "string" && v.trim().length >= 3);
  useEffect(() => {
    if (!filled) return;
    let live = true;
    const timer = setTimeout(async () => {
      const clean = Object.fromEntries(Object.entries(probe).filter(([, v]) => v !== undefined && v !== ""));
      const r = await findDuplicatesAction(clean);
      if (live) setFound({ key, matches: r.ok ? r.data : [] });
    }, 500);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, filled]);

  const matches = filled && found.key === key ? found.matches : [];
  if (!matches.length) return null;
  return (
    <div role="status" className={cn("rounded-md border border-warning-border bg-warning-bg p-3 text-sm", className)} data-testid="duplicate-warning">
      <p className="flex items-center gap-2 font-medium">
        <TriangleAlert aria-hidden className="size-4 text-warning" />
        {tr("Possible duplicates")}
      </p>
      <ul className="mt-2 space-y-1">
        {matches.map((m) => (
          <li key={`${m.entity}-${m.id}`} className="min-w-0">
            <Link href={m.href} target="_blank" className="font-medium text-brand hover:underline">
              {m.label}
            </Link>
            <span className="text-text-muted">
              {" "}
              · {m.reasons.map((r) => tr(REASON_LABELS[r])).join(", ")}
              {m.detail && ` · ${m.detail}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
