import { MAX_SEARCH_LENGTH } from "@/domain/list";
import { findVisible, trackRead, type ServiceContext } from "./context";

export type SearchResult = { kind: "company" | "contact" | "lead" | "deal" | "order" | "task"; id: string; title: string; subtitle: string; href: string };

const PER_GROUP = 6;

function score(text: string, q: string): number {
  const t = text.toLowerCase();
  if (t.startsWith(q)) return 0;
  if (t.includes(` ${q}`)) return 1;
  return t.includes(q) ? 2 : -1;
}

function top<T>(rows: T[], q: string, text: (r: T) => string): T[] {
  return rows
    .map((r) => ({ r, s: score(text(r), q) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s)
    .slice(0, PER_GROUP)
    .map((x) => x.r);
}

/**
 * Global search over companies, contacts, leads, deals, orders and tasks the actor may see.
 * Visibility is applied on the server before matching, so results never reveal
 * records outside the actor's scope. Input is length-limited and matched literally.
 */
export async function globalSearch(ctx: ServiceContext, rawQuery: string): Promise<SearchResult[]> {
  const q = rawQuery.trim().toLowerCase().slice(0, MAX_SEARCH_LENGTH);
  if (!q) return [];
  return ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const [companies, contacts, leads, deals, orders, tasks] = await Promise.all([
      findVisible(tx, ctx, "companies", "company", (r) => r.owner_id, { archived_at: null }),
      findVisible(tx, ctx, "contacts", "contact", (r) => r.owner_id, { archived_at: null }),
      findVisible(tx, ctx, "leads", "lead", (r) => r.owner_id),
      findVisible(tx, ctx, "deals", "deal", (r) => r.owner_id, { archived_at: null }),
      findVisible(tx, ctx, "orders", "order", (r) => r.owner_id, { archived_at: null }),
      findVisible(tx, ctx, "tasks", "task", (r) => r.assignee_id),
    ]);
    const companyName = new Map(companies.map((c) => [c.id, c.name]));
    const results: SearchResult[] = [
      ...top(companies, q, (c) => `${c.name} ${c.industry} ${c.city}`).map(
        (c): SearchResult => ({ kind: "company", id: c.id, title: c.name, subtitle: `${c.industry} · ${c.city}`, href: `/companies/${c.id}` }),
      ),
      ...top(contacts, q, (c) => `${c.first_name} ${c.last_name} ${c.email ?? ""}`).map(
        (c): SearchResult => ({
          kind: "contact",
          id: c.id,
          title: `${c.first_name} ${c.last_name}`,
          subtitle: [c.job_title, c.company_id ? companyName.get(c.company_id) : null].filter(Boolean).join(" · "),
          href: `/contacts/${c.id}`,
        }),
      ),
      ...top(
        leads.filter((l) => !l.archived_at),
        q,
        (l) => `${l.title} ${l.company_name} ${l.contact_name}`,
      ).map((l): SearchResult => ({ kind: "lead", id: l.id, title: l.title, subtitle: [l.company_name, l.contact_name].filter(Boolean).join(" · "), href: `/leads/${l.id}` })),
      ...top(deals, q, (d) => `${d.name}`).map(
        (d): SearchResult => ({ kind: "deal", id: d.id, title: d.name, subtitle: companyName.get(d.company_id) ?? "", href: `/deals/${d.id}` }),
      ),
      ...top(orders, q, (o) => `${o.order_number} ${companyName.get(o.company_id) ?? ""}`).map(
        (o): SearchResult => ({ kind: "order", id: o.id, title: o.order_number, subtitle: companyName.get(o.company_id) ?? "", href: `/orders/${o.id}` }),
      ),
      ...top(
        tasks.filter((t) => t.status !== "done" && t.status !== "cancelled"),
        q,
        (t) => t.title,
      ).map((t): SearchResult => ({ kind: "task", id: t.id, title: t.title, subtitle: t.due_at ? `Due ${t.due_at.slice(0, 10)}` : "Open task", href: `/tasks/${t.id}` })),
    ];
    await trackRead(ctx, "search", results.length);
    return results;
  });
}
