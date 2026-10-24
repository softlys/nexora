import "server-only";
import { createHash } from "node:crypto";
import { leadInput } from "@/domain/inputs";
import { isCountryCode } from "@/lib/countries";
import { insertLead } from "@/server/services/leads";
import { claimExternal, finishInbound, hookSecret, inboundContext, inboundMeta, linkExternal, recordActivity, secretMatches } from "../inbound";
import { flatFields, HookError, text, type HookHandler } from "./common";

/**
 * Web forms → leads: Tilda (form webhook), Yandex Forms (HTTP request integration), Google Forms
 * via Apps Script, or any site form. POST to /api/hooks/forms/<NEXORA_HOOK_SECRET>, form-encoded or
 * JSON. Field names are matched loosely in English and Russian (name / имя, phone / телефон, …).
 * Each submission becomes a lead with source "website" and a note holding every submitted field.
 */
const FIELDS = {
  name: ["name", "fio", "full_name", "fullname", "имя", "фио", "your-name", "contact_name"],
  firstName: ["first_name", "firstname"],
  lastName: ["last_name", "lastname", "фамилия"],
  phone: ["phone", "tel", "telephone", "phone_number", "телефон", "your-phone"],
  email: ["email", "e-mail", "mail", "почта", "your-email"],
  company: ["company", "company_name", "organization", "organisation", "компания", "организация"],
  message: ["message", "comment", "comments", "question", "text", "сообщение", "комментарий", "вопрос", "your-message"],
  country: ["country", "country_code", "страна"],
  value: ["budget", "amount", "value", "бюджет", "сумма"],
  form: ["formname", "form_name", "form", "formid", "форма"],
} as const;

const SKIP = new Set(["test", "tranid", "formid", "cookies", "secret"]);

function pick(fields: Record<string, string>, names: readonly string[]): string {
  for (const n of names) if (fields[n]) return fields[n]!;
  return "";
}

export type ParsedSubmission = { name: string; phone: string; email: string; company: string; message: string; country: string | null; value: number; form: string; utm: Record<string, string>; all: Record<string, string> };

export function parseSubmission(fields: Record<string, string>): ParsedSubmission {
  const first = pick(fields, FIELDS.firstName);
  const last = pick(fields, FIELDS.lastName);
  const name = pick(fields, FIELDS.name) || [first, last].filter(Boolean).join(" ");
  const countryRaw = pick(fields, FIELDS.country).toUpperCase();
  const valueRaw = pick(fields, FIELDS.value).replace(/[^\d.,]/g, "").replace(",", ".");
  const utm = Object.fromEntries(Object.entries(fields).filter(([k]) => /^utm_(source|medium|campaign|content|term)$/.test(k)));
  const all = Object.fromEntries(Object.entries(fields).filter(([k]) => !k.includes(".") && !SKIP.has(k)));
  return {
    name,
    phone: pick(fields, FIELDS.phone),
    email: pick(fields, FIELDS.email),
    company: pick(fields, FIELDS.company),
    message: pick(fields, FIELDS.message),
    country: isCountryCode(countryRaw) ? countryRaw : null,
    value: Number.isFinite(Number(valueRaw)) && valueRaw ? Math.min(Number(valueRaw), 1e12) : 0,
    form: pick(fields, FIELDS.form),
    utm,
    all,
  };
}

const PHONE = /^\+?[0-9 ()-]{6,24}$/;

export const formsHook: HookHandler = {
  async POST({ request, rest, rawBody }) {
    if (!secretMatches(rest[0], hookSecret())) throw new HookError(404, "Not found");
    const fields = flatFields(rawBody, request.headers.get("content-type"));
    // Tilda sends test=test when you add the webhook.
    if (fields.test === "test" && Object.keys(fields).length <= 2) return text("ok");
    const s = parseSubmission(fields);
    if (!s.name && !s.phone && !s.email) return text("ignored: no name, phone or email", 422);

    const ctx = await inboundContext(inboundMeta(request));
    const externalId = fields.tranid || createHash("sha256").update(rawBody).digest("hex");
    const source = s.form ? `forms:${s.form.slice(0, 30)}` : "forms";
    const phone = PHONE.test(s.phone) ? s.phone : "";
    const lead = await ctx.db.write(ctx.actor.organization_id, async (tx) => {
      const claim = await claimExternal(tx, ctx, source, externalId, { form: s.form });
      if (!claim) return null;
      const contactName = s.name || s.email || s.phone;
      const created = await insertLead(
        tx,
        ctx,
        leadInput.parse({
          title: `${s.form || "Website"} request: ${contactName}`.slice(0, 160),
          company_name: (s.company || contactName).slice(0, 160),
          contact_name: contactName.slice(0, 160),
          email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email) ? s.email : "",
          phone,
          country: s.country ?? "",
          source: "website",
          status: "new",
          qualification: "cold",
          next_action: s.message.slice(0, 255),
          next_action_at: "",
          estimated_value: s.value,
          owner_id: null,
        }),
      );
      const lines = Object.entries(s.all).map(([k, v]) => `${k}: ${v}`);
      await recordActivity(tx, ctx, { type: "note", subject: `Form submission${s.form ? `: ${s.form}` : ""}`, body: lines.join("\n"), lead_id: created.id });
      await linkExternal(tx, claim.id, "lead", created.id);
      return created;
    });
    await finishInbound(ctx);
    return text(lead ? "ok" : "ok (duplicate)");
  },
};
