import { COMPANY_SIZES, LEAD_QUALIFICATIONS, LEAD_SOURCES, LEAD_STATUSES, LIFECYCLE_STAGES } from "@/domain/entities";
import { enumFilter, MAX_PAGE_SIZE, parseListQuery, stringFilter, type ListQuery, type Page } from "@/domain/list";
import { can, type Resource } from "@/domain/permissions";
import { countryName } from "@/lib/countries";
import { toCsv } from "@/lib/csv";
import { MESSENGER_CHANNELS, MESSENGERS } from "@/lib/messengers";
import { parseDealFilters } from "@/server/deal-filters";
import { hitRateLimit } from "@/server/security/rate-limit";
import { supabaseCounter } from "@/server/security/shared-counter";
import { getServiceContext } from "@/server/service-action";
import { listCompanies } from "@/server/services/companies";
import { listContacts } from "@/server/services/contacts";
import { flushSecurityEvents, type ServiceContext } from "@/server/services/context";
import { listDeals } from "@/server/services/deals";
import { listLeads } from "@/server/services/leads";

/**
 * CSV export of a list with the same search, filters and sort as the page, limited to the records
 * the signed-in user may see. Large exports raise data.bulk_read like any list read.
 */
type Params = Record<string, string | undefined>;
type Export = { resource: Resource; headers: string[]; rows: (ctx: ServiceContext, query: ListQuery, params: Params) => Promise<unknown[][]> };

const MAX_ROWS = 20_000;

/** Every page of a list, up to MAX_ROWS rows. */
async function allPages<T>(query: ListQuery, load: (q: ListQuery) => Promise<Page<T>>): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; out.length < MAX_ROWS; page++) {
    const result = await load({ ...query, page, size: MAX_PAGE_SIZE });
    out.push(...result.rows);
    if (page >= result.pageCount) break;
  }
  return out.slice(0, MAX_ROWS);
}

async function ownerNames(ctx: ServiceContext): Promise<Map<string, string>> {
  const profiles = await ctx.db.read(ctx.actor.organization_id, (tx) => tx.find("profiles"));
  return new Map(profiles.map((p) => [p.id, p.full_name]));
}

const EXPORTS: Record<string, Export> = {
  companies: {
    resource: "company",
    headers: ["Name", "Industry", "Size", "Country", "Country code", "City", "Address", "Phone", "Website", "Lifecycle stage", "Owner", "Open deals", "Contacts", "Created"],
    async rows(ctx, query, p) {
      const filters = { industry: stringFilter(p, "industry", 80), size: enumFilter(p, "size", COMPANY_SIZES), country: stringFilter(p, "country", 2), owner: stringFilter(p, "owner", 36), lifecycle: enumFilter(p, "lifecycle", LIFECYCLE_STAGES) };
      const owners = await ownerNames(ctx);
      const rows = await allPages(query, (q) => listCompanies(ctx, q, filters));
      return rows.map((c) => [c.name, c.industry, c.size, countryName(c.country), c.country, c.city, c.address, c.phone, c.website, c.lifecycle_stage, owners.get(c.owner_id) ?? "", c.open_deals, c.contacts, c.created_at]);
    },
  },
  contacts: {
    resource: "contact",
    headers: ["First name", "Last name", "Email", "Phone", "Job title", "Company", "Owner", "Tags", ...MESSENGER_CHANNELS.map((c) => MESSENGERS[c].label), "Created"],
    async rows(ctx, query, p) {
      const owners = await ownerNames(ctx);
      const rows = await allPages(query, (q) => listContacts(ctx, q, { owner: stringFilter(p, "owner", 36), company: stringFilter(p, "company", 36) }));
      return rows.map((c) => [c.first_name, c.last_name, c.email, c.phone, c.job_title, c.company_name, owners.get(c.owner_id) ?? "", c.tags, ...MESSENGER_CHANNELS.map((m) => c.messengers?.[m] ?? ""), c.created_at]);
    },
  },
  leads: {
    resource: "lead",
    headers: ["Title", "Company", "Contact", "Email", "Phone", "Country", "Source", "Status", "Qualification", "Estimated value", "Currency", "Owner", "Created"],
    async rows(ctx, query, p) {
      const filters = { status: enumFilter(p, "status", LEAD_STATUSES), source: enumFilter(p, "source", LEAD_SOURCES), qualification: enumFilter(p, "qualification", LEAD_QUALIFICATIONS), owner: stringFilter(p, "owner", 36) };
      const rows = await allPages(query, (q) => listLeads(ctx, q, filters));
      return rows.map((l) => [l.title, l.company_name, l.contact_name, l.email, l.phone, l.country ? countryName(l.country) : "", l.source, l.status, l.qualification, l.estimated_value, l.currency, l.owner_name ?? "", l.created_at]);
    },
  },
  deals: {
    resource: "deal",
    headers: ["Name", "Company", "Stage", "Amount", "Currency", "Probability %", "Expected close", "Closed", "Owner", "Created"],
    async rows(ctx, query, p) {
      const filters = parseDealFilters(p);
      const rows = await allPages(query, async (q) => (await listDeals(ctx, q, filters)) as unknown as Page<Record<string, unknown>>);
      return rows.map((d) => [d.name, d.company_name, d.stage_name, d.amount, d.currency, d.probability, d.expected_close_date, d.closed_at, d.owner_name, d.created_at]);
    },
  },
};

export async function GET(request: Request, { params }: { params: Promise<{ entity: string }> }) {
  const { entity } = await params;
  const spec = EXPORTS[entity];
  if (!spec) return new Response("Not found", { status: 404 });
  const ctx = await getServiceContext();
  try {
    if (!can(ctx.actor, "view", spec.resource)) return new Response("Forbidden", { status: 403 });
    const limit = await hitRateLimit(ctx.actor.id, "search", supabaseCounter());
    if (!limit.allowed) return new Response("Too many requests. Please wait a minute.", { status: 429, headers: { "Retry-After": String(limit.rule.windowSeconds) } });
    const p = Object.fromEntries(new URL(request.url).searchParams) as Params;
    const rows = await spec.rows(ctx, parseListQuery(p), p);
    const date = new Date().toISOString().slice(0, 10);
    return new Response(toCsv(spec.headers, rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="nexora-${entity}-${date}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } finally {
    await flushSecurityEvents(ctx);
  }
}
