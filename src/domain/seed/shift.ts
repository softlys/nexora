/**
 * Keeps a stored demo dataset "relative to today".
 *
 * The demo store remembers the day it was last anchored. When it is loaded on a
 * later day, every date and timestamp in every row moves forward by the same
 * number of whole days, so overdue tasks stay overdue by the same amount and
 * "created 3 days ago" stays 3 days ago. Relative order between records is preserved.
 */
import type { Dataset } from "../entities";

const DAY = 86_400_000;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateField(key: string): boolean {
  return key.endsWith("_at") || key.endsWith("_date");
}

export function shiftValue(value: string, days: number): string {
  if (ISO_TIMESTAMP.test(value)) return new Date(Date.parse(value) + days * DAY).toISOString();
  if (ISO_DATE.test(value)) return new Date(Date.parse(`${value}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
  return value;
}

/** Whole UTC days between two instants (b - a). */
export function daysBetween(aIso: string, bIso: string): number {
  const a = Date.parse(aIso.slice(0, 10) + "T00:00:00Z");
  const b = Date.parse(bIso.slice(0, 10) + "T00:00:00Z");
  return Math.round((b - a) / DAY);
}

/**
 * Tables that are history, not demo scenery: their timestamps are part of what was recorded.
 * The security log is hash-chained; moving its dates would break every hash (and the companion
 * SIEM would report rewritten history every day).
 */
const UNSHIFTED_TABLES = new Set(["security_events"]);

/**
 * Timestamps that may legitimately lie in the future (plans and schedules). Every other `*_at`
 * records something that already happened (created, used, paid…), so after the shift it is capped
 * at "now": moving yesterday 14:45 forward one day must not produce "last used in 9 hours".
 */
const FUTURE_OK = new Set(["due_at", "resume_at", "next_attempt_at", "expires_at", "remind_at", "scheduled_at", "window_ends_at"]);

export function shiftDataset(data: Dataset, days: number, now: Date = new Date()): Dataset {
  if (days === 0) return data;
  const nowIso = now.toISOString();
  const out = {} as Record<string, unknown[]>;
  for (const [table, rows] of Object.entries(data)) {
    if (UNSHIFTED_TABLES.has(table)) {
      out[table] = rows as unknown[];
      continue;
    }
    out[table] = (rows as Record<string, unknown>[]).map((row) => {
      const copy: Record<string, unknown> = { ...row };
      for (const [key, value] of Object.entries(copy)) {
        if (typeof value === "string" && isDateField(key)) {
          const moved = shiftValue(value, days);
          copy[key] = key.endsWith("_at") && !FUTURE_OK.has(key) && ISO_TIMESTAMP.test(moved) && moved > nowIso ? nowIso : moved;
        }
      }
      return copy;
    });
  }
  return out as unknown as Dataset;
}
