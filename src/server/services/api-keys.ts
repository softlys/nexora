/**
 * Organization API keys (Settings → API keys, admin only) and the incident-response actions
 * the companion SIEM calls through the security API.
 *
 * Keys are stored as SHA-256 hashes and shown once. Integration keys and SIEM keys have
 * disjoint scopes. Every change writes audit_logs (record.* events) and a security event.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ApiKey } from "@/domain/entities";
import { API_SCOPES, generateApiKey, validScopesFor, type ApiScope } from "@/domain/api/keys";
import { DomainError } from "@/server/repositories/types";
import { emit, NotFoundError, nowOf, requireCan, type ServiceContext } from "./context";

export type ApiKeyView = Omit<ApiKey, "key_hash">;

export const apiKeyInput = z
  .object({
    name: z.string().trim().min(1, "Required").max(120),
    kind: z.enum(["integration", "siem"]),
    scopes: z.array(z.enum(API_SCOPES)).min(1, "Choose at least one scope").max(API_SCOPES.length),
  })
  .strict();

function view(key: ApiKey): ApiKeyView {
  const { key_hash: _hash, ...rest } = key;
  void _hash;
  return rest;
}

export async function listApiKeys(ctx: ServiceContext): Promise<ApiKeyView[]> {
  requireCan(ctx, "view", "api_key");
  return ctx.db.read(ctx.actor.organization_id, async (tx) => (await tx.find("api_keys")).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(view));
}

/** Creates a key and returns it once. Only its hash is stored. */
export async function createApiKey(ctx: ServiceContext, input: z.output<typeof apiKeyInput>): Promise<{ key: string; apiKey: ApiKeyView }> {
  requireCan(ctx, "create", "api_key");
  const scopes = [...new Set(input.scopes)];
  if (!validScopesFor(input.kind, scopes)) {
    throw new DomainError(input.kind === "siem" ? "SIEM keys can only hold security:read and security:respond." : "Integration keys cannot hold security scopes. Create a SIEM key for the security API.");
  }
  const { key, prefix, hash } = generateApiKey(input.kind);
  return ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const at = nowOf(ctx).toISOString();
    const row: ApiKey = {
      id: randomUUID(),
      organization_id: ctx.actor.organization_id,
      name: input.name,
      kind: input.kind,
      prefix,
      key_hash: hash,
      scopes,
      created_by: ctx.actor.id,
      last_used_at: null,
      revoked_at: null,
      created_at: at,
      updated_at: at,
    };
    await tx.insert("api_keys", row);
    await emit(
      tx,
      ctx,
      { type: "record.created", payload: { entity: "api_key", id: row.id, after: { name: row.name, kind: row.kind, prefix, scopes } } },
      { type: "api_key.created", payload: { target: { type: "api_key", id: row.id }, name: row.name, kind: row.kind, prefix, scopes } },
    );
    return { key, apiKey: view(row) };
  });
}

export const revokeInput = z.object({ id: z.uuid(), reason: z.string().trim().max(500).default("") }).strict();

async function revoke(ctx: ServiceContext, id: string, reason: string, via: "settings" | "siem"): Promise<ApiKeyView> {
  return ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const current = await tx.get("api_keys", id);
    if (!current) throw new NotFoundError("API key");
    if (current.revoked_at) return view(current);
    const at = nowOf(ctx).toISOString();
    const updated = await tx.update("api_keys", id, { revoked_at: at, updated_at: at });
    await emit(
      tx,
      ctx,
      { type: "record.updated", payload: { entity: "api_key", id, changes: { revoked_at: { before: null, after: at }, ...(reason ? { reason: { before: null, after: reason } } : {}) } } },
      { type: "api_key.revoked", payload: { target: { type: "api_key", id }, name: current.name, kind: current.kind, prefix: current.prefix, reason: reason || null, via } },
    );
    return view(updated);
  });
}

export async function revokeApiKey(ctx: ServiceContext, input: z.output<typeof revokeInput>): Promise<ApiKeyView> {
  requireCan(ctx, "manage", "api_key");
  return revoke(ctx, input.id, input.reason, "settings");
}

// ---------------------------------------------------------------------------
// Incident response through the security API (SIEM keys with security:respond)
// ---------------------------------------------------------------------------

export const respondRevokeKeyInput = z.object({ api_key_id: z.uuid(), reason: z.string().trim().min(3, "A reason is required").max(500) }).strict();
export const respondDisableUserInput = z.object({ user_id: z.uuid(), reason: z.string().trim().min(3, "A reason is required").max(500) }).strict();

/** Revokes a key on behalf of the SIEM. `ctx` is the SIEM key's context. */
export async function respondRevokeApiKey(ctx: ServiceContext, input: z.output<typeof respondRevokeKeyInput>, callerKeyId: string): Promise<ApiKeyView> {
  if (input.api_key_id === callerKeyId) throw new DomainError("A key cannot revoke itself. Revoke it in Settings → API keys.", "conflict");
  return revoke(ctx, input.api_key_id, input.reason, "siem");
}

/** Disables a user on behalf of the SIEM. Never the last active admin. */
export async function respondDisableUser(ctx: ServiceContext, input: z.output<typeof respondDisableUserInput>) {
  return ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const profile = await tx.get("profiles", input.user_id);
    if (!profile || profile.archived_at) throw new NotFoundError("User");
    if (!profile.is_active) return { id: profile.id, is_active: false, changed: false };
    if (profile.role === "admin") {
      const otherAdmins = (await tx.find("profiles", { role: "admin", is_active: true, archived_at: null })).filter((p) => p.id !== profile.id);
      if (otherAdmins.length === 0) throw new DomainError("Refused: this is the last active admin of the organization.", "conflict");
    }
    await tx.update("profiles", profile.id, { is_active: false, updated_at: nowOf(ctx).toISOString() });
    await emit(
      tx,
      ctx,
      { type: "record.updated", payload: { entity: "profile", id: profile.id, changes: { is_active: { before: true, after: false }, reason: { before: null, after: input.reason } } } },
      { type: "user.disabled", payload: { target: { type: "profile", id: profile.id }, role: profile.role, reason: input.reason, via: "siem" } },
    );
    return { id: profile.id, is_active: false, changed: true };
  });
}

export type { ApiScope };
