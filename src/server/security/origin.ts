import "server-only";
import { headers } from "next/headers";

export class OriginError extends Error {
  constructor() {
    super("Request origin not allowed.");
    this.name = "OriginError";
  }
}

/**
 * Pure check: a mutation's Origin must match the host serving the app.
 * Next.js already compares Origin and Host for Server Actions; this repeats the
 * check explicitly so it also covers route handlers and survives config changes.
 */
export function isSameOrigin(origin: string | null, host: string | null, allowed: string[] = []): boolean {
  if (!origin || !host) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  return originHost === host || allowed.includes(originHost);
}

export async function assertSameOrigin(): Promise<void> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const allowed = (process.env.NEXORA_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!isSameOrigin(h.get("origin"), host, allowed)) throw new OriginError();
}
