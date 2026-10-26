import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Task } from "@/domain/entities";
import { leadInput } from "@/domain/inputs";
import { insertLead } from "@/server/services/leads";
import { emit, newId, type ServiceContext } from "@/server/services/context";
import { claimExternal, findParty, linkExternal, openDealOf, recordActivity } from "./inbound";
import { tr } from "@/lib/i18n";

/**
 * Calls from cloud telephony (Mango Office, Zadarma, Twilio) become call activities on the contact
 * or lead with that number, linked to the contact's open deal. A missed incoming call also creates a
 * high-priority "Call back" task for the record's owner; a call from an unknown number creates a lead
 * (source: inbound call). Each provider's call id is claimed first, so repeated notifications are no-ops.
 */
export type CallEvent = {
  provider: "mango" | "zadarma" | "twilio";
  id: string;
  direction: "inbound" | "outbound";
  /** The customer's number (the caller for inbound calls, the callee for outbound). */
  customer: string;
  /** Our side: the extension or company number. */
  ours: string;
  startedAt: string;
  durationSec: number;
  answered: boolean;
  recordingUrl?: string | null;
};

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
const PROVIDER = { mango: "Mango Office", zadarma: "Zadarma", twilio: "Twilio" } as const;

export async function processCall(ctx: ServiceContext, call: CallEvent): Promise<"created" | "duplicate"> {
  return ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const claim = await claimExternal(tx, ctx, call.provider, call.id, { direction: call.direction, customer: call.customer });
    if (!claim) return "duplicate";
    const party = await findParty(tx, { phone: call.customer });
    let leadId = party.lead?.id ?? null;
    if (!party.contact && !party.lead && call.direction === "inbound") {
      const lead = await insertLead(
        tx,
        ctx,
        leadInput.parse({
          title: `Inbound call ${call.customer}`,
          company_name: call.customer,
          contact_name: call.customer,
          email: "",
          phone: /^\+?[0-9 ()-]{6,24}$/.test(call.customer) ? call.customer : "",
          country: "",
          source: "inbound_call",
          status: "new",
          qualification: "cold",
          next_action: call.answered ? "" : "Call back: missed call",
          next_action_at: "",
          estimated_value: 0,
          owner_id: null,
        }),
      );
      leadId = lead.id;
    }
    const dealId = party.contact ? await openDealOf(tx, party.contact.id) : null;
    const what = call.direction === "inbound" ? (call.answered ? "Incoming call" : "Missed call") : call.answered ? "Outgoing call" : "Unanswered outgoing call";
    const activity = await recordActivity(tx, ctx, {
      type: "call",
      subject: `${what} ${call.direction === "inbound" ? "from" : "to"} ${call.customer}${call.answered ? ` (${mmss(call.durationSec)})` : ""}`,
      body: [`${PROVIDER[call.provider]}, line ${call.ours || "—"}`, call.recordingUrl ? `Recording: ${call.recordingUrl}` : ""].filter(Boolean).join("\n"),
      occurred_at: call.startedAt,
      contact_id: party.contact?.id ?? null,
      lead_id: leadId,
      deal_id: dealId,
    });
    await linkExternal(tx, claim.id, "activity", activity.id);

    if (call.direction === "inbound" && !call.answered) {
      const owner = party.contact?.owner_id ?? party.lead?.owner_id ?? (leadId ? (await tx.get("leads", leadId))?.owner_id : null) ?? ctx.actor.id;
      const at = new Date().toISOString();
      const task: Task = {
        id: newId(),
        organization_id: ctx.actor.organization_id,
        title: `Call back ${party.contact ? `${party.contact.first_name} ${party.contact.last_name}` : call.customer}`.slice(0, 200),
        description: `Missed call from ${call.customer} at ${call.startedAt.slice(0, 16).replace("T", " ")} UTC (${PROVIDER[call.provider]}).`,
        type: "call",
        assignee_id: owner,
        created_by: null,
        due_at: new Date(Date.now() + 30 * 60_000).toISOString(),
        priority: "high",
        status: "todo",
        completed_at: null,
        company_id: activity.company_id,
        contact_id: party.contact?.id ?? null,
        deal_id: dealId,
        order_id: null,
        created_at: at,
        updated_at: at,
        archived_at: null,
      };
      await tx.insert("tasks", task);
      await emit(tx, ctx, { type: "record.created", payload: { entity: "task", id: task.id, after: task } });
    }
    return "created";
  });
}

