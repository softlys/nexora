import { z } from "zod";
import type { WebForm } from "@/domain/entities";
import { locale, tr } from "@/lib/i18n";
import { getServiceDb } from "@/server/db";
import { finishInbound, inboundContext, InboundConfigError } from "@/server/integrations/inbound";
import { clientIp } from "@/server/security/client-ip";
import { hitRateLimit } from "@/server/security/rate-limit";
import { supabaseCounter } from "@/server/security/shared-counter";
import { submissionErrors, submissionInput, submitWebForm } from "@/server/services/web-forms";

/**
 * A website form (Settings → Website forms) as a small standalone page, embedded on any site in an
 * iframe. It works without JavaScript: the browser posts the form here and gets the page back, with
 * errors or the thank-you text. UTM tags come from the page's own query string (the embed code passes
 * the parent page's query on). A hidden "website" field catches bots; submissions are rate limited.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const UTM = ["source", "medium", "campaign", "content", "term"] as const;

async function loadForm(id: string): Promise<WebForm | null> {
  if (!z.uuid().safeParse(id).success) return null;
  try {
    const ctx = await inboundContext({ ip: null, user_agent: null, request_id: crypto.randomUUID() });
    const form = await getServiceDb().read(ctx.actor.organization_id, (tx) => tx.get("web_forms", id));
    return form?.is_active ? form : null;
  } catch (error) {
    if (error instanceof InboundConfigError) return null;
    throw error;
  }
}

type View = { values?: Record<string, string>; errors?: Record<string, string>; done?: boolean; notice?: string };

function page(form: WebForm, utm: Record<string, string>, view: View = {}): string {
  const v = view.values ?? {};
  const err = (k: string) => (view.errors?.[k] ? `<span class="err">${esc(tr(view.errors[k]!))}</span>` : "");
  const input = (k: string, label: string, type: string, required: boolean, multiline = false) => {
    const attrs = `id="${k}" name="${k}" ${required ? "required" : ""} ${view.errors?.[k] ? 'aria-invalid="true"' : ""}`;
    const control = multiline ? `<textarea ${attrs} rows="4" maxlength="3000">${esc(v[k] ?? "")}</textarea>` : `<input ${attrs} type="${type}" value="${esc(v[k] ?? "")}" maxlength="${k === "email" ? 254 : 160}" autocomplete="${{ name: "name", phone: "tel", email: "email", company: "organization" }[k] ?? "off"}">`;
    return `<label for="${k}">${esc(label)}${required ? " *" : ""}</label>${control}${err(k)}`;
  };
  const mode = (k: keyof WebForm["fields"]) => form.fields[k] ?? "off";
  const policy = process.env.NEXORA_PRIVACY_URL?.trim();
  const consent = policy && /^https:\/\//.test(policy) ? tr("By sending the form you agree to the processing of personal data under the <a href=\"{p0}\" target=\"_blank\" rel=\"noopener\">privacy policy</a>.", { p0: esc(policy) }) : tr("By sending the form you agree to the processing of your personal data.");
  const body = view.done
    ? `<p class="done" role="status">${esc(form.success_text)}</p>`
    : `<form method="post" novalidate>
${view.notice ? `<p class="err" role="alert">${esc(view.notice)}</p>` : ""}
${input("name", tr("Your name"), "text", true)}
${mode("phone") !== "off" ? input("phone", tr("Phone"), "tel", mode("phone") === "required") : ""}
${mode("email") !== "off" ? input("email", tr("E-mail"), "email", mode("email") === "required") : ""}
${mode("company") !== "off" ? input("company", tr("Company"), "text", mode("company") === "required") : ""}
${mode("message") !== "off" ? input("message", tr("Message"), "text", mode("message") === "required", true) : ""}
<input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" class="hp">
${Object.entries(utm).map(([k, val]) => `<input type="hidden" name="utm_${esc(k)}" value="${esc(val)}">`).join("")}
<button type="submit">${esc(form.button_text)}</button>
<p class="consent">${consent}</p>
</form>`;
  return `<!doctype html><html lang="${locale()}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(form.title)}</title><meta name="robots" content="noindex">
<style>
*{box-sizing:border-box}body{margin:0;font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#17171c;background:transparent}
.card{max-width:480px;padding:20px;border:1px solid #e3e3ea;border-radius:12px;background:#fff}
h1{font-size:19px;margin:0 0 14px}label{display:block;font-size:13px;color:#4a4a55;margin:10px 0 4px}
input,textarea{width:100%;padding:9px 11px;border:1px solid #cfcfda;border-radius:8px;font:inherit}input:focus,textarea:focus{outline:2px solid #6c4cf1;outline-offset:0;border-color:#6c4cf1}
[aria-invalid=true]{border-color:#c62828}.err{display:block;color:#c62828;font-size:12px;margin-top:3px}
button{margin-top:16px;width:100%;padding:11px;border:0;border-radius:8px;background:#5835d8;color:#fff;font:600 15px system-ui,sans-serif;cursor:pointer}button:hover{background:#4a2cc0}
.consent{font-size:11px;color:#6b6b78;margin:10px 0 0}.consent a{color:inherit}.hp{position:absolute;left:-9999px}.done{font-size:16px;margin:8px 0}
</style></head><body><div class="card"><h1>${esc(form.title)}</h1>${body}</div></body></html>`;
}

const html = (s: string, status = 200) => new Response(s, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
const notFound = () => html(`<!doctype html><meta charset="utf-8"><p style="font:14px system-ui">${esc(tr("This form is not available."))}</p>`, 404);

function utmFrom(params: URLSearchParams, prefix = "utm_"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of UTM) {
    const value = params.get(`${prefix}${k}`)?.trim().slice(0, 200);
    if (value) out[k] = value;
  }
  return out;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const form = await loadForm((await params).id);
  if (!form) return notFound();
  return html(page(form, utmFrom(new URL(request.url).searchParams)));
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const form = await loadForm((await params).id);
  if (!form) return notFound();
  const posted = new URLSearchParams(await request.text().catch(() => ""));
  const utm = utmFrom(posted);
  const values = Object.fromEntries(["name", "phone", "email", "company", "message"].map((k) => [k, posted.get(k) ?? ""]));
  // Bots fill every field, people never see this one: pretend it worked.
  if (posted.get("website")) return html(page(form, utm, { done: true }));
  const ip = clientIp(request.headers.get("x-forwarded-for"), request.headers.get("x-real-ip")) ?? "unknown";
  const limit = await hitRateLimit(`ip:${ip}`, "web_form", supabaseCounter());
  if (!limit.allowed) return html(page(form, utm, { values, notice: tr("Too many submissions. Please try again in a few minutes.") }), 429);
  const data = submissionInput.parse(Object.fromEntries(Object.entries(values).map(([k, val]) => [k, val.slice(0, k === "message" ? 3000 : 160)])));
  const errors = submissionErrors(form, data);
  if (Object.keys(errors).length) return html(page(form, utm, { values, errors }), 400);
  const ctx = await inboundContext({ ip: null, user_agent: request.headers.get("user-agent")?.slice(0, 512) ?? null, request_id: crypto.randomUUID() });
  await ctx.db.write(ctx.actor.organization_id, (tx) => submitWebForm(tx, ctx, form, { ...data, utm }));
  await finishInbound(ctx);
  return html(page(form, utm, { done: true }));
}
