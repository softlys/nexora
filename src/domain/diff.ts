import type { FieldChanges } from "./events/types";

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => same(v, b[i]));
  // Plain objects (e.g. a contact's messengers) compare by their keys and values.
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
    const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
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
