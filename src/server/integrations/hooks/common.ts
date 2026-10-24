import "server-only";

export const MAX_HOOK_BODY = 64 * 1024;

export class HookError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type HookRequest = {
  request: Request;
  /** Path segments after /api/hooks/<provider>/ (for example the shared secret). */
  rest: string[];
  rawBody: string;
};

export type HookHandler = {
  GET?: (input: HookRequest) => Promise<Response>;
  POST?: (input: HookRequest) => Promise<Response>;
};

export async function readHookBody(request: Request): Promise<string> {
  if (Number(request.headers.get("content-length") ?? "0") > MAX_HOOK_BODY) throw new HookError(413, "Body too large");
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_HOOK_BODY) throw new HookError(413, "Body too large");
  return text;
}

/** Form-encoded or JSON bodies as a flat map of lower-cased keys ("answer.data.name" → "name" too). */
export function flatFields(rawBody: string, contentType: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (key: string, value: unknown) => {
    if (value === null || value === undefined) return;
    if (typeof value === "object") {
      if (Array.isArray(value)) {
        if (value.every((v) => typeof v !== "object")) put(key, value.join(", "));
        else value.forEach((v, i) => put(`${key}.${i}`, v));
        return;
      }
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) put(key ? `${key}.${k}` : k, v);
      return;
    }
    const text = String(value).trim();
    if (!text) return;
    const full = key.toLowerCase();
    out[full] ??= text;
    const last = full.split(".").pop()!;
    out[last] ??= text;
  };
  const type = (contentType ?? "").toLowerCase();
  if (type.includes("json") || /^\s*[{[]/.test(rawBody)) {
    try {
      put("", JSON.parse(rawBody));
      return out;
    } catch {
      // fall through to form parsing
    }
  }
  for (const [k, v] of new URLSearchParams(rawBody)) put(k, v);
  return out;
}

export const text = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
