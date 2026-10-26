import { describe, expect, it } from "vitest";
import { entitySchemas, TABLES, type Dataset } from "@/domain/entities";
import { computeOrderTotals } from "@/domain/orders/totals";
import { generateSeed, DEMO_PIPELINE_IDS } from "@/domain/seed/generate";

const NOW = new Date("2026-10-19T12:00:00Z");
const seed = generateSeed(NOW);

function ids(rows: Array<{ id: string }>) {
  return new Set(rows.map((r) => r.id));
}

describe("seed data", () => {
  it("is deterministic apart from dates", () => {
    const again = generateSeed(NOW);
    expect(again).toEqual(seed);
    const later = generateSeed(new Date("2027-03-01T12:00:00Z"));
    expect(later.deals.map((d) => [d.id, d.name, d.amount])).toEqual(seed.deals.map((d) => [d.id, d.name, d.amount]));
  });

  it("has the planned volume", () => {
    expect(seed.organizations).toHaveLength(1);
    expect(seed.profiles).toHaveLength(5);
    expect(new Set(seed.profiles.map((p) => p.role))).toEqual(new Set(["admin", "manager", "sales_rep"]));
    expect(seed.companies).toHaveLength(25);
    expect(seed.leads).toHaveLength(40);
    expect(seed.deals).toHaveLength(60);
    expect(seed.products).toHaveLength(20);
    expect(seed.orders).toHaveLength(40);
    // 80 planned tasks plus the follow-ups the seeded New lead automation created.
    const automated = seed.tasks.filter((t) => t.description === "Created by the New lead automation.");
    expect(automated.length).toBeGreaterThan(0);
    expect(seed.tasks.length - automated.length).toBe(80);
    for (const c of seed.companies) {
      const n = seed.contacts.filter((x) => x.company_id === c.id).length;
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(4);
    }
  });

  it("matches the New lead automation history: every routed lead has an owner, a follow-up task and an activity", () => {
    const seed = generateSeed(NOW);
    const newLead = seed.automation_workflows.find((w) => w.name.startsWith("New lead"))!;
    const runs = seed.automation_executions.filter((e) => e.workflow_id === newLead.id && e.status === "success");
    expect(runs.length).toBeGreaterThan(0);
    for (const run of runs) {
      const leadId = ((run.trigger_payload.event as { payload: { id: string } }).payload ?? { id: "" }).id;
      const lead = seed.leads.find((l) => l.id === leadId)!;
      expect(lead.owner_id).not.toBeNull();
      expect(seed.tasks.some((t) => t.title === `Follow up with ${lead.contact_name} at ${lead.company_name}` && t.assignee_id === lead.owner_id)).toBe(true);
      expect(seed.activities.some((a) => a.lead_id === lead.id && a.subject === "Lead received and assigned")).toBe(true);
    }
  });

  it("validates every row against its schema", () => {
    for (const table of TABLES) {
      for (const row of seed[table] as unknown[]) {
        const result = entitySchemas[table].safeParse(row);
        if (!result.success) throw new Error(`${table}: ${JSON.stringify(result.error.issues[0])}`);
      }
    }
  });

  it("resolves every foreign key", () => {
    const d: Dataset = seed;
    const org = ids(d.organizations);
    const profiles = ids(d.profiles);
    const companies = ids(d.companies);
    const contacts = ids(d.contacts);
    const stages = ids(d.pipeline_stages);
    const deals = ids(d.deals);
    const leads = ids(d.leads);
    const products = ids(d.products);
    const orders = ids(d.orders);
    const tasks = ids(d.tasks);

    const must = (set: Set<string>, value: string | null, label: string) => {
      if (value !== null && !set.has(value)) throw new Error(`Unresolved ${label}: ${value}`);
    };

    for (const table of TABLES) for (const row of d[table] as Array<{ organization_id?: string }>) if (row.organization_id) must(org, row.organization_id, `${table}.organization_id`);
    for (const p of d.profiles) must(profiles, p.manager_id, "profiles.manager_id");
    for (const c of d.companies) must(profiles, c.owner_id, "companies.owner_id");
    for (const c of d.contacts) {
      must(companies, c.company_id, "contacts.company_id");
      must(profiles, c.owner_id, "contacts.owner_id");
    }
    for (const l of d.leads) {
      must(profiles, l.owner_id, "leads.owner_id");
      must(companies, l.company_id, "leads.company_id");
      must(contacts, l.contact_id, "leads.contact_id");
      must(deals, l.converted_deal_id, "leads.converted_deal_id");
    }
    for (const x of d.deals) {
      must(companies, x.company_id, "deals.company_id");
      must(contacts, x.primary_contact_id, "deals.primary_contact_id");
      must(stages, x.stage_id, "deals.stage_id");
      must(profiles, x.owner_id, "deals.owner_id");
      must(leads, x.lead_id, "deals.lead_id");
    }
    for (const h of d.deal_stage_history) {
      must(deals, h.deal_id, "history.deal_id");
      must(stages, h.from_stage_id, "history.from_stage_id");
      must(stages, h.to_stage_id, "history.to_stage_id");
      must(profiles, h.changed_by, "history.changed_by");
    }
    for (const o of d.orders) {
      must(companies, o.company_id, "orders.company_id");
      must(deals, o.source_deal_id, "orders.source_deal_id");
      must(profiles, o.owner_id, "orders.owner_id");
    }
    for (const i of d.order_items) {
      must(orders, i.order_id, "order_items.order_id");
      must(products, i.product_id, "order_items.product_id");
    }
    for (const p of d.payments) must(orders, p.order_id, "payments.order_id");
    for (const t of d.tasks) {
      must(profiles, t.assignee_id, "tasks.assignee_id");
      must(companies, t.company_id, "tasks.company_id");
      must(contacts, t.contact_id, "tasks.contact_id");
      must(deals, t.deal_id, "tasks.deal_id");
      must(orders, t.order_id, "tasks.order_id");
    }
    for (const a of d.activities) {
      must(profiles, a.actor_id, "activities.actor_id");
      must(companies, a.company_id, "activities.company_id");
      must(contacts, a.contact_id, "activities.contact_id");
      must(leads, a.lead_id, "activities.lead_id");
      must(deals, a.deal_id, "activities.deal_id");
      must(orders, a.order_id, "activities.order_id");
    }
    const entityIds: Record<string, Set<string>> = { deal: deals, task: tasks, company: companies, contact: contacts, order: orders, lead: leads };
    for (const c of d.comments) must(entityIds[c.entity_type]!, c.entity_id, "comments.entity_id");
    for (const n of d.notifications) must(profiles, n.recipient_id, "notifications.recipient_id");
  });

  it("keeps unique keys unique", () => {
    const unique = (values: Array<string | null>) => {
      const present = values.filter((v): v is string => v !== null);
      expect(new Set(present).size).toBe(present.length);
    };
    unique(seed.orders.map((o) => o.order_number));
    unique(seed.orders.map((o) => o.source_deal_id));
    unique(seed.leads.map((l) => l.converted_deal_id));
    unique(seed.notifications.map((n) => n.dedupe_key));
    unique(seed.products.map((p) => p.sku));
  });

  it("covers every stage, order status and an overdue case", () => {
    // Every stage of the default sales pipeline has deals; the tenders pipeline starts empty.
    const sales = seed.pipeline_stages.filter((s) => s.pipeline_id === DEMO_PIPELINE_IDS.sales);
    expect(new Set(seed.deals.map((d) => d.stage_id)).size).toBe(sales.length);
    expect(new Set(seed.orders.map((o) => o.status))).toEqual(new Set(["draft", "confirmed", "processing", "shipped", "delivered", "cancelled"]));
    expect(seed.orders.some((o) => o.payment_status === "overdue")).toBe(true);
    const nowIso = NOW.toISOString();
    expect(seed.tasks.some((t) => (t.status === "todo" || t.status === "in_progress") && t.due_at! < nowIso)).toBe(true);
    expect(seed.deal_stage_history.some((h) => h.changed_at < new Date(NOW.getTime() - 300 * 86_400_000).toISOString())).toBe(true);
  });

  it("stores order totals equal to the sum of their items", () => {
    for (const o of seed.orders) {
      const items = seed.order_items.filter((i) => i.order_id === o.id);
      expect(items.length).toBeGreaterThan(0);
      const totals = computeOrderTotals(items);
      expect(totals.total).toBe(o.total);
      expect(Math.round(items.reduce((s, i) => s + i.line_total, 0) * 100) / 100).toBe(o.total);
    }
  });

  it("keeps history consistent with each deal's current stage", () => {
    for (const deal of seed.deals) {
      const history = seed.deal_stage_history.filter((h) => h.deal_id === deal.id).sort((a, b) => a.changed_at.localeCompare(b.changed_at));
      expect(history[0]!.from_stage_id).toBeNull();
      expect(history.at(-1)!.to_stage_id).toBe(deal.stage_id);
    }
  });

  it("only produces past timestamps for things that already happened", () => {
    const nowIso = NOW.toISOString();
    for (const table of ["activities", "deal_stage_history", "payments"] as const) {
      for (const row of seed[table] as Array<Record<string, string>>) {
        const at = row.occurred_at ?? row.changed_at ?? row.paid_at;
        expect(at <= nowIso).toBe(true);
      }
    }
    for (const t of TABLES) for (const row of seed[t] as Array<{ created_at?: string }>) if (row.created_at) expect(row.created_at <= nowIso).toBe(true);
  });

  it("uses only fictional domains", () => {
    for (const p of seed.profiles) expect(p.email.endsWith(".example")).toBe(true);
    for (const c of seed.contacts) expect(c.email?.endsWith(".example")).toBe(true);
    for (const c of seed.companies) expect(c.website?.endsWith(".example")).toBe(true);
  });

  it("seeds three enabled example automations with a realistic run history", () => {
    expect(seed.automation_workflows).toHaveLength(3);
    expect(seed.automation_workflows.every((w) => w.enabled)).toBe(true);
    const statuses = new Set(seed.automation_executions.map((e) => e.status));
    expect(statuses).toEqual(new Set(["success", "failed", "skipped"]));
    const keys = seed.automation_executions.map((e) => e.idempotency_key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const e of seed.automation_executions) expect(seed.automation_workflows.some((w) => w.id === e.workflow_id)).toBe(true);
  });
});
