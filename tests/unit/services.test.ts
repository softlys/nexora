import { beforeEach, describe, expect, it } from "vitest";
import type { Dataset } from "@/domain/entities";
import { companyInput, companyUpdateInput, dealUpdateInput, moveStageInput, orderInput } from "@/domain/inputs";
import { PermissionError } from "@/domain/permissions";
import { DomainError } from "@/server/repositories/types";
import { createCompany, getCompany, updateCompany } from "@/server/services/companies";
import { getContact } from "@/server/services/contacts";
import { flushSecurityEvents, NotFoundError, type ServiceContext } from "@/server/services/context";
import { getDeal, moveDealStage, quickEditDeal, updateDeal } from "@/server/services/deals";
import { convertLead, getLead } from "@/server/services/leads";
import { changeOrderStatus, convertDealToOrder, createOrder, getOrder, recordPayment } from "@/server/services/orders";
import { archiveRecord, hardDeleteRecord, restoreRecord } from "@/server/services/records";
import { globalSearch } from "@/server/services/search";
import { createTask, getTask, setTaskDone } from "@/server/services/tasks";
import { RateLimiter } from "@/server/security/rate-limit";
import { ValidationLog } from "@/server/security/validation-log";
import type { Db } from "@/server/db/types";
import { createTestDb, ctxFor, DEMO_USER_IDS } from "./helpers/services";

let db: Db;
let data: () => Dataset;
let admin: ServiceContext;
let manager: ServiceContext;
let daniel: ServiceContext;


beforeEach(() => {
  ({ db, data } = createTestDb());
  admin = ctxFor(db, data(), DEMO_USER_IDS.admin);
  manager = ctxFor(db, data(), DEMO_USER_IDS.manager);
  daniel = ctxFor(db, data(), DEMO_USER_IDS.repDaniel);

});

const wonStage = () => data().pipeline_stages.find((s) => s.is_won)!;
const lostStage = () => data().pipeline_stages.find((s) => s.is_lost)!;
const firstStage = () => [...data().pipeline_stages].sort((a, b) => a.position - b.position)[0]!;
const ownedBy = <T extends { owner_id: string | null }>(rows: T[], owner: string) => rows.find((r) => r.owner_id === owner)!;

async function securityActions(ctx: ServiceContext) {
  await flushSecurityEvents(ctx);
  return data().security_events.map((e) => e.action);
}

