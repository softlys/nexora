import type { Activity } from "@/domain/entities";
import { tr } from "@/lib/i18n";
import type { Completion } from "@/server/integrations/ai";
import { recordActivity } from "@/server/integrations/inbound";
import type { Transcribe } from "@/server/integrations/speech";
import { DomainError } from "@/server/repositories/types";
import { requireCan, type ServiceContext } from "./context";
import { assertLinksVisible } from "./records";

/**
 * Call recording → transcript → short summary, on request from the call on a timeline. The result
 * is a new note next to the call (the call itself is not changed). Recordings are fetched only from
 * the telephony providers' own hosts, over HTTPS.
 */

const RECORDING_HOSTS = /(^|\.)(mango-office\.ru|mango-office\.com|zadarma\.com|twilio\.com)$/i;
const MAX_AUDIO = 25 * 1024 * 1024;

export function recordingUrl(body: string): URL | null {
  const m = /Recording: (https:\/\/\S+)/.exec(body);
  if (!m) return null;
  try {
    const url = new URL(m[1]!);
    return url.protocol === "https:" && RECORDING_HOSTS.test(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

const SYSTEM = {
  ru: "Ты помощник менеджера по продажам B2B. По расшифровке телефонного разговора напиши кратко: 1) о чём договорились, 2) потребности и возражения клиента, 3) следующие шаги с датами, если они прозвучали. Только факты из разговора, без выдумок. Не больше 8 пунктов.",
  en: "You assist a B2B sales manager. From a phone call transcript, write briefly: 1) what was agreed, 2) the customer's needs and objections, 3) next steps with dates if mentioned. Only facts from the call, nothing invented. At most 8 bullet points.",
};

export type CallSummaryDeps = { transcribe: Transcribe | null; complete: Completion | null; fetchImpl?: typeof fetch; language: "ru" | "en" };

export async function summarizeCall(ctx: ServiceContext, activityId: string, deps: CallSummaryDeps): Promise<Activity> {
  requireCan(ctx, "create", "activity");
  const call = await ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const a = await tx.get("activities", activityId);
    if (!a || a.type !== "call") throw new DomainError("Call not found.", "not_found");
    await assertLinksVisible(tx, ctx, { contact_id: a.contact_id, lead_id: a.lead_id, deal_id: a.deal_id, company_id: a.company_id });
    return a;
  });
  const url = recordingUrl(call.body);
  if (!url) throw new DomainError("This call has no recording.");
  if (!deps.transcribe) throw new DomainError("Speech recognition is not set up: an admin needs to add Yandex SpeechKit (YANDEX_FOLDER_ID and an API key).");
  if (!deps.complete) throw new DomainError("The AI assistant is not set up (Integrations → AI).");
  const response = await (deps.fetchImpl ?? fetch)(url, { signal: AbortSignal.timeout(60_000), redirect: "error" });
  if (!response.ok) throw new DomainError(`The recording could not be downloaded (HTTP ${response.status}).`);
  const audio = new Uint8Array(await response.arrayBuffer());
  if (audio.byteLength === 0 || audio.byteLength > MAX_AUDIO) throw new DomainError("The recording is empty or larger than 25 MB.");
  let transcript: string;
  let summary: string;
  try {
    transcript = await deps.transcribe(audio, response.headers.get("content-type") ?? "audio/mpeg");
    if (!transcript.trim()) throw new DomainError("No speech was recognized in the recording.");
    summary = await deps.complete(SYSTEM[deps.language], transcript.slice(0, 30_000));
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError(`The call could not be summarized: ${error instanceof Error ? error.message : String(error)}`);
  }
  const body = `${summary.trim()}\n\n— ${tr("Transcript")} —\n${transcript}`.slice(0, 5000);
  return ctx.db.write(ctx.actor.organization_id, (tx) =>
    recordActivity(tx, ctx, { type: "note", subject: tr("Call summary: {p0}", { p0: call.subject }).slice(0, 200), body, contact_id: call.contact_id, lead_id: call.lead_id, deal_id: call.deal_id, company_id: call.company_id }),
  );
}
