import Link from "next/link";
import type { Pipeline } from "@/domain/entities";
import { tr } from "@/lib/i18n";
import { hrefWith, type Params } from "@/lib/url";
import { cn } from "@/lib/utils";

/**
 * Tabs that switch the pipeline (воронка) shown on a page, kept in ?pipeline=. Hidden when the
 * organization has a single pipeline. With `all`, a first tab shows every pipeline at once.
 */
export function PipelineTabs({ pipelines, current, path, params, all = false }: { pipelines: Pipeline[]; current: string | null; path: string; params: Params; all?: boolean }) {
  if (pipelines.length < 2) return null;
  const tabs = [...(all ? [{ id: null as string | null, name: tr("All pipelines") }] : []), ...pipelines.map((p) => ({ id: p.id as string | null, name: tr(p.name) }))];
  return (
    <nav aria-label={tr("Pipelines")} className="flex flex-wrap gap-1 border-b border-border" data-testid="pipeline-tabs">
      {tabs.map((t) => {
        const active = t.id === current;
        return (
          <Link
            key={t.id ?? "all"}
            href={hrefWith(path, params, { pipeline: t.id, stage: null, page: null })}
            aria-current={active ? "page" : undefined}
            className={cn("-mb-px border-b-2 px-3 py-2 text-sm", active ? "border-brand font-medium text-foreground" : "border-transparent text-text-muted hover:text-foreground")}
          >
            {t.name}
          </Link>
        );
      })}
    </nav>
  );
}
