"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Columns3, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type SortDirection = "asc" | "desc";

export type DataTableColumn<T> = {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Enables sorting on this column. */
  sortValue?: (row: T) => string | number | null;
  /** Text used by the search box. */
  searchValue?: (row: T) => string;
  align?: "left" | "right";
  /** Responsive collapse: hide this column below the given breakpoint. */
  hideBelow?: "sm" | "md" | "lg" | "xl";
  /** Allow the user to hide this column. Defaults to true except for the first column. */
  hideable?: boolean;
  defaultHidden?: boolean;
  className?: string;
};

export type DataTableState = {
  search: string;
  sort: { id: string; direction: SortDirection } | null;
  page: number;
  hidden: string[];
};

const hideBelowClass = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell", xl: "hidden xl:table-cell" };

/**
 * Client-side data table: search, sortable columns, pagination, row click,
 * column visibility and responsive column collapse. Pass `state` + `onStateChange`
 * to control it (for example to keep it in URL query params).
 */
export function DataTable<T>({
  data,
  columns,
  getRowId,
  rowHref,
  onRowClick,
  pageSize = 25,
  searchPlaceholder = "Search…",
  toolbar,
  emptyState,
  state: controlled,
  onStateChange,
  initialSort = null,
  caption,
}: {
  data: T[];
  columns: DataTableColumn<T>[];
  getRowId: (row: T) => string;
  rowHref?: (row: T) => string;
  onRowClick?: (row: T) => void;
  pageSize?: number;
  searchPlaceholder?: string;
  toolbar?: ReactNode;
  emptyState?: ReactNode;
  state?: DataTableState;
  onStateChange?: (state: DataTableState) => void;
  initialSort?: DataTableState["sort"];
  caption?: string;
}) {
  const router = useRouter();
  const [internal, setInternal] = useState<DataTableState>({
    search: "",
    sort: initialSort,
    page: 0,
    hidden: columns.filter((c) => c.defaultHidden).map((c) => c.id),
  });
  const state = controlled ?? internal;
  const update = (patch: Partial<DataTableState>) => {
    const next = { ...state, ...patch };
    if (onStateChange) onStateChange(next);
    if (!controlled) setInternal(next);
  };

  const searchable = columns.some((c) => c.searchValue);
  const visibleColumns = columns.filter((c) => !state.hidden.includes(c.id));

  const rows = useMemo(() => {
    const q = state.search.trim().toLowerCase();
    let out = q
      ? data.filter((row) => columns.some((c) => c.searchValue?.(row).toLowerCase().includes(q)))
      : data;
    const sortCol = state.sort && columns.find((c) => c.id === state.sort!.id);
    if (sortCol?.sortValue) {
      const dir = state.sort!.direction === "asc" ? 1 : -1;
      out = [...out].sort((a, b) => {
        const av = sortCol.sortValue!(a);
        const bv = sortCol.sortValue!(b);
        if (av === bv) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        return av < bv ? -dir : dir;
      });
    }
    return out;
  }, [data, columns, state.search, state.sort]);

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(state.page, pageCount - 1);
  const pageRows = rows.slice(page * pageSize, page * pageSize + pageSize);
  const interactive = Boolean(rowHref || onRowClick);

  const activate = (row: T) => {
    if (onRowClick) onRowClick(row);
    else if (rowHref) router.push(rowHref(row));
  };
  const onRowKey = (event: KeyboardEvent, row: T) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate(row);
    }
  };
  const toggleSort = (id: string) => {
    const current = state.sort?.id === id ? state.sort.direction : null;
    update({ sort: current === "asc" ? { id, direction: "desc" } : current === "desc" ? null : { id, direction: "asc" }, page: 0 });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {searchable && (
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-text-muted" aria-hidden />
            <Input
              value={state.search}
              onChange={(e) => update({ search: e.target.value.slice(0, 100), page: 0 })}
              placeholder={searchPlaceholder}
              aria-label="Search table"
              className="pl-8"
            />
          </div>
        )}
        <div className="flex flex-1 flex-wrap items-center gap-2">{toolbar}</div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Columns3 aria-hidden />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {columns.map((c, i) => (
              <DropdownMenuCheckboxItem
                key={c.id}
                checked={!state.hidden.includes(c.id)}
                disabled={c.hideable === false || (c.hideable === undefined && i === 0)}
                onCheckedChange={(checked) =>
                  update({ hidden: checked ? state.hidden.filter((h) => h !== c.id) : [...state.hidden, c.id] })
                }
                onSelect={(e) => e.preventDefault()}
              >
                {c.header}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full caption-bottom text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="border-b border-border bg-surface-subtle">
            <tr>
              {visibleColumns.map((c) => {
                const sorted = state.sort?.id === c.id ? state.sort.direction : null;
                return (
                  <th
                    key={c.id}
                    scope="col"
                    aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                    className={cn(
                      "h-9 px-3 text-left text-xs font-medium whitespace-nowrap text-text-muted",
                      c.align === "right" && "text-right",
                      c.hideBelow && hideBelowClass[c.hideBelow],
                      c.className,
                    )}
                  >
                    {c.sortValue ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(c.id)}
                        className={cn(
                          "-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                          sorted && "text-foreground",
                        )}
                      >
                        {c.header}
                        {sorted === "asc" ? <ArrowUp className="size-3" aria-hidden /> : sorted === "desc" ? <ArrowDown className="size-3" aria-hidden /> : <ArrowUpDown className="size-3 opacity-40" aria-hidden />}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={visibleColumns.length} className="p-0">
                  {emptyState ?? <p className="px-3 py-10 text-center text-sm text-text-muted">{state.search ? "No rows match your search." : "No records yet."}</p>}
                </td>
              </tr>
            ) : (
              pageRows.map((row) => (
                <tr
                  key={getRowId(row)}
                  onClick={interactive ? () => activate(row) : undefined}
                  onKeyDown={interactive ? (e) => onRowKey(e, row) : undefined}
                  tabIndex={interactive ? 0 : undefined}
                  className={cn(
                    "border-b border-border last:border-b-0",
                    interactive && "cursor-pointer hover:bg-surface-subtle focus-visible:bg-surface-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                  )}
                >
                  {visibleColumns.map((c) => (
                    <td
                      key={c.id}
                      className={cn("h-10 px-3 align-middle", c.align === "right" && "text-right tabular-nums", c.hideBelow && hideBelowClass[c.hideBelow], c.className)}
                    >
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {rows.length > pageSize && (
        <div className="flex items-center justify-between text-sm text-text-muted">
          <span className="tabular-nums">
            {page * pageSize + 1}–{Math.min(rows.length, (page + 1) * pageSize)} of {rows.length}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={page === 0} onClick={() => update({ page: page - 1 })}>
              <ChevronLeft aria-hidden />
            </Button>
            <span className="px-2 tabular-nums">
              Page {page + 1} of {pageCount}
            </span>
            <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={page >= pageCount - 1} onClick={() => update({ page: page + 1 })}>
              <ChevronRight aria-hidden />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
