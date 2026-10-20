/**
 * API keys: format, hashing and scopes.
 *
 * A key looks like `nxk_<kind>_<prefix>_<secret>`. Only SHA-256 of the whole key is stored;
 * the key is shown once when created. The prefix identifies the key in the UI and logs.
 * Integration keys and SIEM keys are separate kinds with disjoint scopes, so a key handed to
 * Make or n8n can never read the security log or disable users.
 */
import { createHash, randomBytes } from "node:crypto";
import type { ApiKey } from "../entities";

export const INTEGRATION_SCOPES = ["leads:write", "records:read", "events:write"] as const;
export const SIEM_SCOPES = ["security:read", "security:respond"] as const;
export const API_SCOPES = [...INTEGRATION_SCOPES, ...SIEM_SCOPES] as const;
export type ApiScope = (typeof API_SCOPES)[number];
export type ApiKeyKind = ApiKey["kind"];

export const SCOPES_BY_KIND: Record<ApiKeyKind, readonly ApiScope[]> = {
  integration: INTEGRATION_SCOPES,
  siem: SIEM_SCOPES,
};

export const SCOPE_DESCRIPTIONS: Record<ApiScope, string> = {
  "leads:write": "Submit leads (POST /leads). Fires the New lead automations.",
  "records:read": "Read companies, contacts, deals and orders.",
  "events:write": "Send external workflow events (POST /events, POST /test-event).",
  "security:read": "Read the hash-chained security event log (GET /security-events).",
  "security:respond": "Revoke API keys and disable users as an incident response.",
};

const KEY_PATTERN = /^nxk_(int|siem)_([a-z0-9]{8})_([A-Za-z0-9_-]{32,64})$/;

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateApiKey(kind: ApiKeyKind): { key: string; prefix: string; hash: string } {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(8);
  const prefix = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  const key = `nxk_${kind === "siem" ? "siem" : "int"}_${prefix}_${randomBytes(32).toString("base64url")}`;
  return { key, prefix, hash: hashApiKey(key) };
}

/** Parses the shape of a presented key. It says nothing about validity. */
export function parseApiKey(key: string): { kind: ApiKeyKind; prefix: string } | null {
  const m = KEY_PATTERN.exec(key);
  if (!m) return null;
  return { kind: m[1] === "siem" ? "siem" : "integration", prefix: m[2]! };
}

/** Scopes a kind may hold; anything else is rejected when a key is created. */
export function validScopesFor(kind: ApiKeyKind, scopes: readonly string[]): scopes is ApiScope[] {
  return scopes.length > 0 && scopes.every((s) => (SCOPES_BY_KIND[kind] as readonly string[]).includes(s));
}

export function maskedKey(key: Pick<ApiKey, "kind" | "prefix">): string {
  return `nxk_${key.kind === "siem" ? "siem" : "int"}_${key.prefix}_••••••••`;
}