describe("tenant isolation and IDOR", () => {
  it("returns not found for another rep's records, for every entity, and logs authz.denied", async () => {
    const d = data();
    const sofia = DEMO_USER_IDS.repSofia;
    const attempts = [
      () => getCompany(daniel, ownedBy(d.companies, sofia).id),
      () => getContact(daniel, ownedBy(d.contacts, sofia).id),
      () => getLead(daniel, ownedBy(d.leads, sofia).id),
      () => getDeal(daniel, ownedBy(d.deals, sofia).id),
      () => getOrder(daniel, ownedBy(d.orders, sofia).id),
      () => getTask(daniel, d.tasks.find((t) => t.assignee_id === sofia)!.id),
    ];
    for (const attempt of attempts) await expect(attempt()).rejects.toBeInstanceOf(NotFoundError);
    const actions = await securityActions(daniel);
    expect(actions.filter((a) => a === "authz.denied")).toHaveLength(attempts.length);
  });

  it("does not let a manager see another team's records", async () => {
    const ethansDeal = ownedBy(data().deals, DEMO_USER_IDS.repEthan);
    await expect(getDeal(manager, ethansDeal.id)).rejects.toBeInstanceOf(NotFoundError);
    const danielsDeal = ownedBy(data().deals, DEMO_USER_IDS.repDaniel);
    await expect(getDeal(manager, danielsDeal.id)).resolves.toBeTruthy();
  });

  it("cannot reach records of another organization by id", async () => {
    const foreign = ctxFor(db, data(), DEMO_USER_IDS.admin);
    foreign.actor = { ...foreign.actor, organization_id: "00000000-0000-4000-8000-0000000000ff" };
    await expect(getCompany(foreign, data().companies[0]!.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("returns not found when a sales rep tries to edit another rep's deal", async () => {
    const sofiasDeal = ownedBy(data().deals, DEMO_USER_IDS.repSofia);
    const input = dealUpdateInput.parse({
      id: sofiasDeal.id,
      name: "Hijacked",
      company_id: sofiasDeal.company_id,
      primary_contact_id: sofiasDeal.primary_contact_id,
      amount: 1,
      currency: "USD",
      expected_close_date: null,
      source: sofiasDeal.source,
      next_activity: "",
      notes: "",
    });
    await expect(updateDeal(daniel, input)).rejects.toBeInstanceOf(NotFoundError);
    expect(data().deals.find((x) => x.id === sofiasDeal.id)!.name).toBe(sofiasDeal.name);
  });

  it("only shows visible records in global search", async () => {
    const sofiasCompany = ownedBy(data().companies, DEMO_USER_IDS.repSofia);
    const results = await globalSearch(daniel, sofiasCompany.name.slice(0, 8));
    expect(results.some((r) => r.id === sofiasCompany.id)).toBe(false);
    const adminResults = await globalSearch(admin, sofiasCompany.name.slice(0, 8));
    expect(adminResults.some((r) => r.id === sofiasCompany.id)).toBe(true);
  });
});

describe("mass assignment and protected fields", () => {
  it("rejects unknown and server-owned fields in payloads", () => {
    const base = { name: "X", website: null, industry: "Mining", size: "1-10", country: "DE", city: "", address: "", phone: null, lifecycle_stage: "prospect", notes: "" };
    expect(companyInput.safeParse(base).success).toBe(true);
    expect(companyInput.safeParse({ ...base, organization_id: "x" }).success).toBe(false);
    expect(companyInput.safeParse({ ...base, archived_at: null }).success).toBe(false);
    expect(orderInput.safeParse({ company_id: data().companies[0]!.id, currency: "USD", order_date: "2026-10-19", expected_delivery_date: null, notes: "", items: [{ description: "x", product_id: null, quantity: 1, unit_price: 1, discount_pct: 0, tax_rate: 0 }], total: 0 }).success).toBe(false);
    expect(moveStageInput.safeParse({ deal_id: data().deals[0]!.id, stage_id: firstStage().id, probability: 100 }).success).toBe(false);
  });

  it("does not let a sales rep reassign a record", async () => {
    const company = ownedBy(data().companies, DEMO_USER_IDS.repDaniel);
    const { id, name, website, industry, size, country, city, address, phone, lifecycle_stage, notes } = company;
    const input = companyUpdateInput.parse({ id, name, website, industry, size, country, city, address, phone, lifecycle_stage, notes, owner_id: DEMO_USER_IDS.repSofia });
    await expect(updateCompany(daniel, input)).rejects.toBeInstanceOf(PermissionError);
    expect(await securityActions(daniel)).toContain("authz.denied");
  });

  it("lets a manager reassign within the team, records owner_changed, but not outside it", async () => {
    const company = ownedBy(data().companies, DEMO_USER_IDS.repDaniel);
    const strip = ({ id, name, website, industry, size, country, city, address, phone, lifecycle_stage, notes }: typeof company) => ({ id, name, website, industry, size, country, city, address, phone, lifecycle_stage, notes });
    await updateCompany(manager, companyUpdateInput.parse({ ...strip(company), owner_id: DEMO_USER_IDS.repSofia }));
    expect(data().companies.find((c) => c.id === company.id)!.owner_id).toBe(DEMO_USER_IDS.repSofia);
    const ownerEvent = data().security_events.find((e) => e.action === "record.owner_changed" && e.target.id === company.id)!;
    expect(ownerEvent.metadata).toMatchObject({ from: DEMO_USER_IDS.repDaniel, to: DEMO_USER_IDS.repSofia });
    await expect(updateCompany(manager, companyUpdateInput.parse({ ...strip(company), owner_id: DEMO_USER_IDS.repEthan }))).rejects.toBeInstanceOf(PermissionError);
  });

  it("does not let a sales rep change the amount of a won deal", async () => {
    const reps = data().profiles.filter((p) => p.role === "sales_rep").map((p) => p.id);
    const won = data().deals.find((d) => d.stage_id === wonStage().id && reps.includes(d.owner_id))!;
    expect(won).toBeDefined();
    const rep = ctxFor(db, data(), won.owner_id);
    await expect(quickEditDeal(rep, { id: won.id, amount: won.amount + 1000 })).rejects.toBeInstanceOf(PermissionError);
    await expect(quickEditDeal(manager.actor.team_member_ids.includes(won.owner_id) ? manager : admin, { id: won.id, amount: won.amount + 1000 })).resolves.toBeTruthy();
  });

  it("writes an audit entry with a before/after diff and request metadata", async () => {
    const company = ownedBy(data().companies, DEMO_USER_IDS.repDaniel);
    const { id, name, website, industry, size, country, city, address, phone, lifecycle_stage } = company;
    await updateCompany(daniel, companyUpdateInput.parse({ id, name, website, industry, size, country, city, address, phone, lifecycle_stage, notes: "Prefers email" }));
    const log = data().audit_logs.find((l) => l.action === "record.updated" && l.target_id === id)!;
    expect(log.actor_id).toBe(DEMO_USER_IDS.repDaniel);
    expect(log.actor_role).toBe("sales_rep");
    expect(log.ip).toBe("127.0.0.1");
    expect(log.request_id).toBe("test-request");
    expect(log.changes.changes).toEqual({ notes: { before: "", after: "Prefers email" } });
  });
});

describe("leads", () => {
  it("converts a lead into a company, contact and deal exactly once", async () => {
    const lead = data().leads.find((l) => l.status === "qualified" && l.owner_id === DEMO_USER_IDS.repDaniel)
      ?? data().leads.find((l) => l.status === "qualified")!;
    const ctx = ctxFor(db, data(), lead.owner_id!);
    const input = {
      lead_id: lead.id,
      company: { mode: "new" as const, name: lead.company_name, industry: "Manufacturing", size: "11-50" as const, country: "DE" },
      contact: { mode: "new" as const },
      deal: { name: `${lead.company_name} deal`, amount: 25_000, expected_close_date: "2026-12-01" },
    };
    const result = await convertLead(ctx, input);
    const after = data();
    const deal = after.deals.find((d) => d.id === result.deal_id)!;
    expect(deal.stage_id).toBe(firstStage().id);
    expect(deal.lead_id).toBe(lead.id);
    expect(after.leads.find((l) => l.id === lead.id)!.status).toBe("converted");
    expect(after.companies.some((c) => c.id === result.company_id)).toBe(true);
    expect(after.contacts.find((c) => c.id === result.contact_id)!.company_id).toBe(result.company_id);
    expect(after.activities.some((a) => a.lead_id === lead.id && a.type === "system")).toBe(true);
    expect(after.deal_stage_history.filter((h) => h.deal_id === deal.id)).toHaveLength(1);

    const dealsBefore = after.deals.length;
    await expect(convertLead(ctx, input)).rejects.toThrow(/already been converted/);
    await expect(Promise.all([convertLead(ctx, input), convertLead(ctx, input)])).rejects.toBeInstanceOf(DomainError);
    expect(data().deals.length).toBe(dealsBefore);
  });
});

describe("pipeline stage moves", () => {
  it("records history, resets probability, closes won deals and emits deal.stage_changed", async () => {
    const deal = data().deals.find((d) => d.stage_id === firstStage().id && d.owner_id === DEMO_USER_IDS.repDaniel)
      ?? data().deals.find((d) => d.stage_id === firstStage().id)!;
    const ctx = ctxFor(db, data(), deal.owner_id);
    const historyBefore = data().deal_stage_history.filter((h) => h.deal_id === deal.id).length;
    const moved = await moveDealStage(ctx, { deal_id: deal.id, stage_id: wonStage().id });
    expect(moved.probability).toBe(100);
    expect(moved.closed_at).not.toBeNull();
    expect(data().deal_stage_history.filter((h) => h.deal_id === deal.id)).toHaveLength(historyBefore + 1);
    expect(data().audit_logs.some((l) => l.action === "deal.stage_changed" && l.target_id === deal.id)).toBe(true);
  });

  it("stores the previous stage in history and the previous values in audit diffs", async () => {
    const deal = data().deals.find((d) => d.stage_id === firstStage().id)!;
    const ctx = ctxFor(db, data(), deal.owner_id);
    await moveDealStage(ctx, { deal_id: deal.id, stage_id: wonStage().id });
    const last = data().deal_stage_history.filter((h) => h.deal_id === deal.id).sort((a, b) => b.changed_at.localeCompare(a.changed_at))[0]!;
    expect(last).toMatchObject({ from_stage_id: firstStage().id, to_stage_id: wonStage().id });
    const event = data().audit_logs.find((l) => l.action === "deal.stage_changed" && l.target_id === deal.id)!;
    expect(event.changes).toMatchObject({ from_stage_id: firstStage().id, to_stage_id: wonStage().id });
  });

  it("requires a lost reason and refuses moving to the same stage", async () => {
    const deal = data().deals.find((d) => d.stage_id === firstStage().id)!;
    const ctx = ctxFor(db, data(), deal.owner_id);
    await expect(moveDealStage(ctx, { deal_id: deal.id, stage_id: lostStage().id })).rejects.toThrow(/lost reason/);
    await expect(moveDealStage(ctx, { deal_id: deal.id, stage_id: deal.stage_id })).rejects.toThrow(/already/);
    const lost = await moveDealStage(ctx, { deal_id: deal.id, stage_id: lostStage().id, lost_reason: "Budget frozen" });
    expect(lost.lost_reason).toBe("Budget frozen");
  });

  it("does not change anything when the move is refused", async () => {
    const deal = ownedBy(data().deals, DEMO_USER_IDS.repSofia);
    await expect(moveDealStage(daniel, { deal_id: deal.id, stage_id: wonStage().id })).rejects.toBeInstanceOf(NotFoundError);
    expect(data().deals.find((d) => d.id === deal.id)!.stage_id).toBe(deal.stage_id);
  });
});

describe("orders", () => {
  const company = () => ownedBy(data().companies, DEMO_USER_IDS.repDaniel);

  it("computes totals with discount and tax and numbers orders per year", async () => {
    const order = await createOrder(
      daniel,
      orderInput.parse({
        company_id: company().id,
        currency: "USD",
        order_date: "2026-10-19",
        expected_delivery_date: null,
        notes: "",
        items: [
          { product_id: null, description: "Pump", quantity: 2, unit_price: 1000, discount_pct: 10, tax_rate: 20 },
          { product_id: null, description: "Seal kit", quantity: 3, unit_price: 50, discount_pct: 0, tax_rate: 0 },
        ],
      }),
    );
    expect(order).toMatchObject({ subtotal: 2150, discount_total: 200, tax_total: 360, total: 2310, status: "draft" });
    expect(order.order_number).toMatch(/^NX-2026-\d{4}$/);
    const existing = data().orders.filter((o) => o.order_number.startsWith("NX-2026-") && o.id !== order.id).map((o) => Number(o.order_number.slice(8)));
    expect(Number(order.order_number.slice(8))).toBe(Math.max(0, ...existing) + 1);
  });

  it("enforces status transitions on the server", async () => {
    const delivered = data().orders.find((o) => o.status === "delivered")!;
    const ctx = ctxFor(db, data(), delivered.owner_id);
    await expect(changeOrderStatus(ctx, { id: delivered.id, status: "draft" })).rejects.toThrow(/cannot go from delivered to draft/);
    const draft = data().orders.find((o) => o.status === "draft")!;
    const ctx2 = ctxFor(db, data(), draft.owner_id);
    const confirmed = await changeOrderStatus(ctx2, { id: draft.id, status: "confirmed" });
    expect(confirmed.payment_due_date).not.toBeNull();
    await expect(changeOrderStatus(ctx2, { id: draft.id, status: "delivered" })).rejects.toThrow(/cannot go/);
  });

  it("records simulated payments up to the outstanding amount and updates payment status", async () => {
    const order = data().orders.find((o) => (o.status === "confirmed" || o.status === "processing") && o.payment_status !== "paid")!;
    const ctx = ctxFor(db, data(), order.owner_id);
    const before = await getOrder(ctx, order.id);
    await expect(recordPayment(ctx, { order_id: order.id, amount: before.outstanding + 1, paid_at: "2026-10-19", method: "card", reference: "" })).rejects.toThrow(/exceeds/);
    const payment = await recordPayment(ctx, { order_id: order.id, amount: before.outstanding, paid_at: "2026-10-19", method: "bank_transfer", reference: "SIM-1" });
    expect(payment.is_simulated).toBe(true);
    expect((await getOrder(ctx, order.id)).order.payment_status).toBe("paid");
  });

  it("converts a won deal into exactly one order, however often it is triggered", async () => {
    const deal = data().deals.find((d) => d.stage_id === wonStage().id && !data().orders.some((o) => o.source_deal_id === d.id))!;
    const ctx = ctxFor(db, data(), deal.owner_id);
    const [a, b, c] = await Promise.all([convertDealToOrder(ctx, deal.id), convertDealToOrder(ctx, deal.id), convertDealToOrder(ctx, deal.id)]);
    expect([a.created, b.created, c.created].filter(Boolean)).toHaveLength(1);
    expect(new Set([a.order.id, b.order.id, c.order.id]).size).toBe(1);
    const again = await convertDealToOrder(ctx, deal.id);
    expect(again).toMatchObject({ created: false, order: { id: a.order.id } });
    expect(data().orders.filter((o) => o.source_deal_id === deal.id)).toHaveLength(1);
    expect(a.order.status).toBe("draft");
    expect(a.order.total).toBe(deal.amount);
  });

  it("refuses to convert a deal that is not won", async () => {
    const open = data().deals.find((d) => d.closed_at === null)!;
    await expect(convertDealToOrder(ctxFor(db, data(), open.owner_id), open.id)).rejects.toThrow(/Only won deals/);
  });
});

describe("tasks and archive", () => {
  it("lets a rep assign tasks only to themselves", async () => {
    const input = { title: "Call", description: "", type: "call" as const, assignee_id: DEMO_USER_IDS.repSofia, due_at: null, priority: "medium" as const, status: "todo" as const, company_id: null, contact_id: null, deal_id: null, order_id: null };
    await expect(createTask(daniel, input)).rejects.toBeInstanceOf(PermissionError);
    const mine = await createTask(daniel, { ...input, assignee_id: DEMO_USER_IDS.repDaniel });
    const done = await setTaskDone(daniel, mine.id, true);
    expect(done.completed_at).not.toBeNull();
    expect(data().audit_logs.some((l) => l.action === "task.completed" && l.target_id === mine.id)).toBe(true);
  });

  it("refuses linking a task to a record the rep cannot see", async () => {
    const sofiasDeal = ownedBy(data().deals, DEMO_USER_IDS.repSofia);
    await expect(
      createTask(daniel, { title: "x", description: "", type: "todo", assignee_id: DEMO_USER_IDS.repDaniel, due_at: null, priority: "low", status: "todo", company_id: null, contact_id: null, deal_id: sofiasDeal.id, order_id: null }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("archives and restores; only admins hard delete", async () => {
    const company = await createCompany(daniel, companyInput.parse({ name: "Temp Co", website: null, industry: "Mining", size: "1-10", country: "DE", city: "", address: "", phone: null, lifecycle_stage: "prospect", notes: "" }));
    await archiveRecord(daniel, "companies", company.id);
    expect(data().companies.find((c) => c.id === company.id)!.archived_at).not.toBeNull();
    await restoreRecord(daniel, "companies", company.id);
    expect(data().companies.find((c) => c.id === company.id)!.archived_at).toBeNull();
    await expect(hardDeleteRecord(daniel, "companies", company.id)).rejects.toBeInstanceOf(PermissionError);
    await hardDeleteRecord(admin, "companies", company.id);
    expect(data().companies.some((c) => c.id === company.id)).toBe(false);
    expect(data().audit_logs.find((l) => l.action === "record.deleted" && l.target_id === company.id)!.changes.before).toBeTruthy();
  });
});

describe("abuse limits", () => {
  it("rate limiter blocks after the limit and resets after the window", () => {
    const limiter = new RateLimiter({ search: { limit: 3, windowSeconds: 60 } });
    const t = 1_000_000;
    expect([1, 2, 3].map(() => limiter.hit("u", "search", t).allowed)).toEqual([true, true, true]);
    const blocked = limiter.hit("u", "search", t + 1);
    expect(blocked).toMatchObject({ allowed: false, firstBlocked: true });
    expect(limiter.hit("u", "search", t + 2).firstBlocked).toBe(false);
    expect(limiter.hit("other", "search", t + 2).allowed).toBe(true);
    expect(limiter.hit("u", "search", t + 61_000).allowed).toBe(true);
  });

  it("aggregates validation failures to one event per minute", () => {
    const log = new ValidationLog();
    expect(log.record("u", "createCompany", ["name"], 0)).toEqual({ count: 1, fields: ["name"] });
    expect(log.record("u", "createCompany", ["email"], 1000)).toBeNull();
    expect(log.record("u", "createCompany", ["email"], 2000)).toBeNull();
    expect(log.record("u", "createCompany", ["name"], 61_000)).toEqual({ count: 3 + 1, fields: ["name"] });
  });
});
