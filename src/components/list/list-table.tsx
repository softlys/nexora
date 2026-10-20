import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { hrefWith, type Params } from "@/lib/url";
import { cn } from "@/lib/utils";
import { ClickableRow } from "./clickable-row";

export type ListColumn<T> = {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Sort key understood by the service (?sort=). */
  sort?: string;
  align?: "left" | "right";
  hideBelow?: "sm" | "md" | "lg" | "xl";
  className?: string;
};

const hide = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell", xl: "hidden xl:table-cell" };

/**
 * Server-rendered list table. Sorting and pagination are links that change the URL,
 * so every view is shareable and works without client JavaScript.
 */
export function ListTable<T>({
  rows,
  columns,
  rowKey,
  rowHref,
  basePath,
  params,
  page,
  pageCount,
  total,
  size,
  empty,
  caption,
}: {
  rows: T[];
  columns: ListColumn<T>[];
  rowKey: (row: T) => string;
  rowHref?: (row: T) => string;
  basePath: string;
  params: Params;
  page: number;
  pageCount: number;
  total: number;
  size: number;
  empty: ReactNode;
  caption: string;
}) {
  const sort = typeof params.sort === "string" ? params.sort : undefined;
  const dir = params.dir === "desc" ? "desc" : "asc";

  return (
    <div className="space-y-3">
      <div className="relative overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="border-b border-border bg-surface-subtle">
            <tr>
              {columns.map((c) => {
                const active = c.sort && sort === c.sort;
                const nextDir = active && dir === "asc" ? "desc" : "asc";
                return (
                  <th
                    key={c.id}
                    scope="col"
                    aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}
                    className={cn("h-9 px-3 text-left text-xs font-medium whitespace-nowrap text-text-muted", c.align === "right" && "text-right", c.hideBelow && hide[c.hideBelow], c.className)}
                  >
                    {c.sort ? (
                      <Link
                        href={hrefWith(basePath, params, { sort: c.sort, dir: nextDir, page: null })}
                        scroll={false}
                        className={cn("-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none", active && "text-foreground")}
                      >
                        {c.header}
                        {active ? dir === "asc" ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden /> : <ArrowUpDown className="size-3 opacity-40" aria-hidden />}
                      </Link>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="p-0">
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const cells = columns.map((c) => (
                  <td key={c.id} className={cn("h-11 px-3 align-middle", c.align === "right" && "text-right tabular-nums", c.hideBelow && hide[c.hideBelow], c.className)}>
                    {c.cell(row)}
                  </td>
                ));
                return rowHref ? (
                  <ClickableRow key={rowKey(row)} href={rowHref(row)}>
                    {cells}
                  </ClickableRow>
                ) : (
                  <tr key={rowKey(row)} className="border-b border-border last:border-b-0">
                    {cells}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-text-muted">
          <span className="tabular-nums">
            {(page - 1) * size + 1}–{Math.min(total, page * size)} of {total}
          </span>
          {pageCount > 1 && (
            <nav aria-label="Pagination" className="flex items-center gap-1">
              <PageLink disabled={page <= 1} href={hrefWith(basePath, params, { page: page - 1 })} label="Previous page">
                <ChevronLeft className="size-4" aria-hidden />
              </PageLink>
              <span className="px-2 tabular-nums">
                Page {page} of {pageCount}
              </span>
              <PageLink disabled={page >= pageCount} href={hrefWith(basePath, params, { page: page + 1 })} label="Next page">
                <ChevronRight className="size-4" aria-hidden />
              </PageLink>
            </nav>
          )}
        </div>
      )}
    </div>
  );
}

function PageLink({ href, disabled, label, children }: { href: string; disabled: boolean; label: string; children: ReactNode }) {
  const classes = "flex size-7 items-center justify-center rounded-md border border-border bg-surface";
  if (disabled)
    return (
      <span className={cn(classes, "opacity-40")} aria-disabled="true" aria-label={label}>
        {children}
      </span>
    );
  return (
    <Link href={href} scroll={false} aria-label={label} className={cn(classes, "hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none")}>
      {children}
    </Link>
  );
}
