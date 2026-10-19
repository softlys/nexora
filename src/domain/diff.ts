import type { FieldChanges } from "./events/types";

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => same(v, b[i]));
  return false;
}

/** Field-level diff of the keys present in `after`. Only changed fields are returned. */
export function diffFields(before: Record<string, unknown>, after: Record<string, unknown>, ignore: string[] = ["updated_at"]): FieldChanges {
  const changes: FieldChanges = {};
  for (const [key, value] of Object.entries(after)) {
    if (ignore.includes(key) || value === undefined) continue;
    if (!same(before[key], value)) changes[key] = { before: before[key] ?? null, after: value };
  }
  return changes;
}
