import "server-only";
import { leadInput } from "@/domain/inputs";
import { insertLead } from "@/server/services/leads";
import { claimExternal, finishInbound, findParty, inboundContext, inboundMeta, linkExternal, openDealOf, recordActivity, secretMatches } from "../inbound";
import { metaSignatureValid, whatsappConfig } from "../messaging";
import { HookError, text, type HookHandler } from "./common";

type WaMessage = { from: string; id: string; timestamp: string; type: string; text?: { body: string }; button?: { text: string }; interactive?: { button_reply?: { title: string }; list_reply?: { title: string } }; caption?: string };
type WaPayload = { entry?: Array<{ changes?: Array<{ value?: { contacts?: Array<{ wa_id: string; profile?: { name?: string } }>; messages?: WaMessage[] } }> }> };

function messageText(m: WaMessage): string {
  if (m.type === "text") return m.text?.body ?? "";
  if (m.type === "button") return m.button?.text ?? "";
  if (m.type === "interactive") return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? "";
  return `[${m.type}]${m.caption ? ` ${m.caption}` : ""}`;
}

/**
 * WhatsApp Business (Meta Cloud API) webhook: https://<host>/api/hooks/whatsapp, verify token
 * WHATSAPP_VERIFY_TOKEN, field "messages". Incoming messages become message activities on the contact
 * or lead with that number; a message from an unknown number creates a lead.
 */
export const whatsappHook: HookHandler = {
  async GET({ request }) {
    const q = new URL(request.url).searchParams;
    const c = whatsappConfig();
    if (q.get("hub.mode") === "subscribe" && secretMatches(q.get("hub.verify_token"), c.verifyToken)) return text(q.get("hub.challenge") ?? "");
    throw new HookError(403, "Forbidden");
  },
  async POST({ request, rawBody }) {
    const c = whatsappConfig();
    if (!c.appSecret) throw new HookError(503, "WhatsApp is not configured");
    if (!metaSignatureValid(c.appSecret, rawBody, request.headers.get("x-hub-signature-256"))) throw new HookError(401, "Bad signature");
    const payload = JSON.parse(rawBody) as WaPayload;
    const items = (payload.entry ?? []).flatMap((e) => e.changes ?? []).flatMap((ch) => (ch.value?.messages ?? []).map((m) => ({ m, name: ch.value?.contacts?.find((x) => x.wa_id === m.from)?.profile?.name ?? "" })));
    if (items.length === 0) return text("ok"); // status updates (sent, delivered, read)
    const ctx = await inboundContext(inboundMeta(request));
    for (const { m, name } of items.slice(0, 50)) {
      await ctx.db.write(ctx.actor.organization_id, async (tx) => {
        const claim = await claimExternal(tx, ctx, "whatsapp", m.id);
        if (!claim) return;
        const phone = `+${m.from}`;
        const party = await findParty(tx, { phone });
        let leadId = party.lead?.id ?? null;
        if (!party.contact && !party.lead) {
          const display = name || phone;
          const lead = await insertLead(tx, ctx, leadInput.parse({ title: `WhatsApp: ${display}`.slice(0, 160), company_name: display.slice(0, 160), contact_name: display.slice(0, 160), email: "", phone, country: "", source: "website", status: "new", qualification: "cold", next_action: "Reply in WhatsApp", next_action_at: "", estimated_value: 0, owner_id: null }));
          leadId = lead.id;
        }
        const body = messageText(m);
        const activity = await recordActivity(tx, ctx, {
          type: "message",
          subject: `WhatsApp from ${name || phone}: ${body.replace(/\s+/g, " ").slice(0, 120)}`,
          body,
          occurred_at: new Date(Number(m.timestamp) * 1000 || Date.now()).toISOString(),
          contact_id: party.contact?.id ?? null,
          lead_id: leadId,
          deal_id: party.contact ? await openDealOf(tx, party.contact.id) : null,
        });
        await linkExternal(tx, claim.id, "activity", activity.id);
      });
    }
    await finishInbound(ctx);
    return text("ok");
  },
};