// --- Provider configuration and signatures ---------------------------------------

export function telephonyConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    mango: env.MANGO_API_KEY?.trim() && env.MANGO_API_SALT?.trim() ? { key: env.MANGO_API_KEY.trim(), salt: env.MANGO_API_SALT.trim() } : null,
    zadarma: env.ZADARMA_API_SECRET?.trim() ? { secret: env.ZADARMA_API_SECRET.trim() } : null,
    twilio: env.TWILIO_AUTH_TOKEN?.trim() ? { token: env.TWILIO_AUTH_TOKEN.trim() } : null,
  };
}

const equal = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Mango Office: sign = sha256(vpbx_api_key + json + vpbx_api_salt). */
export function mangoSignatureValid(key: string, salt: string, json: string, sign: string): boolean {
  return equal(createHash("sha256").update(key + json + salt).digest("hex"), sign.toLowerCase());
}

/** Zadarma: Signature = base64(hex(hmac_sha1(fields, secret))), as in Zadarma's PHP example. */
export function zadarmaSignature(secret: string, data: string): string {
  return Buffer.from(createHmac("sha1", secret).update(data).digest("hex")).toString("base64");
}

export function zadarmaSignatureValid(secret: string, fields: Record<string, string>, signature: string): boolean {
  const e = fields.event;
  const data =
    e === "NOTIFY_START" || e === "NOTIFY_END" || e === "NOTIFY_INTERNAL"
      ? `${fields.caller_id ?? ""}${fields.called_did ?? ""}${fields.call_start ?? ""}`
      : e === "NOTIFY_OUT_START" || e === "NOTIFY_OUT_END"
        ? `${fields.internal ?? ""}${fields.destination ?? ""}${fields.call_start ?? ""}`
        : e === "NOTIFY_RECORD"
          ? `${fields.pbx_call_id ?? ""}${fields.call_id_with_rec ?? ""}`
          : "";
  return Boolean(data) && equal(zadarmaSignature(secret, data), signature);
}

/** Twilio: X-Twilio-Signature = base64(hmac_sha1(url + sorted key+value pairs, auth token)). */
export function twilioSignature(token: string, url: string, params: Record<string, string>): string {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return createHmac("sha1", token).update(data).digest("base64");
}

// --- Incoming call cards -----------------------------------------------------------

export type RingEvent = { provider: CallEvent["provider"] | "demo"; id: string; customer: string; /** The extension or number being called, when the provider says. */ extension: string | null; /** Demo simulation: show the card to this user. */ forUser?: string };

/**
 * A call is ringing: the people it concerns get an "incoming_call" notification carrying the caller's
 * card (name, company, open deal, link), which the app shows as a pop-up. Recipients: users whose
 * internal number is being called; otherwise the owner of the caller's record; otherwise everyone.
 */
