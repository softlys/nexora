/**
 * Deterministic seed generator.
 *
 * `generateSeed(now)` always produces the same records (same ids, names, amounts)
 * for the same SEED_NUMBER. Only the dates move: every timestamp is an offset from
 * `now`, so the demo never looks stale. The same dataset feeds the demo store and
 * the Supabase seed script.
 */
import {
  type Activity,
  type Comment,
  type Company,
  type Contact,
  type Dataset,
  type Deal,
  type DealStageHistory,
  type Lead,
  type LeadSource,
  type Notification,
  type Order,
  type OrderItem,
  type OrderStatus,
  type Organization,
  type Payment,
  type PipelineStage,
  type Product,
  type Profile,
  type Task,
  type TaskPriority,
  type TaskStatus,
  LEAD_SOURCES,
} from "../entities";
import { computeLineTotals, computeOrderTotals, roundMoney } from "../orders/totals";
import { derivePaymentStatus } from "../orders/payment-status";
import { seedAutomation } from "./automation";
import { createRng, type Rng } from "./random";
import {
  ACTIVITY_SUBJECTS,
  COMPANY_FIXTURES,
  CONTACT_TAGS,
  DEAL_NAME_TEMPLATES,
  FIRST_NAMES,
  JOB_TITLES,
  LAST_NAMES,
  LOST_REASONS,
  NEXT_ACTIONS,
  PRODUCT_FIXTURES,
  TASK_TITLES,
} from "./fixtures";

export const SEED_NUMBER = 20261018;

export const DEMO_ORG_ID = "00000000-0000-4000-8000-000000000001";

export const DEMO_USER_IDS = {
  admin: "00000000-0000-4000-8000-000000000101",
  manager: "00000000-0000-4000-8000-000000000102",
  repDaniel: "00000000-0000-4000-8000-000000000103",
  repSofia: "00000000-0000-4000-8000-000000000104",
  repEthan: "00000000-0000-4000-8000-000000000105",
} as const;

const DAY = 86_400_000;
const HOUR = 3_600_000;

type Clock = {
  now: Date;
  /** ISO timestamp `days` days from today (negative = past) at a business-hours time, clamped to now for past offsets. */
  at(days: number, rng: Rng): string;
  /** ISO timestamp exactly between two instants. */
  between(fromIso: string, toIso: string, rng: Rng): string;
  date(days: number): string;
  dateOf(iso: string): string;
  addDays(iso: string, days: number): string;
};

function createClock(now: Date): Clock {
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return {
    now,
    at(days, rng) {
      const t = dayStart + days * DAY + rng.int(8, 17) * HOUR + rng.int(0, 59) * 60_000;
      return new Date(days <= 0 ? Math.min(t, now.getTime() - 60_000) : t).toISOString();
    },
    between(fromIso, toIso, rng) {
      const from = Date.parse(fromIso);
      const to = Date.parse(toIso);
      return new Date(from + Math.floor(rng.next() * Math.max(0, to - from))).toISOString();
    },
    date(days) {
      return new Date(dayStart + days * DAY).toISOString().slice(0, 10);
    },
    dateOf(iso) {
      return iso.slice(0, 10);
    },
    addDays(iso, days) {
      return new Date(Date.parse(iso) + days * DAY).toISOString();
    },
  };
}

const latest = (...isos: string[]) => isos.reduce((a, b) => (a > b ? a : b));

