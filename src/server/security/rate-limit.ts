/**
 * Fixed-window, in-memory rate limiter keyed per user and bucket.
 * Good enough for a single server process; a multi-instance deployment needs a
 * shared store (Redis, Upstash, a database table). Documented in docs/security.md.
 */

export type RateLimitRule = { limit: number; windowSeconds: number };

export const RATE_LIMITS = {
  search: { limit: 30, windowSeconds: 60 },
  create: { limit: 60, windowSeconds: 60 },
  mutate: { limit: 240, windowSeconds: 60 },
} satisfies Record<string, RateLimitRule>;

export type RateLimitBucket = keyof typeof RATE_LIMITS;

type Window = { start: number; count: number };

export class RateLimiter {
  private windows = new Map<string, Window>();

  constructor(private readonly rules: Record<string, RateLimitRule> = RATE_LIMITS) {}

  /** Records a hit and returns whether it is allowed. */
  hit(key: string, bucket: string, now = Date.now()): { allowed: boolean; remaining: number; rule: RateLimitRule; firstBlocked: boolean } {
    const rule = this.rules[bucket];
    if (!rule) throw new Error(`Unknown rate limit bucket ${bucket}`);
    const id = `${bucket}:${key}`;
    const w = this.windows.get(id);
    if (!w || now - w.start >= rule.windowSeconds * 1000) {
      this.windows.set(id, { start: now, count: 1 });
      this.prune(now);
      return { allowed: true, remaining: rule.limit - 1, rule, firstBlocked: false };
    }
    w.count += 1;
    return { allowed: w.count <= rule.limit, remaining: Math.max(0, rule.limit - w.count), rule, firstBlocked: w.count === rule.limit + 1 };
  }

  private prune(now: number) {
    if (this.windows.size < 10_000) return;
    for (const [id, w] of this.windows) if (now - w.start > 3_600_000) this.windows.delete(id);
  }
}

const globalLimiter = globalThis as unknown as { __nexoraRateLimiter?: RateLimiter };
export function getRateLimiter(): RateLimiter {
  globalLimiter.__nexoraRateLimiter ??= new RateLimiter();
  return globalLimiter.__nexoraRateLimiter;
}

export class RateLimitError extends Error {
  constructor(public readonly bucket: string) {
    super("Too many requests. Please wait a minute and try again.");
    this.name = "RateLimitError";
  }
}
