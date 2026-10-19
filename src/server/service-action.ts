import "server-only";
import { z } from "zod";
import { PermissionError } from "@/domain/permissions";
import { getRepoContext } from "@/server/auth";
import { getDb } from "@/server/db";
import { DomainError } from "@/server/repositories/types";
import { assertSameOrigin, OriginError } from "@/server/security/origin";
import { getRateLimiter, RateLimitError, type RateLimitBucket } from "@/server/security/rate-limit";
import { getValidationLog } from "@/server/security/validation-log";
import { emitSecurity, flushSecurityEvents, type ServiceContext } from "@/server/services/context";
import type { ActionResult } from "./action-result";

/** Builds the service context from the session. Organization and actor never come from the client. */
export async function getServiceContext(): Promise<ServiceContext> {
  const { ctx } = await getRepoContext();
  return { actor: ctx.actor, meta: ctx.meta, db: getDb(), deferred: [] };
}

type Options<S extends z.ZodType> = {
  /** Action name used in security events. */
  name: string;
  schema: S;
  /** Rate-limit bucket. Mutations default to "mutate". */
  bucket?: RateLimitBucket;
  /** Read-only actions (search) skip the Origin check. */
  readOnly?: boolean;
};

/**
 * Wraps a server action body: Origin check, session, rate limit, strict Zod parsing,
 * service call, deferred security events and safe error mapping.
 */
export async function serviceAction<S extends z.ZodType, T>(
  options: Options<S>,
  input: unknown,
  body: (ctx: ServiceContext, data: z.output<S>) => Promise<T>,
): Promise<ActionResult<T>> {
  let ctx: ServiceContext | null = null;
  try {
    if (!options.readOnly) await assertSameOrigin();
    ctx = await getServiceContext();

    const bucket = options.bucket ?? (options.readOnly ? "search" : "mutate");
    const limit = getRateLimiter().hit(ctx.actor.id, bucket);
    if (!limit.allowed) {
      // One security event per window, not one per blocked request.
      if (limit.firstBlocked) {
        emitSecurity(ctx, { type: "rate_limit.exceeded", payload: { bucket, limit: limit.rule.limit, window_seconds: limit.rule.windowSeconds } });
      }
      throw new RateLimitError(bucket);
    }

    const parsed = options.schema.safeParse(input);
    if (!parsed.success) {
      const fields = [...new Set(parsed.error.issues.map((i) => i.path.join(".") || "_form"))];
      const event = getValidationLog().record(ctx.actor.id, options.name, fields);
      if (event) emitSecurity(ctx, { type: "validation.failed", payload: { action: options.name, count: event.count, fields: event.fields } });
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) (fieldErrors[issue.path.join(".") || "_form"] ??= []).push(issue.message);
      const unknownKeys = parsed.error.issues.some((i) => i.code === "unrecognized_keys");
      return { ok: false, error: unknownKeys ? "The request contained fields that cannot be changed." : "Please fix the highlighted fields.", fieldErrors };
    }

    return { ok: true, data: await body(ctx, parsed.data) };
  } catch (error) {
    if (error instanceof PermissionError) return { ok: false, error: "You don't have permission to do that." };
    if (error instanceof DomainError) return { ok: false, error: error.message };
    if (error instanceof RateLimitError) return { ok: false, error: error.message };
    if (error instanceof OriginError) return { ok: false, error: "This request was blocked because it came from another site." };
    if (error && typeof error === "object" && "digest" in error && String((error as { digest: unknown }).digest).startsWith("NEXT_")) throw error;
    const requestId = ctx?.meta.request_id ?? "unknown";
    console.error(`[action-error] action=${options.name} request_id=${requestId}`, error);
    return { ok: false, error: `Something went wrong. Reference: ${requestId.slice(0, 8)}`, requestId };
  } finally {
    if (ctx) await flushSecurityEvents(ctx);
  }
}