export function generateSeed(now: Date = new Date()): Dataset {
  const rng = createRng(SEED_NUMBER);
  const clock = createClock(now);
  const nowIso = now.toISOString();
  const today = clock.date(0);
  const org = DEMO_ORG_ID;

  // -------------------------------------------------------------------------
  // Organization and users
  // -------------------------------------------------------------------------
  const orgCreated = clock.at(-420, rng);
  const organizations: Organization[] = [
    {
      id: org,
      name: "Atlasford Industrial Supply",
      slug: "atlasford",
      currency: "USD",
      locale: "en-US",
      timezone: "America/Chicago",
      settings: { order_conversion_mode: "draft" },
      created_at: orgCreated,
      updated_at: orgCreated,
    },
  ];

  const person = (
    key: keyof typeof DEMO_USER_IDS,
    full_name: string,
    role: Profile["role"],
    title: string,
    manager_id: string | null,
  ): Profile => ({
    id: DEMO_USER_IDS[key],
    organization_id: org,
    full_name,
    email: `${full_name.split(" ")[0]!.toLowerCase()}@atlasford.example`,
    role,
    title,
    manager_id,
    is_active: true,
    created_at: orgCreated,
    updated_at: orgCreated,
    archived_at: null,
  });

  const profiles: Profile[] = [
    person("admin", "Olivia Hart", "admin", "Head of Operations", null),
    person("manager", "Marcus Lindqvist", "manager", "Sales Manager, EMEA", DEMO_USER_IDS.admin),
    person("repDaniel", "Daniel Okafor", "sales_rep", "Account Executive", DEMO_USER_IDS.manager),
    person("repSofia", "Sofia Marin", "sales_rep", "Account Executive", DEMO_USER_IDS.manager),
    person("repEthan", "Ethan Brooks", "sales_rep", "Account Executive, Americas", DEMO_USER_IDS.admin),
  ];
  const managerOf = new Map(profiles.map((p) => [p.id, p.manager_id]));

  // -------------------------------------------------------------------------
  // Pipeline stages
  // -------------------------------------------------------------------------
  const stageDefs: Array<[string, number, boolean, boolean]> = [
    ["Qualification", 10, false, false],
    ["Discovery", 25, false, false],
    ["Proposal", 50, false, false],
    ["Negotiation", 75, false, false],
    ["Commitment", 90, false, false],
    ["Won", 100, true, false],
    ["Lost", 0, false, true],
  ];
  const pipeline_stages: PipelineStage[] = stageDefs.map(([name, probability, is_won, is_lost], position) => ({
    id: rng.uuid(),
    organization_id: org,
    name,
    position,
    probability,
    is_won,
    is_lost,
    created_at: orgCreated,
    updated_at: orgCreated,
  }));
  const openStages = pipeline_stages.filter((s) => !s.is_won && !s.is_lost);
  const wonStage = pipeline_stages.find((s) => s.is_won)!;
  const lostStage = pipeline_stages.find((s) => s.is_lost)!;

  // -------------------------------------------------------------------------
  // Companies and contacts
  // -------------------------------------------------------------------------
  const ownerPool = rng.shuffle([
    ...Array(6).fill(DEMO_USER_IDS.repDaniel),
    ...Array(6).fill(DEMO_USER_IDS.repSofia),
    ...Array(5).fill(DEMO_USER_IDS.repEthan),
    ...Array(4).fill(DEMO_USER_IDS.manager),
    ...Array(4).fill(DEMO_USER_IDS.admin),
  ]) as string[];

  const companies: Company[] = COMPANY_FIXTURES.map((f, i) => {
    const created = clock.at(-rng.int(140, 400), rng);
    return {
      id: rng.uuid(),
      organization_id: org,
      name: f.name,
      website: `https://www.${f.slug}.example`,
      industry: f.industry,
      size: f.size,
      country: f.country,
      city: f.city,
      address: f.street,
      phone: `${f.dial} 555 0${String(100 + i).padStart(3, "0")}`,
      lifecycle_stage: f.lifecycle,
      owner_id: ownerPool[i]!,
      notes: "",
      created_at: created,
      updated_at: created,
      archived_at: null,
    };
  });

  const contacts: Contact[] = [];
  const contactsByCompany = new Map<string, Contact[]>();
  let nameCursor = 0;
  companies.forEach((company, ci) => {
    const count = rng.int(2, 4);
    const list: Contact[] = [];
    for (let k = 0; k < count; k++) {
      const first = FIRST_NAMES[(nameCursor * 7 + ci) % FIRST_NAMES.length]!;
      const last = LAST_NAMES[(nameCursor * 11 + k * 3 + ci) % LAST_NAMES.length]!;
      nameCursor++;
      const created = clock.between(company.created_at, clock.addDays(company.created_at, 60), rng);
      const slug = COMPANY_FIXTURES[ci]!.slug;
      const contact: Contact = {
        id: rng.uuid(),
        organization_id: org,
        company_id: company.id,
        first_name: first,
        last_name: last,
        email: `${first}.${last}@${slug}.example`.toLowerCase(),
        phone: `${COMPANY_FIXTURES[ci]!.dial} 555 0${String(200 + contacts.length).padStart(3, "0")}`,
        job_title: k === 0 ? rng.pick(JOB_TITLES.slice(0, 6)) : rng.pick(JOB_TITLES),
        owner_id: company.owner_id,
        tags: rng.shuffle(CONTACT_TAGS).slice(0, rng.int(0, 2)),
        created_at: created,
        updated_at: created,
        archived_at: null,
      };
      list.push(contact);
      contacts.push(contact);
    }
    contactsByCompany.set(company.id, list);
  });

  // -------------------------------------------------------------------------
  // Products
  // -------------------------------------------------------------------------
  const products: Product[] = PRODUCT_FIXTURES.map((p) => ({
    id: rng.uuid(),
    organization_id: org,
    sku: p.sku,
    name: p.name,
    category: p.category,
    description: p.description,
    unit_price: p.price,
    currency: "USD",
    tax_rate: p.tax,
    is_active: true,
    created_at: orgCreated,
    updated_at: orgCreated,
    archived_at: null,
  }));

  // -------------------------------------------------------------------------
  // Deals with stage history
  // -------------------------------------------------------------------------
  type Outcome = { kind: "open"; stageIndex: number } | { kind: "won" } | { kind: "lost" };
  const outcomes: Outcome[] = rng.shuffle([
    ...Array.from({ length: 7 }, () => ({ kind: "open", stageIndex: 0 }) as Outcome),
    ...Array.from({ length: 8 }, () => ({ kind: "open", stageIndex: 1 }) as Outcome),
    ...Array.from({ length: 8 }, () => ({ kind: "open", stageIndex: 2 }) as Outcome),
    ...Array.from({ length: 7 }, () => ({ kind: "open", stageIndex: 3 }) as Outcome),
    ...Array.from({ length: 5 }, () => ({ kind: "open", stageIndex: 4 }) as Outcome),
    ...Array.from({ length: 16 }, () => ({ kind: "won" }) as Outcome),
    ...Array.from({ length: 9 }, () => ({ kind: "lost" }) as Outcome),
  ]);

  const deals: Deal[] = [];
  const deal_stage_history: DealStageHistory[] = [];
  const usedNames = new Set<string>();

  outcomes.forEach((outcome) => {
    const company = rng.pick(companies);
    const companyContacts = contactsByCompany.get(company.id)!;
    let name = rng.pick(DEAL_NAME_TEMPLATES).replace("{company}", company.name);
    if (usedNames.has(name)) name = `${name} (phase ${[...usedNames].filter((n) => n.startsWith(name)).length + 1})`;
    usedNames.add(name);

    const closed = outcome.kind !== "open";
    const created = closed ? clock.at(-rng.int(45, 360), rng) : clock.at(-rng.int(4, 200), rng);
    const closedAt = closed ? clock.between(clock.addDays(created, 14), clock.addDays(nowIso, -1), rng) : null;
    const endOfHistory = closedAt ?? clock.addDays(nowIso, -rng.int(0, 3));

    // Path through the pipeline: open stages up to the target, then won/lost for closed deals.
    const lastOpenIndex =
      outcome.kind === "open" ? outcome.stageIndex : outcome.kind === "won" ? rng.int(2, 4) : rng.int(0, 3);
    const path: PipelineStage[] = openStages.slice(0, lastOpenIndex + 1);
    if (outcome.kind === "won") path.push(wonStage);
    if (outcome.kind === "lost") path.push(lostStage);

    const dealId = rng.uuid();
    const owner = rng.chance(0.85) ? company.owner_id : rng.pick(profiles.filter((p) => p.role !== "admin")).id;
    let previous: string | null = null;
    let cursor = created;
    path.forEach((stage, i) => {
      const changedAt: string =
        i === 0 ? created : i === path.length - 1 && closedAt ? closedAt : clock.between(cursor, endOfHistory, rng);
      deal_stage_history.push({
        id: rng.uuid(),
        organization_id: org,
        deal_id: dealId,
        from_stage_id: previous,
        to_stage_id: stage.id,
        changed_by: owner,
        changed_at: changedAt,
      });
      previous = stage.id;
      cursor = changedAt;
    });

    const finalStage = path[path.length - 1]!;
    const amount = rng.int(50, 2500) * 100;
    const expectedClose =
      outcome.kind === "open"
        ? rng.chance(0.15)
          ? clock.date(-rng.int(3, 20))
          : clock.date(rng.int(7, 120))
        : clock.dateOf(closedAt!);

    deals.push({
      id: dealId,
      organization_id: org,
      name,
      company_id: company.id,
      primary_contact_id: companyContacts[0]!.id,
      amount,
      currency: "USD",
      stage_id: finalStage.id,
      probability: finalStage.probability,
      expected_close_date: expectedClose,
      owner_id: owner,
      source: rng.pick(LEAD_SOURCES.filter((s) => s !== "api")) as LeadSource,
      next_activity: outcome.kind === "open" ? rng.pick(NEXT_ACTIONS) : "",
      notes: "",
      lost_reason: outcome.kind === "lost" ? rng.pick(LOST_REASONS) : null,
      stage_entered_at: cursor,
      closed_at: closedAt,
      lead_id: null,
      created_at: created,
      updated_at: cursor,
      archived_at: null,
    });
  });

  // -------------------------------------------------------------------------
  // Leads (8 converted into existing deals, the rest open or disqualified)
  // -------------------------------------------------------------------------
  const leads: Lead[] = [];
  const convertible = deals.filter((d) => d.lost_reason === null).slice(0, 8);
  convertible.forEach((deal) => {
    const company = companies.find((c) => c.id === deal.company_id)!;
    const contact = contacts.find((c) => c.id === deal.primary_contact_id)!;
    const created = clock.addDays(deal.created_at, -rng.int(3, 21));
    deal.lead_id = null; // set below once the lead id exists
    const leadId = rng.uuid();
    deal.lead_id = leadId;
    leads.push({
      id: leadId,
      organization_id: org,
      title: `${company.name} inquiry`,
      company_name: company.name,
      contact_name: `${contact.first_name} ${contact.last_name}`,
      email: contact.email,
      phone: contact.phone,
      country: company.country,
      source: deal.source,
      status: "converted",
      qualification: "hot",
      owner_id: deal.owner_id,
      next_action: "",
      next_action_at: null,
      estimated_value: deal.amount,
      currency: "USD",
      company_id: company.id,
      contact_id: contact.id,
      converted_deal_id: deal.id,
      converted_at: deal.created_at,
      created_at: created,
      updated_at: deal.created_at,
      archived_at: null,
    });
  });

  const leadStatuses: Array<Lead["status"]> = rng.shuffle([
    ...Array(10).fill("new"),
    ...Array(9).fill("contacted"),
    ...Array(8).fill("qualified"),
    ...Array(5).fill("unqualified"),
  ]) as Array<Lead["status"]>;
  const leadIndustries = ["Process Engineering", "Logistics", "Food Systems", "Metalworks", "Plastics", "Utilities", "Building Services", "Marine"];
  const leadCountries = ["US", "DE", "NL", "GB", "FR", "SE", "PL", "ES", "IT", "CA", "DK", "BE", "AT", "CH", "FI"];
  const repPool = [DEMO_USER_IDS.repDaniel, DEMO_USER_IDS.repSofia, DEMO_USER_IDS.repEthan, DEMO_USER_IDS.manager];
  leadStatuses.forEach((status, i) => {
    const last = LAST_NAMES[(i * 7 + 3) % LAST_NAMES.length]!;
    const first = FIRST_NAMES[(i * 5 + 11) % FIRST_NAMES.length]!;
    const companyName = `${LAST_NAMES[(i * 13 + 5) % LAST_NAMES.length]} ${leadIndustries[i % leadIndustries.length]}`;
    const created = status === "new" ? clock.at(-rng.int(0, 14), rng) : clock.at(-rng.int(10, 120), rng);
    const unassigned = status === "new" && i % 3 === 0;
    const qualification = status === "qualified" ? rng.pick(["warm", "hot"] as const) : status === "unqualified" ? "cold" : rng.pick(["cold", "warm"] as const);
    leads.push({
      id: rng.uuid(),
      organization_id: org,
      title: `${companyName} - ${rng.pick(["pump replacement", "compressor quote", "conveyor project", "safety audit follow-up", "spare parts contract", "motor upgrade"])}`,
      company_name: companyName,
      contact_name: `${first} ${last}`,
      email: `${first}.${last}@${companyName.toLowerCase().replace(/[^a-z]+/g, "-")}.example`.toLowerCase(),
      phone: null,
      country: leadCountries[i % leadCountries.length]!,
      source: rng.pick(LEAD_SOURCES.filter((s) => s !== "api")) as LeadSource,
      status,
      qualification,
      owner_id: unassigned ? null : rng.pick(repPool),
      next_action: status === "unqualified" ? "" : rng.pick(NEXT_ACTIONS),
      next_action_at: status === "unqualified" ? null : clock.at(rng.int(-5, 14), rng),
      estimated_value: rng.int(20, 1500) * 100,
      currency: "USD",
      company_id: null,
      contact_id: null,
      converted_deal_id: null,
      converted_at: null,
      created_at: created,
      updated_at: created,
      archived_at: null,
    });
  });

  // -------------------------------------------------------------------------
  // Orders, items and simulated payments
  // -------------------------------------------------------------------------
  type Draft = { company: Company; owner: string; orderDate: string; deal: Deal | null; target: number };
  const wonDeals = deals.filter((d) => d.stage_id === wonStage.id);
  const drafts: Draft[] = wonDeals.slice(0, 13).map((deal) => ({
    company: companies.find((c) => c.id === deal.company_id)!,
    owner: deal.owner_id,
    orderDate: clock.addDays(deal.closed_at!, rng.int(0, 3)),
    deal,
    target: deal.amount,
  }));
  const buyers = companies.filter((c) => c.lifecycle_stage === "customer" || c.lifecycle_stage === "partner");
  while (drafts.length < 40) {
    const company = rng.pick(buyers);
    drafts.push({ company, owner: company.owner_id, orderDate: clock.at(-rng.int(0, 360), rng), deal: null, target: rng.int(15, 900) * 100 });
  }
  for (const d of drafts) if (d.orderDate > nowIso) d.orderDate = clock.addDays(nowIso, -1);

  // Youngest orders are drafts/confirmed, oldest are delivered; a few become cancelled.
  const byAge = [...drafts].sort((a, b) => (a.orderDate < b.orderDate ? 1 : -1));
  const statusPlan: OrderStatus[] = [
    ...Array<OrderStatus>(4).fill("draft"),
    ...Array<OrderStatus>(6).fill("confirmed"),
    ...Array<OrderStatus>(7).fill("processing"),
    ...Array<OrderStatus>(7).fill("shipped"),
    ...Array<OrderStatus>(16).fill("delivered"),
  ];
  const statusOf = new Map<Draft, OrderStatus>(byAge.map((d, i) => [d, statusPlan[i]!]));
  const cancellable = byAge.filter((d) => statusOf.get(d) !== "draft" && d.deal === null);
  rng.shuffle(cancellable).slice(0, 4).forEach((d) => statusOf.set(d, "cancelled"));

  const orders: Order[] = [];
  const order_items: OrderItem[] = [];
  const payments: Payment[] = [];
  const chronological = [...drafts].sort((a, b) => (a.orderDate < b.orderDate ? -1 : 1));
  const sequenceByYear = new Map<string, number>();

  chronological.forEach((d) => {
    const status = statusOf.get(d)!;
    const orderId = rng.uuid();
    const year = d.orderDate.slice(0, 4);
    const seq = (sequenceByYear.get(year) ?? 0) + 1;
    sequenceByYear.set(year, seq);

    // Items: 1-4 products scaled so the order lands near the target value.
    const lineProducts = rng.shuffle(products).slice(0, rng.int(1, 4));
    const lines = lineProducts.map((p, position) => {
      const share = d.target / lineProducts.length;
      const quantity = Math.max(1, Math.round(share / p.unit_price));
      const discount_pct = rng.weighted([
        [0, 6],
        [5, 2],
        [10, 1],
      ] as const);
      const totals = computeLineTotals({ quantity, unit_price: p.unit_price, discount_pct, tax_rate: p.tax_rate });
      return { product: p, quantity, discount_pct, totals, position };
    });
    const totals = computeOrderTotals(
      lines.map((l) => ({ quantity: l.quantity, unit_price: l.product.unit_price, discount_pct: l.discount_pct, tax_rate: l.product.tax_rate })),
    );
    lines.forEach((l) =>
      order_items.push({
        id: rng.uuid(),
        organization_id: org,
        order_id: orderId,
        product_id: l.product.id,
        description: l.product.name,
        quantity: l.quantity,
        unit_price: l.product.unit_price,
        discount_pct: l.discount_pct,
        tax_rate: l.product.tax_rate,
        line_total: l.totals.total,
        position: l.position,
        created_at: d.orderDate,
        updated_at: d.orderDate,
      }),
    );

    const orderDay = clock.dateOf(d.orderDate);
    const dueDate = status === "draft" ? null : clock.dateOf(clock.addDays(d.orderDate, 30));
    const deliveredAt =
      status === "delivered" ? new Date(Math.min(Date.parse(clock.addDays(d.orderDate, rng.int(10, 35))), now.getTime() - HOUR)).toISOString() : null;

    // Simulated payments: delivered orders are mostly paid, some partially or not at all (some become overdue).
    let collected = 0;
    const pay = (amount: number, from: string) => {
      const value = roundMoney(amount);
      if (value <= 0) return;
      payments.push({
        id: rng.uuid(),
        organization_id: org,
        order_id: orderId,
        amount: value,
        currency: "USD",
        paid_at: clock.between(from, nowIso, rng),
        method: rng.weighted([
          ["bank_transfer", 7],
          ["card", 2],
          ["other", 1],
        ] as const),
        reference: `SIM-${year}-${String(payments.length + 1).padStart(5, "0")}`,
        is_simulated: true,
        recorded_by: d.owner,
        created_at: from,
        updated_at: from,
      });
      collected += value;
    };
    const roll = rng.next();
    if (status === "delivered") {
      if (roll < 0.68) pay(totals.total, d.orderDate);
      else if (roll < 0.84) {
        pay(totals.total * 0.5, d.orderDate);
        pay(totals.total - roundMoney(totals.total * 0.5), d.orderDate);
      } else if (roll < 0.92) pay(totals.total * 0.4, d.orderDate);
    } else if (status === "shipped") {
      if (roll < 0.5) pay(totals.total, d.orderDate);
      else if (roll < 0.75) pay(totals.total * 0.3, d.orderDate);
    } else if (status === "processing" || status === "confirmed") {
      if (roll < 0.3) pay(totals.total, d.orderDate);
      else if (roll < 0.7) pay(totals.total * 0.3, d.orderDate);
    }

    const created = d.orderDate;
    orders.push({
      id: orderId,
      organization_id: org,
      order_number: `NX-${year}-${String(seq).padStart(4, "0")}`,
      company_id: d.company.id,
      source_deal_id: d.deal?.id ?? null,
      status,
      payment_status: derivePaymentStatus({ total: totals.total, collected, status, payment_due_date: dueDate, today }),
      fulfillment_status:
        status === "delivered"
          ? "fulfilled"
          : status === "shipped"
            ? rng.pick(["partially_fulfilled", "fulfilled"] as const)
            : "unfulfilled",
      currency: "USD",
      ...totals,
      order_date: orderDay,
      payment_due_date: dueDate,
      expected_delivery_date: clock.dateOf(clock.addDays(d.orderDate, rng.int(14, 45))),
      delivered_at: deliveredAt,
      owner_id: d.owner,
      notes: "",
      created_at: created,
      updated_at: latest(created, deliveredAt ?? created),
      archived_at: null,
    });
  });

  // -------------------------------------------------------------------------
  // Tasks
  // -------------------------------------------------------------------------
  const openDeals = deals.filter((d) => d.closed_at === null);
  const activeOrders = orders.filter((o) => o.status !== "cancelled" && o.status !== "draft");
  const taskStatuses: TaskStatus[] = rng.shuffle([
    ...Array<TaskStatus>(30).fill("done"),
    ...Array<TaskStatus>(30).fill("todo"),
    ...Array<TaskStatus>(12).fill("in_progress"),
    ...Array<TaskStatus>(8).fill("cancelled"),
  ]);
  const tasks: Task[] = taskStatuses.map((status, i) => {
    const link = i % 4;
    const deal = link <= 1 ? rng.pick(openDeals) : null;
    const order = link === 2 ? rng.pick(activeOrders) : null;
    const company =
      companies.find((c) => c.id === (deal?.company_id ?? order?.company_id)) ?? rng.pick(companies);
    const contact = contactsByCompany.get(company.id)![0]!;
    const assignee = deal?.owner_id ?? order?.owner_id ?? company.owner_id;
    const created = clock.at(-rng.int(1, 90), rng);
    const open = status === "todo" || status === "in_progress";
    const overdue = open && rng.chance(0.4);
    const dueAt = open ? (overdue ? clock.at(-rng.int(1, 12), rng) : clock.at(rng.int(1, 21), rng)) : clock.addDays(created, rng.int(1, 14));
    const title = rng
      .pick(TASK_TITLES)
      .replace("{company}", company.name)
      .replace("{contact}", `${contact.first_name} ${contact.last_name}`);
    const type = title.startsWith("Follow up") ? "follow_up" : title.startsWith("Call") ? "call" : title.startsWith("Send") ? "email" : rng.pick(["todo", "follow_up", "meeting"] as const);
    const priority = rng.weighted<TaskPriority>([
      ["low", 2],
      ["medium", 4],
      ["high", 3],
      ["urgent", 1],
    ]);
    const completedAt = status === "done" ? new Date(Math.min(Date.parse(clock.addDays(created, rng.int(0, 10))), now.getTime() - HOUR)).toISOString() : null;
    return {
      id: rng.uuid(),
      organization_id: org,
      title,
      description: "",
      type,
      assignee_id: assignee,
      created_by: managerOf.get(assignee) && rng.chance(0.3) ? managerOf.get(assignee)! : assignee,
      due_at: dueAt,
      priority,
      status,
      completed_at: completedAt,
      company_id: company.id,
      contact_id: contact.id,
      deal_id: deal?.id ?? null,
      order_id: order?.id ?? null,
      created_at: created,
      updated_at: completedAt ?? created,
      archived_at: null,
    };
  });

  // -------------------------------------------------------------------------
  // Activities
  // -------------------------------------------------------------------------
  const activities: Activity[] = [];
  const addActivity = (a: Omit<Activity, "id" | "organization_id" | "created_at" | "updated_at" | "body"> & { body?: string }) =>
    activities.push({ id: rng.uuid(), organization_id: org, body: a.body ?? "", created_at: a.occurred_at, updated_at: a.occurred_at, ...a });

  deals.forEach((deal) => {
    const end = deal.closed_at ?? nowIso;
    const count = rng.int(2, 6);
    for (let k = 0; k < count; k++) {
      const type = rng.pick(["call", "meeting", "email", "note", "follow_up"] as const);
      addActivity({
        type,
        subject: rng.pick(ACTIVITY_SUBJECTS[type]),
        occurred_at: clock.between(deal.created_at, end, rng),
        actor_id: deal.owner_id,
        company_id: deal.company_id,
        contact_id: deal.primary_contact_id,
        lead_id: null,
        deal_id: deal.id,
        order_id: null,
      });
    }
  });
  companies.forEach((company) => {
    const type = rng.pick(["call", "email", "note"] as const);
    addActivity({
      type,
      subject: rng.pick(ACTIVITY_SUBJECTS[type]),
      occurred_at: clock.between(company.created_at, nowIso, rng),
      actor_id: company.owner_id,
      company_id: company.id,
      contact_id: contactsByCompany.get(company.id)![rng.int(0, 1)]?.id ?? null,
      lead_id: null,
      deal_id: null,
      order_id: null,
    });
  });
  orders
    .filter((o) => o.status !== "draft")
    .forEach((o) =>
      addActivity({
        type: "email",
        subject: "Confirmed delivery window",
        occurred_at: clock.between(o.created_at, latest(o.created_at, o.delivered_at ?? nowIso), rng),
        actor_id: o.owner_id,
        company_id: o.company_id,
        contact_id: contactsByCompany.get(o.company_id)![0]!.id,
        lead_id: null,
        deal_id: null,
        order_id: o.id,
      }),
    );
  leads
    .filter((l) => l.status === "contacted" || l.status === "qualified")
    .forEach((l) =>
      addActivity({
        type: rng.pick(["call", "email"] as const),
        subject: l.status === "qualified" ? "Qualification call" : "Intro email sent",
        occurred_at: clock.between(l.created_at, nowIso, rng),
        actor_id: l.owner_id,
        company_id: null,
        contact_id: null,
        lead_id: l.id,
        deal_id: null,
        order_id: null,
      }),
    );
  activities.sort((a, b) => (a.occurred_at < b.occurred_at ? -1 : 1));

  // -------------------------------------------------------------------------
  // Comments and notifications
  // -------------------------------------------------------------------------
  const comments: Comment[] = [];
  const commentBodies = [
    "Customer asked for a lead time comparison with the previous order.",
    "Procurement wants the quote split into two phases.",
    "Site visit confirmed, bring the alignment tool.",
    "Finance approved the extended payment terms.",
    "Please double-check the voltage spec before sending.",
    "They mentioned a second site that could need the same setup.",
  ];
  rng.shuffle(openDeals).slice(0, 12).forEach((deal) => {
    const author = rng.chance(0.4) && managerOf.get(deal.owner_id) ? managerOf.get(deal.owner_id)! : deal.owner_id;
    const at = clock.between(deal.created_at, nowIso, rng);
    comments.push({ id: rng.uuid(), organization_id: org, entity_type: "deal", entity_id: deal.id, author_id: author, body: rng.pick(commentBodies), created_at: at, updated_at: at, archived_at: null });
  });
  rng.shuffle(tasks.filter((t) => t.status !== "done")).slice(0, 8).forEach((task) => {
    const at = clock.between(task.created_at, nowIso, rng);
    comments.push({ id: rng.uuid(), organization_id: org, entity_type: "task", entity_id: task.id, author_id: task.assignee_id, body: rng.pick(commentBodies), created_at: at, updated_at: at, archived_at: null });
  });

  const notifications: Notification[] = [];
  profiles.forEach((p) => {
    const mine = tasks.filter((t) => t.assignee_id === p.id && t.status !== "done" && t.status !== "cancelled");
    mine.slice(0, 2).forEach((t, k) => {
      const at = clock.between(t.created_at, nowIso, rng);
      notifications.push({
        id: rng.uuid(),
        organization_id: org,
        recipient_id: p.id,
        type: "task.assigned",
        title: "Task assigned to you",
        body: t.title,
        link: "/tasks",
        read_at: k === 0 ? null : at,
        dedupe_key: `seed:task.assigned:${t.id}`,
        created_at: at,
      });
    });
    const won = deals.filter((d) => d.owner_id === p.id && d.stage_id === wonStage.id).slice(0, 1);
    won.forEach((d) =>
      notifications.push({
        id: rng.uuid(),
        organization_id: org,
        recipient_id: p.id,
        type: "deal.won",
        title: "Deal won",
        body: `${d.name} moved to Won.`,
        link: "/deals",
        read_at: d.closed_at,
        dedupe_key: `seed:deal.won:${d.id}`,
        created_at: d.closed_at!,
      }),
    );
  });
  const overdueOrder = orders.find((o) => o.payment_status === "overdue");
  if (overdueOrder) {
    [DEMO_USER_IDS.admin, DEMO_USER_IDS.manager].forEach((recipient) =>
      notifications.push({
        id: rng.uuid(),
        organization_id: org,
        recipient_id: recipient,
        type: "order.payment_overdue",
        title: "Payment overdue",
        body: `${overdueOrder.order_number} is past its payment due date.`,
        link: "/orders",
        read_at: null,
        dedupe_key: `seed:order.overdue:${overdueOrder.id}:${recipient}`,
        created_at: clock.at(-1, rng),
      }),
    );
  }

  const dataset: Dataset = {
    organizations,
    profiles,
    companies,
    contacts,
    leads,
    pipeline_stages,
    deals,
    deal_stage_history,
    products,
    orders,
    order_items,
    payments,
    tasks,
    activities,
    comments,
    notifications,
    automation_workflows: [],
    automation_executions: [],
    integration_settings: [],
    webhook_deliveries: [],
    api_keys: [],
    api_idempotency_keys: [],
    audit_logs: [],
    security_events: [],
  };
  // Example automations and their run history (separate PRNG stream; see seed/automation.ts).
  const automation = seedAutomation(dataset, now, DEMO_USER_IDS.admin);
  dataset.automation_workflows = automation.automation_workflows;
  dataset.automation_executions = automation.automation_executions;
  dataset.notifications = [...dataset.notifications, ...automation.notifications];
  return dataset;
}
