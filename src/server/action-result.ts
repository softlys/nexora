import "server-only";
import { z } from "zod";
import { PermissionError } from "@/domain/permissions";
import { DomainError } from "@/server/repositories/types";
import { getRequestMeta } from "@/server/auth";
import { assertSameOrigin, OriginError } from "@/server/security/origin";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]>; requestId?: string };

/**
 * Runs a mutating server action body (after an explicit Origin check) and maps failures
 * to safe, user-facing results.
 * Validation, permission and business-rule errors return their message; anything
 * else is logged server-side and the user sees a generic message with a request id.
 */
export async function runAction<T>(body: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    await assertSameOrigin();
    return { ok: true, data: await body() };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of error.issues) {
        const key = issue.path.join(".") || "_form";
        (fieldErrors[key] ??= []).push(issue.message);
      }
      return { ok: false, error: "Please fix the highlighted fields.", fieldErrors };
    }
    if (error instanceof PermissionError) {
      return { ok: false, error: "You don't have permission to do that." };
    }
    if (error instanceof DomainError) {
      return { ok: false, error: error.message };
    }
    if (error instanceof OriginError) {
      return { ok: false, error: "This request was blocked because it came from another site." };
    }
    // Next.js redirect/notFound signals must propagate.
    if (error && typeof error === "object" && "digest" in error && String((error as { digest: unknown }).digest).startsWith("NEXT_")) {
      throw error;
    }
    const { request_id } = await getRequestMeta();
    console.error(`[action-error] request_id=${request_id}`, error);
    return { ok: false, error: `Something went wrong. Reference: ${request_id.slice(0, 8)}`, requestId: request_id };
  }
}
