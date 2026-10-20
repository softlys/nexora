import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { z } from "zod";
import type { ApiKey, Profile } from "@/domain/entities";
import type { ApiErrorCode, Endpoint } from "@/domain/api/contract";
import { hashApiKey, parseApiKey } from "@/domain/api/keys";
import type { EventInput } from "@/domain/events/types";
import { PermissionError, type Actor } from "@/domain/permissions";
import { dispatchAutomations } from "@/server/automation/runtime";
import { findApiKeyByHash, findApiKeysByPrefix, getServiceDb } from "@/server/db";
import { UniqueViolation } from "@/server/db/types";
import type { RequestMeta } from "@/server/repositories/types";
import { DomainError } from "@/server/repositories/types";
import { getRateLimiter } from "@/server/security/rate-limit";
import { getValidationLog } from "@/server/security/validation-log";
import { emit, emitSecurity, flushSecurityEvents, NotFoundError, type ServiceContext } from "@/server/services/context";

/**
 * Shared pipeline for every /api/v1 route:
 * request id → API key (hash lookup) → revoked / owner checks → scope → per-key rate limit →
 * strict Zod parsing → Idempotency-Key → handler → automations → security events.
 * Responses: `{ data, meta? }` or `{ error: { code, message, details?, request_id } }`.
 */

export const MAX_BODY_BYTES = 64 * 1024;
const IDEMPOTENCY_TTL_MS = 24 * 3600_000;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: Array<{ path: string; message: string }>,
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type ApiResult = { status?: number; body: unknown };

export type ApiHandlerInput = {
  ctx: ServiceContext;
  key: ApiKey;
  body: unknown;
  rawBody: string;
  query: unknown;
  request: Request;
};

function json(status: number, body: unknown, requestId: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Request-Id": requestId, ...headers },
  });
}

function errorResponse(error: ApiError, requestId: string): Response {
  return json(error.status, { error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}), request_id: requestId } }, requestId, error.headers);
}

export function requestMetaOf(request: Request): RequestMeta {
  const forwarded = request.headers.get("x-forwarded-for");
  const incoming = request.headers.get("x-request-id");
  return {
    ip: forwarded ? forwarded.split(",")[0]!.trim() : request.headers.get("x-real-ip"),
    user_agent: request.headers.get("user-agent")?.slice(0, 512) ?? null,
    request_id: incoming && /^[A-Za-z0-9._-]{8,64}$/.test(incoming) ? incoming : randomUUID(),
  };
}

function systemContext(orgId: string, meta: RequestMeta, principal: "anonymous" | "service"): ServiceContext {
  return { actor: { id: "00000000-0000-4000-8000-000000000000", role: "admin", organization_id: orgId, team_member_ids: [] }, principal, meta, db: getServiceDb(), deferred: [] };
}

/** Records a security event for an organization outside any unit of work. Never throws. */
export async function recordApiSecurity(orgId: string, meta: RequestMeta, input: EventInput): Promise<void> {
  try {
    const ctx = systemContext(orgId, meta, "anonymous");
    await ctx.db.write(orgId, (tx) => emit(tx, ctx, input));
  } catch (error) {
    console.error("[api] failed to record security event", input.type, error);
  }
}

function toActor(profile: Profile, all: Profile[]): Actor {
  return { id: profile.id, role: profile.role, organization_id: profile.organization_id, team_member_ids: all.filter((p) => p.manager_id === profile.id && !p.archived_at).map((p) => p.id) };
}

