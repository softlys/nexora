import "server-only";

/**
 * The address people use to open NEXORA, for links in exports, calendar feeds and messages.
 * NEXORA_PUBLIC_URL wins (set it on servers behind a proxy); otherwise the request's own origin.
 */
export function publicBaseUrl(request?: Request, env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.NEXORA_PUBLIC_URL?.trim();
  if (configured && /^https?:\/\/[^/]+/.test(configured)) return configured.replace(/\/+$/, "");
  if (request) return new URL(request.url).origin;
  return "http://localhost:3000";
}

/** publicBaseUrl for server actions and pages, from the request's host when NEXORA_PUBLIC_URL is not set. */
export async function currentBaseUrl(): Promise<string> {
  const configured = publicBaseUrl(undefined);
  if (process.env.NEXORA_PUBLIC_URL?.trim()) return configured;
  const { headers } = await import("next/headers");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host || !/^[A-Za-z0-9.:[\]-]+$/.test(host)) return configured;
  const proto = h.get("x-forwarded-proto") === "https" || !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? "https" : "http";
  return `${proto}://${host}`;
}
