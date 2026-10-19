/**
 * Shared list query handling: search, filters, sorting and capped pagination.
 * List pages parse URL search params with `parseListQuery` and run `applyListQuery`
 * on the rows the actor may see.
 */
import { z } from "zod";

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_SEARCH_LENGTH = 100;

export const listQuerySchema = z.object({
  q: z.string().trim().max(MAX_SEARCH_LENGTH).catch("").default(""),
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
  size: z.coerce.number().int().min(5).max(MAX_PAGE_SIZE).catch(DEFAULT_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  sort: z.string().max(40).regex(/^[a-z_]+$/).optional().catch(undefined),
  dir: z.enum(["asc", "desc"]).catch("asc").default("asc"),
  archived: z.enum(["0", "1"]).catch("0").default("0"),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

type RawParams = Record<string, string | string[] | undefined>;

export function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseListQuery(params: RawParams): ListQuery {
  return listQuerySchema.parse({
    q: first(params.q),
    page: first(params.page),
    size: first(params.size),
    sort: first(params.sort),
    dir: first(params.dir),
    archived: first(params.archived),
  });
}

/** Reads an enum filter from the URL; unknown values are ignored instead of failing. */
export function enumFilter<T extends string>(params: RawParams, key: string, allowed: readonly T[]): T | undefined {
  const value = first(params[key]);
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

export function stringFilter(params: RawParams, key: string, max = 64): string | undefined {
  const value = first(params[key])?.trim();
  return value && value.length <= max ? value : undefined;
}

export type Page<T> = { rows: T[]; total: number; page: number; size: number; pageCount: number };

export function applyListQuery<T>(
  rows: T[],
  query: ListQuery,
  options: {
    searchText: (row: T) => string;
    sorters: Record<string, (row: T) => string | number | null>;
    defaultSort: { key: string; dir: "asc" | "desc" };
  },
): Page<T> {
  const q = query.q.toLowerCase();
  let out = q ? rows.filter((r) => options.searchText(r).toLowerCase().includes(q)) : rows;
  const key = query.sort && options.sorters[query.sort] ? query.sort : options.defaultSort.key;
  const dir = query.sort && options.sorters[query.sort] ? query.dir : options.defaultSort.dir;
  const get = options.sorters[key]!;
  const factor = dir === "asc" ? 1 : -1;
  out = [...out].sort((a, b) => {
    const av = get(a);
    const bv = get(b);
    if (av === bv) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * factor;
    return (av < bv ? -1 : 1) * factor;
  });
  const pageCount = Math.max(1, Math.ceil(out.length / query.size));
  const page = Math.min(query.page, pageCount);
  return { rows: out.slice((page - 1) * query.size, page * query.size), total: out.length, page, size: query.size, pageCount };
}

/** Escapes LIKE/ILIKE wildcards so user input is matched literally. */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}