async function authenticate(request: Request, endpoint: Endpoint, meta: RequestMeta): Promise<{ key: ApiKey; ctx: ServiceContext }> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const fail = (message: string) => {
    const limit = getRateLimiter().hit(meta.ip ?? "unknown", "api_auth");
    if (!limit.allowed) return new ApiError(429, "rate_limited", "Too many failed authentication attempts. Try again in a minute.", undefined, { "Retry-After": String(limit.rule.windowSeconds) });
    return new ApiError(401, "unauthorized", message, undefined, { "WWW-Authenticate": 'Bearer realm="nexora"' });
  };
  if (!token) throw fail("Missing API key. Send Authorization: Bearer <key>.");
  const parsed = parseApiKey(token);
  if (!parsed) throw fail("The API key is not valid.");

  const key = await findApiKeyByHash(hashApiKey(token));
  if (!key) {
    // A known prefix with the wrong secret is attributed to that organization's log.
    const candidates = await findApiKeysByPrefix(parsed.prefix);
    for (const orgId of new Set(candidates.map((c) => c.organization_id))) {
      await recordApiSecurity(orgId, meta, { type: "api.auth_failed", payload: { target: { type: "api_key", id: candidates.find((c) => c.organization_id === orgId)!.id }, reason: "wrong_secret", prefix: parsed.prefix, path: endpoint.path } });
    }
    if (candidates.length === 0) console.warn(`[api] authentication failed for unknown key prefix ${parsed.prefix} request_id=${meta.request_id}`);
    throw fail("The API key is not valid.");
  }
  const keyMeta = { ...meta, api_key_id: key.id };
  if (key.revoked_at) {
    await recordApiSecurity(key.organization_id, keyMeta, { type: "api_key.used_after_revoke", payload: { target: { type: "api_key", id: key.id }, prefix: key.prefix, revoked_at: key.revoked_at, path: endpoint.path } });
    throw fail("This API key was revoked.");
  }

  const db = getServiceDb();
  const profiles = await db.read(key.organization_id, (tx) => tx.find("profiles"));
  const owner = profiles.find((p) => p.id === key.created_by);
  if (!owner || !owner.is_active || owner.archived_at) {
    await recordApiSecurity(key.organization_id, keyMeta, { type: "api.auth_failed", payload: { target: { type: "api_key", id: key.id }, reason: "owner_inactive", prefix: key.prefix, path: endpoint.path } });
    throw fail("The user who created this API key is no longer active.");
  }
  const ctx: ServiceContext = { actor: toActor(owner, profiles), meta: keyMeta, db, deferred: [], pendingEvents: [] };

  if (endpoint.scope && !key.scopes.includes(endpoint.scope)) {
    emitSecurity(ctx, { type: "api.scope_denied", payload: { target: { type: "api_key", id: key.id }, required: endpoint.scope, scopes: key.scopes, path: endpoint.path } });
    await flushSecurityEvents(ctx);
    throw new ApiError(403, "insufficient_scope", `This key lacks the ${endpoint.scope} scope.`);
  }

  const limit = getRateLimiter().hit(key.id, "api");
  if (!limit.allowed) {
    if (limit.firstBlocked) {
      emitSecurity(ctx, { type: "rate_limit.exceeded", payload: { bucket: "api", limit: limit.rule.limit, window_seconds: limit.rule.windowSeconds } });
      await flushSecurityEvents(ctx);
    }
    throw new ApiError(429, "rate_limited", `Rate limit exceeded: ${limit.rule.limit} requests per minute per key.`, undefined, { "Retry-After": String(limit.rule.windowSeconds) });
  }
  return { key, ctx };
}

function issues(error: z.ZodError): Array<{ path: string; message: string }> {
  return error.issues.slice(0, 20).map((i) => ({ path: i.path.join(".") || "_", message: i.message }));
}

function validationError(ctx: ServiceContext | null, endpoint: Endpoint, error: z.ZodError, where: "body" | "query"): ApiError {
  if (ctx) {
    const fields = [...new Set(error.issues.map((i) => i.path.join(".") || "_form"))];
    const event = getValidationLog().record(ctx.meta.api_key_id ?? ctx.actor.id, `api:${endpoint.method} ${endpoint.path}`, fields);
    if (event) emitSecurity(ctx, { type: "validation.failed", payload: { action: `api:${endpoint.method} ${endpoint.path}`, count: event.count, fields: event.fields } });
  }
  return new ApiError(400, "validation_failed", where === "body" ? "The request body is not valid." : "The query parameters are not valid.", issues(error));
}

async function readBody(request: Request): Promise<string> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) throw new ApiError(413, "payload_too_large", "The body is larger than 64 KB.");
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw new ApiError(413, "payload_too_large", "The body is larger than 64 KB.");
  return text;
}

function mapError(error: unknown, requestId: string): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof PermissionError) return new ApiError(403, "forbidden", "The key's owner is not allowed to do that.");
  if (error instanceof NotFoundError) return new ApiError(404, "not_found", error.message);
  if (error instanceof DomainError) return error.code === "conflict" ? new ApiError(409, "conflict", error.message) : error.code === "not_found" ? new ApiError(404, "not_found", error.message) : new ApiError(400, "validation_failed", error.message);
  console.error(`[api-error] request_id=${requestId}`, error);
  return new ApiError(500, "internal_error", `Something went wrong. Reference: ${requestId.slice(0, 8)}`);
}

async function touchKey(ctx: ServiceContext, key: ApiKey): Promise<void> {
  const now = new Date();
  if (key.last_used_at && now.getTime() - Date.parse(key.last_used_at) < 60_000) return;
  await ctx.db.write(key.organization_id, (tx) => tx.update("api_keys", key.id, { last_used_at: now.toISOString() })).catch(() => undefined);
}

