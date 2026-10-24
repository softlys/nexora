import "server-only";
import { finishInbound, inboundContext, inboundMeta, secretMatches } from "../inbound";
import { publicBaseUrl } from "../public-url";
import { mangoSignatureValid, processCall, telephonyConfig, twilioSignature, type CallEvent, zadarmaSignatureValid } from "../telephony";
import { HookError, json, text, type HookHandler } from "./common";

async function save(request: Request, call: CallEvent) {
  const ctx = await inboundContext(inboundMeta(request));
  const result = await processCall(ctx, call);
  await finishInbound(ctx);
  return result;
}

const iso = (value: string | number | undefined) => {
  if (value === undefined || value === "") return new Date().toISOString();
  const n = Number(value);
  const d = Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : new Date(String(value).replace(" ", "T") + (String(value).includes("Z") || /[+-]\d\d:?\d\d$/.test(String(value)) ? "" : "Z"));
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
};

/**
 * Mango Office VPBX: set the integration URL to https://<host>/api/hooks/mango; Mango appends the event
 * path (/events/summary, /events/call, …). Calls are recorded from /events/summary.
 */
export const mangoHook: HookHandler = {
  async POST({ request, rest, rawBody }) {
    const config = telephonyConfig().mango;
    if (!config) throw new HookError(503, "Mango Office is not configured");
    const form = new URLSearchParams(rawBody);
    const payload = form.get("json") ?? "";
    if (form.get("vpbx_api_key") !== config.key || !mangoSignatureValid(config.key, config.salt, payload, form.get("sign") ?? "")) throw new HookError(401, "Bad signature");
    if (rest.join("/") !== "events/summary") return text("ok");
    const e = JSON.parse(payload) as { entry_id?: string; call_direction?: number; from?: { number?: string; extension?: string }; to?: { number?: string; extension?: string }; create_time?: number; talk_time?: number; end_time?: number; entry_result?: number };
    const inbound = e.call_direction === 1;
    const talk = e.talk_time && e.end_time ? Math.max(0, e.end_time - e.talk_time) : 0;
    await save(request, {
      provider: "mango",
      id: e.entry_id ?? `${e.create_time}-${e.from?.number}`,
      direction: inbound ? "inbound" : "outbound",
      customer: (inbound ? e.from?.number : e.to?.number) ?? "unknown",
      ours: (inbound ? (e.to?.extension ?? e.to?.number) : (e.from?.extension ?? e.from?.number)) ?? "",
      startedAt: iso(e.create_time),
      durationSec: talk,
      answered: e.entry_result === 1,
    });
    return text("ok");
  },
};

/**
 * Zadarma: notifications URL https://<host>/api/hooks/zadarma (Settings → Integrations → API). The
 * verification GET with zd_echo is answered; NOTIFY_END and NOTIFY_OUT_END are recorded.
 */
export const zadarmaHook: HookHandler = {
  async GET({ request }) {
    const echo = new URL(request.url).searchParams.get("zd_echo");
    return echo ? text(echo.slice(0, 200)) : text("ok");
  },
  async POST({ request, rawBody }) {
    const config = telephonyConfig().zadarma;
    if (!config) throw new HookError(503, "Zadarma is not configured");
    const fields = Object.fromEntries(new URLSearchParams(rawBody));
    if (!zadarmaSignatureValid(config.secret, fields, request.headers.get("signature") ?? "")) throw new HookError(401, "Bad signature");
    const inbound = fields.event === "NOTIFY_END";
    if (fields.event !== "NOTIFY_END" && fields.event !== "NOTIFY_OUT_END") return text("ok");
    await save(request, {
      provider: "zadarma",
      id: fields.pbx_call_id ?? `${fields.call_start}-${fields.caller_id ?? fields.destination}`,
      direction: inbound ? "inbound" : "outbound",
      customer: (inbound ? fields.caller_id : fields.destination) ?? "unknown",
      ours: (inbound ? fields.called_did : fields.internal) ?? "",
      startedAt: iso(fields.call_start),
      durationSec: Number(fields.duration ?? 0) || 0,
      answered: fields.disposition === "answered",
      recordingUrl: null,
    });
    return text("ok");
  },
};

/** Twilio: set the call Status Callback URL to https://<host>/api/hooks/twilio (event: completed). */
export const twilioHook: HookHandler = {
  async POST({ request, rawBody }) {
    const config = telephonyConfig().twilio;
    if (!config) throw new HookError(503, "Twilio is not configured");
    const params = Object.fromEntries(new URLSearchParams(rawBody));
    const url = new URL(request.url);
    const fullUrl = `${publicBaseUrl(request)}${url.pathname}${url.search}`;
    const signature = request.headers.get("x-twilio-signature") ?? "";
    if (!secretMatches(signature, twilioSignature(config.token, fullUrl, params))) throw new HookError(401, "Bad signature");
    const status = params.CallStatus ?? "";
    if (!["completed", "no-answer", "busy", "failed", "canceled"].includes(status)) return json({ ok: true });
    const inbound = params.Direction === "inbound";
    await save(request, {
      provider: "twilio",
      id: params.CallSid ?? crypto.randomUUID(),
      direction: inbound ? "inbound" : "outbound",
      customer: (inbound ? params.From : params.To) ?? "unknown",
      ours: (inbound ? params.To : params.From) ?? "",
      startedAt: params.Timestamp ? iso(params.Timestamp) : new Date().toISOString(),
      durationSec: Number(params.CallDuration ?? 0) || 0,
      answered: status === "completed" && Number(params.CallDuration ?? 0) > 0,
      recordingUrl: params.RecordingUrl ?? null,
    });
    return json({ ok: true });
  },
};
