/**
 * Fixed-window rate limiter keyed per user and bucket.
 * - `RateLimiter` keeps counters in memory (demo mode, one process, and unit tests).
 * - `hitRateLimit()` is what the app calls: in Supabase mode the counters live in PostgreSQL
 *   (public.hit_counter), so every server instance shares them; otherwise it uses the memory limiter.
 */

export type RateLimitRule = { limit: number; windowSeconds: number };

export const RATE_LIMITS = {
  search: { limit: 30, windowSeconds: 60 },
  create: { limit: 60, windowSeconds: 60 },
  mutate: { limit: 240, windowSeconds: 60 },
  /** Public API, per key. */
  api: { limit: 120, windowSeconds: 60 },
  /** Public API requests with a missing or wrong key, per client IP. */
  api_auth: { limit: 20, windowSeconds: 60 },
  /** AI assistant requests, per user (each one is a paid model call). */
  ai: { limit: 10, windowSeconds: 60 },
  /** Background checks by the app shell (the incoming call pop-up polls every few seconds), per user. */
  poll: { limit: 40, windowSeconds: 60 },
  /** Website chat widget requests (sending and checking for replies), per client IP. */
  site_chat: { limit: 60, windowSeconds: 60 },
  /** Demo access code attempts, per client IP. */
  demo_access: { limit: 10, windowSeconds: 600 },
} satisfies Record<string, RateLimitRule>;

export type RateLimitBucket = keyof typeof RATE_LIMITS;

type Window = { start: number; count: number };

export class RateLimiter {
  private windows = new Map<string, Window>();

  constructor(readonly rules: Record<string, RateLimitRule> = RATE_LIMITS) {}

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
  // Recreated when the rules change (dev hot reload keeps globalThis across module versions).
  if (globalLimiter.__nexoraRateLimiter?.rules !== RATE_LIMITS) globalLimiter.__nexoraRateLimiter = new RateLimiter();
  return globalLimiter.__nexoraRateLimiter;
}

export type RateLimitResult = { allowed: boolean; remaining: number; rule: RateLimitRule; firstBlocked: boolean };

/** A shared fixed-window counter: adds `amount` and returns the total in the current window. */
export type Counter = (id: string, windowSeconds: number, amount: number) => Promise<number>;

/** Records a hit in the shared counter when there is one (Supabase mode), else in memory. */
export async function hitRateLimit(key: string, bucket: RateLimitBucket, counter: Counter | null): Promise<RateLimitResult> {
  if (!counter) return getRateLimiter().hit(key, bucket);
  const rule = RATE_LIMITS[bucket];
  const count = await counter(`rl:${bucket}:${key}`, rule.windowSeconds, 1);
  return { allowed: count <= rule.limit, remaining: Math.max(0, rule.limit - count), rule, firstBlocked: count === rule.limit + 1 };
}

export class RateLimitError extends Error {
  constructor(public readonly bucket: string) {
    super("Too many requests. Please wait a minute and try again.");
    this.name = "RateLimitError";
  }
}