export async function processRinging(ctx: ServiceContext, ring: RingEvent): Promise<number> {
  return ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const party = await findParty(tx, { phone: ring.customer });
    const profiles = (await tx.find("profiles")).filter((p) => p.is_active && !p.archived_at);
    const owner = party.contact?.owner_id ?? party.lead?.owner_id ?? null;
    const byExtension = ring.extension ? profiles.filter((p) => p.phone_extension && p.phone_extension === ring.extension) : [];
    const recipients = ring.forUser ? profiles.filter((p) => p.id === ring.forUser) : byExtension.length ? byExtension : owner && profiles.some((p) => p.id === owner) ? profiles.filter((p) => p.id === owner) : profiles;

    let title: string;
    let body: string;
    let link: string | null = null;
    if (party.contact) {
      const c = party.contact;
      const company = c.company_id ? await tx.get("companies", c.company_id) : null;
      const dealId = await openDealOf(tx, c.id);
      const deal = dealId ? await tx.get("deals", dealId) : null;
      title = tr("Incoming call: {p0}", { p0: `${c.first_name} ${c.last_name}` });
      body = [company?.name, c.job_title, deal ? tr("Deal: {p0}", { p0: deal.name }) : null, ring.customer].filter(Boolean).join(" · ");
      link = `/contacts/${c.id}`;
    } else if (party.lead) {
      title = tr("Incoming call: {p0}", { p0: party.lead.contact_name || party.lead.title });
      body = [party.lead.company_name, tr("Lead: {p0}", { p0: party.lead.title }), ring.customer].filter(Boolean).join(" · ");
      link = `/leads/${party.lead.id}`;
    } else {
      title = tr("Incoming call: {p0}", { p0: ring.customer });
      body = tr("Unknown number. A lead is created when the call ends.");
    }
    let created = 0;
    for (const p of recipients) {
      const dedupe = `call:${ring.provider}:${ring.id}:${p.id}`.slice(0, 200);
      if ((await tx.find("notifications", { dedupe_key: dedupe })).length) continue;
      await tx.insert("notifications", { id: newId(), organization_id: ctx.actor.organization_id, recipient_id: p.id, type: "incoming_call", title: title.slice(0, 200), body: body.slice(0, 1000), link, read_at: null, dedupe_key: dedupe, created_at: new Date().toISOString() });
      created++;
    }
    return created;
  });
}

// --- Click-to-call -------------------------------------------------------------------

export type CallbackConfig = { mango: { key: string; salt: string } | null; zadarma: { key: string; secret: string } | null };

/** Providers that can start a call from NEXORA (the PBX rings the user's phone, then the customer). */
export function callbackConfig(env: NodeJS.ProcessEnv = process.env): CallbackConfig {
  const t = telephonyConfig(env);
  return { mango: t.mango, zadarma: t.zadarma && env.ZADARMA_API_KEY?.trim() ? { key: env.ZADARMA_API_KEY.trim(), secret: t.zadarma.secret } : null };
}

/** Digits of a number for the PBX ("+7 (999) 123-45-67" → "79991234567"). */
export const dialable = (phone: string) => phone.replace(/[^\d]/g, "");

/** Zadarma API: Authorization "key:base64(hex(hmac_sha1(method + params + md5(params), secret)))". */
export function zadarmaAuthorization(key: string, secret: string, method: string, params: Record<string, string>): string {
  const query = new URLSearchParams(Object.entries(params).sort(([a], [b]) => a.localeCompare(b))).toString();
  return `${key}:${zadarmaSignature(secret, method + query + createHash("md5").update(query).digest("hex"))}`;
}

/** Starts a callback: the PBX calls `extension`, and when it is answered, calls `phone`. */
export async function startCallback(config: CallbackConfig, extension: string, phone: string, fetchImpl: typeof fetch = fetch): Promise<{ provider: "mango" | "zadarma" }> {
  const to = dialable(phone);
  if (to.length < 5) throw new Error("The phone number is too short to dial.");
  if (config.mango) {
    const json = JSON.stringify({ command_id: `nexora-${Date.now()}`, from: { extension }, to_number: to });
    const body = new URLSearchParams({ vpbx_api_key: config.mango.key, sign: createHash("sha256").update(config.mango.key + json + config.mango.salt).digest("hex"), json });
    const res = await fetchImpl("https://app.mango-office.ru/vpbx/commands/callback", { method: "POST", body, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Mango Office returned ${res.status}`);
    return { provider: "mango" };
  }
  if (config.zadarma) {
    const method = "/v1/request/callback/";
    const params = { from: extension, to };
    const res = await fetchImpl(`https://api.zadarma.com${method}?${new URLSearchParams(params)}`, { headers: { Authorization: zadarmaAuthorization(config.zadarma.key, config.zadarma.secret, method, params) }, signal: AbortSignal.timeout(8000) });
    const data = (await res.json().catch(() => ({}))) as { status?: string; message?: string };
    if (!res.ok || data.status !== "success") throw new Error(`Zadarma: ${data.message ?? res.status}`);
    return { provider: "zadarma" };
  }
  throw new Error("No telephony provider can start calls.");
}
