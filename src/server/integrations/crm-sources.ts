import "server-only";
import type { Transport } from "./transport";

/**
 * Reading another CRM for a move to NEXORA: Bitrix24 (incoming webhook URL, REST) and amoCRM
 * (account subdomain and a long-lived token, API v4). Both are read into one neutral shape that
 * src/server/services/crm-import.ts writes into NEXORA. Requests go through the SSRF-guarded
 * transport; nothing is stored except what is imported.
 */

export type StageKind = "open" | "won" | "lost";
export type SourceData = {
  pipelines: Array<{ key: string; name: string; stages: Array<{ key: string; name: string; kind: StageKind; sort: number }> }>;
  companies: Array<{ key: string; name: string; phone: string; email: string; website: string; address: string; industry: string }>;
  contacts: Array<{ key: string; first_name: string; last_name: string; phone: string; email: string; job_title: string; company_key: string | null }>;
  deals: Array<{ key: string; name: string; amount: number; currency: string; pipeline_key: string; stage_key: string; company_key: string | null; contact_key: string | null }>;
};

/** At most this many records of each kind are read in one run. */
export const MAX_RECORDS = 5000;

export class SourceError extends Error {}

async function call(transport: Transport, url: string, init: { method: "GET" | "POST"; body?: unknown; headers?: Record<string, string> }): Promise<unknown> {
  const res = await transport({ url, method: init.method, body: init.body === undefined ? "" : JSON.stringify(init.body), headers: { Accept: "application/json", ...(init.body !== undefined && { "Content-Type": "application/json" }), ...init.headers } });
  if (res.status === 204) return null;
  if (res.status === 401 || res.status === 403) throw new SourceError("Access denied: check the webhook URL or token and its permissions.");
  if (res.status >= 400) throw new SourceError(`The CRM answered ${res.status}.`);
  try {
    return JSON.parse(res.body);
  } catch {
    throw new SourceError("The CRM answered with something other than JSON. Check the address.");
  }
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v)).trim();

// --- Bitrix24 ------------------------------------------------------------------------

/** "https://portal.bitrix24.ru/rest/1/abc123/" → base URL with a trailing slash. */
export function bitrixBase(webhook: string): string {
  let url: URL;
  try {
    url = new URL(webhook.trim());
  } catch {
    throw new SourceError("Paste the full webhook address, for example https://your-portal.bitrix24.ru/rest/1/xxxxxxxx/");
  }
  if (url.protocol !== "https:" || !/^\/rest\/\d+\/[A-Za-z0-9]+\/?/.test(url.pathname)) throw new SourceError("This does not look like a Bitrix24 incoming webhook (https://…/rest/<user>/<code>/).");
  const [, , user, code] = url.pathname.split("/");
  return `${url.origin}/rest/${user}/${code}/`;
}

type BxList<T> = { result?: T[] | { categories?: T[] }; next?: number; error?: string; error_description?: string };

async function bxAll<T>(transport: Transport, base: string, method: string, params: Record<string, unknown>): Promise<T[]> {
  const out: T[] = [];
  for (let start = 0; out.length < MAX_RECORDS; ) {
    const r = (await call(transport, `${base}${method}.json`, { method: "POST", body: { ...params, start } })) as BxList<T>;
    if (r?.error) throw new SourceError(`Bitrix24: ${r.error_description || r.error}`);
    const items = Array.isArray(r?.result) ? r.result : (r?.result?.categories ?? []);
    out.push(...items);
    if (r?.next === undefined || items.length === 0) break;
    start = r.next;
  }
  return out.slice(0, MAX_RECORDS);
}

const firstValue = (v: unknown) => (Array.isArray(v) ? str((v[0] as { VALUE?: unknown })?.VALUE) : "");

export async function readBitrix(transport: Transport, webhook: string): Promise<SourceData> {
  const base = bitrixBase(webhook);
  const categories = await bxAll<{ id: number; name: string }>(transport, base, "crm.category.list", { entityTypeId: 2 }).catch(() => [] as Array<{ id: number; name: string }>);
  const cats = categories.length ? categories : [{ id: 0, name: "Sales" }];
  const pipelines: SourceData["pipelines"] = [];
  for (const cat of cats) {
    const entity = cat.id === 0 ? "DEAL_STAGE" : `DEAL_STAGE_${cat.id}`;
    const statuses = await bxAll<{ STATUS_ID: string; NAME: string; SORT: string; EXTRA?: { SEMANTICS?: string } }>(transport, base, "crm.status.list", { filter: { ENTITY_ID: entity } });
    pipelines.push({
      key: String(cat.id),
      name: str(cat.name) || "Sales",
      stages: statuses.map((s) => {
        const sem = s.EXTRA?.SEMANTICS;
        const kind: StageKind = sem === "S" || /(^|:)WON$/.test(s.STATUS_ID) ? "won" : sem === "F" || /(^|:)(LOSE|APOLOGY)$/.test(s.STATUS_ID) ? "lost" : "open";
        return { key: s.STATUS_ID, name: str(s.NAME) || s.STATUS_ID, kind, sort: Number(s.SORT) || 0 };
      }),
    });
  }
  const companies = await bxAll<Record<string, unknown>>(transport, base, "crm.company.list", { select: ["ID", "TITLE", "PHONE", "EMAIL", "WEB", "ADDRESS", "INDUSTRY"] });
  const contacts = await bxAll<Record<string, unknown>>(transport, base, "crm.contact.list", { select: ["ID", "NAME", "LAST_NAME", "POST", "PHONE", "EMAIL", "COMPANY_ID"] });
  const deals = await bxAll<Record<string, unknown>>(transport, base, "crm.deal.list", { select: ["ID", "TITLE", "OPPORTUNITY", "CURRENCY_ID", "CATEGORY_ID", "STAGE_ID", "COMPANY_ID", "CONTACT_ID"] });
  const ref = (v: unknown) => (str(v) && str(v) !== "0" ? str(v) : null);
  return {
    pipelines,
    companies: companies.map((c) => ({ key: str(c.ID), name: str(c.TITLE), phone: firstValue(c.PHONE), email: firstValue(c.EMAIL), website: firstValue(c.WEB), address: str(c.ADDRESS), industry: str(c.INDUSTRY) })),
    contacts: contacts.map((c) => ({ key: str(c.ID), first_name: str(c.NAME), last_name: str(c.LAST_NAME), phone: firstValue(c.PHONE), email: firstValue(c.EMAIL), job_title: str(c.POST), company_key: ref(c.COMPANY_ID) })),
    deals: deals.map((d) => ({ key: str(d.ID), name: str(d.TITLE), amount: Number(d.OPPORTUNITY) || 0, currency: str(d.CURRENCY_ID) || "RUB", pipeline_key: str(d.CATEGORY_ID) || "0", stage_key: str(d.STAGE_ID), company_key: ref(d.COMPANY_ID), contact_key: ref(d.CONTACT_ID) })),
  };
}

