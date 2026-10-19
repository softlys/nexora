/**
 * Aggregates validation failures so a burst of bad input produces one
 * `validation.failed` event per user and action per minute, carrying the count of
 * failures from the previous window. Keeps the audit log readable under fuzzing.
 */
type Window = { start: number; count: number; fields: Set<string> };

const WINDOW_MS = 60_000;

export class ValidationLog {
  private windows = new Map<string, Window>();

  /** Returns the event to emit now, or null when this failure is folded into the current window. */
  record(userId: string, action: string, fields: string[], now = Date.now()): { count: number; fields: string[] } | null {
    const key = `${userId}:${action}`;
    const w = this.windows.get(key);
    if (!w || now - w.start >= WINDOW_MS) {
      const previous = w?.count ?? 0;
      this.windows.set(key, { start: now, count: 1, fields: new Set(fields) });
      return { count: previous + 1, fields };
    }
    w.count += 1;
    fields.forEach((f) => w.fields.add(f));
    return null;
  }
}

const g = globalThis as unknown as { __nexoraValidationLog?: ValidationLog };
export function getValidationLog(): ValidationLog {
  g.__nexoraValidationLog ??= new ValidationLog();
  return g.__nexoraValidationLog;
}