export function apiRoute(endpoint: Endpoint, handler: (input: ApiHandlerInput) => Promise<ApiResult>) {
  return async function route(request: Request): Promise<Response> {
    const meta = requestMetaOf(request);
    let ctx: ServiceContext | null = null;
    let reservation: { orgId: string; id: string } | null = null;
    try {
      if (!endpoint.scope) {
        const result = await handler({ ctx: null as unknown as ServiceContext, key: null as unknown as ApiKey, body: undefined, rawBody: "", query: undefined, request });
        return json(result.status ?? endpoint.status, result.body, meta.request_id);
      }
      const auth = await authenticate(request, endpoint, meta);
      ctx = auth.ctx;
      const { key } = auth;

      let query: unknown;
      if (endpoint.query) {
        const parsed = endpoint.query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
        if (!parsed.success) throw validationError(ctx, endpoint, parsed.error, "query");
        query = parsed.data;
      }

      let rawBody = "";
      let body: unknown;
      if (endpoint.body) {
        rawBody = await readBody(request);
        let value: unknown;
        try {
          value = rawBody.trim() === "" ? {} : JSON.parse(rawBody);
        } catch {
          throw new ApiError(400, "invalid_json", "The body is not valid JSON.");
        }
        const parsed = endpoint.body.safeParse(value);
        if (!parsed.success) throw validationError(ctx, endpoint, parsed.error, "body");
        body = parsed.data;
      }

      // Idempotency-Key: same key + same request → stored response; different request → 409.
      const idemKey = endpoint.idempotent ? request.headers.get("idempotency-key") : null;
      if (idemKey !== null) {
        if (idemKey.length < 1 || idemKey.length > 200) throw new ApiError(400, "validation_failed", "Idempotency-Key must be 1–200 characters.");
        const requestHash = createHash("sha256").update(`${endpoint.method} ${endpoint.path}\n${rawBody}`).digest("hex");
        const now = new Date();
        const existing = await ctx.db.read(key.organization_id, async (tx) => (await tx.find("api_idempotency_keys", { api_key_id: key.id, key: idemKey }))[0] ?? null);
        if (existing && existing.expires_at > now.toISOString()) {
          if (existing.request_hash !== requestHash) throw new ApiError(409, "idempotency_key_reused", "This Idempotency-Key was used with a different request.");
          if (existing.status_code === 0) throw new ApiError(409, "idempotency_in_progress", "A request with this Idempotency-Key is still being processed.");
          return json(existing.status_code, existing.response_body, meta.request_id, { "Idempotent-Replayed": "true" });
        }
        const id = randomUUID();
        try {
          await ctx.db.write(key.organization_id, async (tx) => {
            if (existing) await tx.remove("api_idempotency_keys", existing.id);
            await tx.insert("api_idempotency_keys", {
              id,
              organization_id: key.organization_id,
              api_key_id: key.id,
              key: idemKey,
              request_hash: requestHash,
              status_code: 0,
              response_body: {},
              created_at: now.toISOString(),
              expires_at: new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString(),
            });
          });
        } catch (error) {
          if (error instanceof UniqueViolation) throw new ApiError(409, "idempotency_in_progress", "A request with this Idempotency-Key is still being processed.");
          throw error;
        }
        reservation = { orgId: key.organization_id, id };
      }

      const result = await handler({ ctx, key, body, rawBody, query, request });
      const status = result.status ?? endpoint.status;
      if (reservation) {
        const r = reservation;
        await ctx.db.write(r.orgId, (tx) => tx.update("api_idempotency_keys", r.id, { status_code: status, response_body: result.body as Record<string, unknown> }));
        reservation = null;
      }
      // Automations (e.g. New lead → follow-up task) run after the change committed.
      await dispatchAutomations(ctx);
      await touchKey(ctx, key);
      return json(status, result.body, meta.request_id);
    } catch (error) {
      const apiError = mapError(error, meta.request_id);
      if (reservation && ctx) {
        const r = reservation;
        // Client errors are stored like successes (the same request gives the same answer); server errors free the key for a retry.
        if (apiError.status < 500) {
          const body = { error: { code: apiError.code, message: apiError.message, ...(apiError.details ? { details: apiError.details } : {}), request_id: meta.request_id } };
          await ctx.db.write(r.orgId, (tx) => tx.update("api_idempotency_keys", r.id, { status_code: apiError.status, response_body: body })).catch(() => undefined);
        } else {
          await ctx.db.write(r.orgId, (tx) => tx.remove("api_idempotency_keys", r.id)).catch(() => undefined);
        }
      }
      return errorResponse(apiError, meta.request_id);
    } finally {
      if (ctx) await flushSecurityEvents(ctx);
    }
  };
}
