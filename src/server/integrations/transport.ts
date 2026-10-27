import "server-only";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { blockedAddressReason, checkOutboundUrl } from "@/domain/integrations/ssrf";
import { DELIVERY_LIMITS } from "@/domain/integrations/webhooks";

/**
 * HTTP POST (and GET, for API imports) to outside services with SSRF protection:
 * - static URL checks (https in production, no credentials, no internal hostnames)
 * - DNS is resolved inside the socket's lookup hook and every address is checked, so the
 *   address that is checked is the address that is connected to (no DNS rebinding window)
 * - redirects are followed only to the same host (re-checked), at most twice
 * - timeout and a response size cap
 */

export class SsrfBlockedError extends Error {
  constructor(
    public readonly reason: string,
    public readonly host: string,
  ) {
    super(`Blocked outbound request to ${host}: ${reason}`);
    this.name = "SsrfBlockedError";
  }
}

export type TransportRequest = { url: string; body: string; headers: Record<string, string>; /** POST unless set (GET sends no body). */ method?: "GET" | "POST" };
export type TransportResponse = { status: number; body: string; durationMs: number };
export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

export type TransportOptions = {
  /** Allow plain http (never in production). */
  allowHttp: boolean;
  /** Allow private and loopback addresses (local development only, never in production). */
  allowPrivate: boolean;
  timeoutMs?: number;
  maxResponseBytes?: number;
};

/** Policy from the environment: production is always strict. */
export function transportOptionsFromEnv(): TransportOptions {
  const production = process.env.NODE_ENV === "production";
  const allowPrivate = !production && process.env.NEXORA_WEBHOOK_ALLOW_PRIVATE === "1";
  return { allowHttp: !production, allowPrivate };
}

function guardedLookup(allowPrivate: boolean) {
  return (hostname: string, options: { all?: boolean; family?: number } | number, callback: (...args: unknown[]) => void) => {
    const opts = typeof options === "number" ? { family: options } : options;
    dnsLookup(hostname, { all: true, family: opts.family ?? 0 }, (error, addresses: LookupAddress[]) => {
      if (error) return callback(error);
      if (!allowPrivate) {
        for (const a of addresses) {
          const reason = blockedAddressReason(a.address);
          if (reason) return callback(new SsrfBlockedError(`resolves to ${a.address} (${reason})`, hostname));
        }
      }
      if (addresses.length === 0) return callback(new Error(`No address for ${hostname}`));
      if (opts.all) return callback(null, addresses);
      callback(null, addresses[0]!.address, addresses[0]!.family);
    });
  };
}

function postOnce(url: URL, request: TransportRequest, options: Required<TransportOptions>, signal: AbortSignal): Promise<{ status: number; body: string; location: string | null }> {
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolvePromise, reject) => {
    const req = client.request(
      url,
      {
        method: request.method ?? "POST",
        headers: request.method === "GET" ? request.headers : { ...request.headers, "Content-Length": Buffer.byteLength(request.body).toString() },
        lookup: guardedLookup(options.allowPrivate) as never,
        signal,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          if (size >= options.maxResponseBytes) return;
          size += chunk.length;
          chunks.push(chunk);
          if (size >= options.maxResponseBytes) res.destroy();
        });
        const done = () =>
          resolvePromise({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).subarray(0, options.maxResponseBytes).toString("utf8"),
            location: typeof res.headers.location === "string" ? res.headers.location : null,
          });
        res.on("end", done);
        res.on("close", done);
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end(request.method === "GET" ? undefined : request.body);
  });
}

export function createTransport(opts: TransportOptions): Transport {
  const options: Required<TransportOptions> = {
    allowHttp: opts.allowHttp,
    allowPrivate: opts.allowPrivate,
    timeoutMs: opts.timeoutMs ?? DELIVERY_LIMITS.timeoutMs,
    maxResponseBytes: opts.maxResponseBytes ?? DELIVERY_LIMITS.maxResponseBytes,
  };
  return async (request) => {
    const started = Date.now();
    const signal = AbortSignal.timeout(options.timeoutMs);
    let current = request.url;
    for (let hop = 0; ; hop++) {
      const check = checkOutboundUrl(current, { allowHttp: options.allowHttp, allowPrivate: options.allowPrivate });
      if (!check.ok) throw new SsrfBlockedError(check.reason, safeHost(current));
      let res;
      try {
        res = await postOnce(check.url, request, options, signal);
      } catch (error) {
        if (signal.aborted) throw new Error(`Timed out after ${options.timeoutMs} ms`);
        // The guarded lookup reports SSRF blocks through the socket error.
        const cause = error instanceof SsrfBlockedError ? error : (error as { cause?: unknown }).cause;
        if (cause instanceof SsrfBlockedError) throw cause;
        throw error;
      }
      if (res.status >= 300 && res.status < 400 && res.location) {
        const next = new URL(res.location, check.url);
        if (next.host !== check.url.host) throw new SsrfBlockedError(`redirect to another host (${next.host}) is not allowed`, check.url.hostname);
        if (hop >= DELIVERY_LIMITS.maxRedirects) throw new Error("Too many redirects");
        current = next.toString();
        continue;
      }
      return { status: res.status, body: res.body, durationMs: Date.now() - started };
    }
  };
}

function safeHost(raw: string): string {
  try {
    return new URL(raw).hostname;
  } catch {
    return "invalid-url";
  }
}
