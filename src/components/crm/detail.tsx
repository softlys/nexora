import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { RecordLabel } from "@/components/shell/record-label";
import { cn } from "@/lib/utils";
import { trNode } from "@/lib/i18n";

export function DetailHeader({
  back,
  path,
  title,
  subtitle,
  badges,
  actions,
}: {
  back: { href: string; label: string };
  /** Record URL, used to label breadcrumbs and the browser tab. */
  path: string;
  title: string;
  subtitle?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="space-y-3 border-b border-border pb-4">
      <RecordLabel path={path} label={title} />
      <Link href={back.href} className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-foreground">
        <ArrowLeft className="size-3.5" aria-hidden />
        {trNode(back.label)}
      </Link>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{trNode(title)}</h1>
            {badges}
          </div>
          {subtitle && <div className="text-sm text-text-muted">{trNode(subtitle)}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function Facts({ items, className }: { items: Array<[string, ReactNode]>; className?: string }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2", className)}>
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs text-text-muted">{trNode(label)}</dt>
          <dd className="mt-0.5 truncate">{value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Panel({ title, actions, children, className }: { title: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 rounded-lg border border-border bg-surface", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-medium">{trNode(title)}</h2>
        {actions}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Safe external link: http(s) only, opens in a new tab without referrer or opener. */
export function ExternalLink({ href, children }: { href: string | null; children?: ReactNode }) {
  if (!href || !/^https?:\/\//i.test(href)) return <>{children ?? href ?? "—"}</>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">
      {children ?? href.replace(/^https?:\/\//, "")}
    </a>
  );
}

export function MiniList<T>({ rows, empty, render }: { rows: T[]; empty: string; render: (row: T) => ReactNode }) {
  if (rows.length === 0) return <p className="py-4 text-center text-sm text-text-muted">{trNode(empty)}</p>;
  return <ul className="divide-y divide-border">{rows.map((r, i) => <li key={i} className="py-2.5">{render(r)}</li>)}</ul>;
}