// --- amoCRM --------------------------------------------------------------------------

export function amoBase(subdomain: string): string {
  const s = subdomain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\.amocrm\.(ru|com)\/?.*$/, "");
  if (!/^[a-z0-9-]{2,63}$/.test(s)) throw new SourceError("Enter the account subdomain, for example mycompany (from mycompany.amocrm.ru).");
  return `https://${s}.amocrm.ru/api/v4/`;
}

type AmoField = { field_code?: string; values?: Array<{ value?: unknown }> };
const amoField = (fields: AmoField[] | null | undefined, code: string) => str(fields?.find((f) => f.field_code === code)?.values?.[0]?.value);

async function amoAll<T>(transport: Transport, base: string, token: string, path: string, key: string): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; out.length < MAX_RECORDS; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const r = (await call(transport, `${base}${path}${sep}limit=250&page=${page}`, { method: "GET", headers: { Authorization: `Bearer ${token}` } })) as { _embedded?: Record<string, T[]>; _links?: { next?: unknown } } | null;
    const items = r?._embedded?.[key] ?? [];
    out.push(...items);
    if (!r?._links?.next || items.length === 0) break;
  }
  return out.slice(0, MAX_RECORDS);
}

export async function readAmo(transport: Transport, subdomain: string, token: string): Promise<SourceData> {
  const base = amoBase(subdomain);
  if (!token.trim()) throw new SourceError("Paste the long-lived token (amoCRM → Settings → Integrations → your integration → Keys and access).");
  const t = token.trim();
  type AmoPipeline = { id: number; name: string; _embedded?: { statuses?: Array<{ id: number; name: string; sort: number; type?: number }> } };
  const pipelines = await amoAll<AmoPipeline>(transport, base, t, "leads/pipelines", "pipelines");
  type AmoCompany = { id: number; name: string; custom_fields_values?: AmoField[] | null };
  type AmoContact = { id: number; first_name?: string; last_name?: string; name?: string; custom_fields_values?: AmoField[] | null; _embedded?: { companies?: Array<{ id: number }> } };
  type AmoLead = { id: number; name: string; price?: number; pipeline_id: number; status_id: number; _embedded?: { companies?: Array<{ id: number }>; contacts?: Array<{ id: number; is_main?: boolean }> } };
  const companies = await amoAll<AmoCompany>(transport, base, t, "companies", "companies");
  const contacts = await amoAll<AmoContact>(transport, base, t, "contacts?with=companies", "contacts");
  const leads = await amoAll<AmoLead>(transport, base, t, "leads?with=contacts,companies", "leads");
  return {
    pipelines: pipelines.map((p) => ({
      key: String(p.id),
      name: str(p.name) || "Sales",
      // 142 is "successfully realized", 143 "closed and not realized"; the "unsorted" status is skipped.
      stages: (p._embedded?.statuses ?? []).filter((s) => s.type !== 1).map((s) => ({ key: String(s.id), name: str(s.name), kind: s.id === 142 ? "won" : s.id === 143 ? "lost" : "open", sort: s.sort })),
    })),
    companies: companies.map((c) => ({ key: String(c.id), name: str(c.name), phone: amoField(c.custom_fields_values, "PHONE"), email: amoField(c.custom_fields_values, "EMAIL"), website: amoField(c.custom_fields_values, "WEB"), address: amoField(c.custom_fields_values, "ADDRESS"), industry: "" })),
    contacts: contacts.map((c) => {
      const [first, ...rest] = str(c.name).split(" ");
      return { key: String(c.id), first_name: str(c.first_name) || first || "", last_name: str(c.last_name) || rest.join(" "), phone: amoField(c.custom_fields_values, "PHONE"), email: amoField(c.custom_fields_values, "EMAIL"), job_title: amoField(c.custom_fields_values, "POSITION"), company_key: c._embedded?.companies?.[0] ? String(c._embedded.companies[0].id) : null };
    }),
    deals: leads.map((l) => {
      const contact = l._embedded?.contacts?.find((c) => c.is_main) ?? l._embedded?.contacts?.[0];
      return { key: String(l.id), name: str(l.name), amount: Number(l.price) || 0, currency: "RUB", pipeline_key: String(l.pipeline_id), stage_key: String(l.status_id), company_key: l._embedded?.companies?.[0] ? String(l._embedded.companies[0].id) : null, contact_key: contact ? String(contact.id) : null };
    }),
  };
}
