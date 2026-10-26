import { z } from "zod";
import { diffFields } from "@/domain/diff";
import { groupDuplicates, matchKeys, type MatchProbe, type MatchReason } from "@/domain/duplicates";
import type { Company, Contact, Lead } from "@/domain/entities";
import type { Tx } from "@/server/db/types";
import { DomainError } from "@/server/repositories/types";
import { emit, findVisible, newId, nowOf, requireCan, type ServiceContext } from "./context";
import { getOwned } from "./records";

/**
 * Possible duplicates (дубли): a warning while a record is created, a list of groups per kind,
 * and merging companies or contacts into one record. Merging moves every link (contacts, deals,
 * orders, tasks, activities, comments) to the kept record, fills its empty fields from the others
 * and archives the others, so nothing is lost and the merge can be followed in the history.
 */

export type DuplicateEntity = "company" | "contact" | "lead";
export type DuplicateMatch = { entity: DuplicateEntity; id: string; label: string; detail: string; href: string; reasons: MatchReason[] };

const companyProbe = (c: Company): MatchProbe => ({ name: c.name, website: c.website, phone: c.phone });
// People share names, so a contact's name only matches within the same company.
const contactProbe = (c: Contact): MatchProbe => ({ name: c.company_id ? `${c.first_name} ${c.last_name} ${c.company_id}` : null, email: c.email, phone: c.phone });
const leadProbe = (l: Lead): MatchProbe => ({ email: l.email, phone: l.phone });

const companyMatch = (c: Company, reasons: MatchReason[]): DuplicateMatch => ({ entity: "company", id: c.id, label: c.name, detail: [c.city, c.website, c.phone].filter(Boolean).join(" · "), href: `/companies/${c.id}`, reasons });
const contactMatch = (c: Contact, reasons: MatchReason[], companies?: Map<string, string>): DuplicateMatch => ({
  entity: "contact",
  id: c.id,
  label: `${c.first_name} ${c.last_name}`,
  detail: [c.company_id ? companies?.get(c.company_id) : null, c.email, c.phone].filter(Boolean).join(" · "),
  href: `/contacts/${c.id}`,
  reasons,
});
const leadMatch = (l: Lead, reasons: MatchReason[]): DuplicateMatch => ({ entity: "lead", id: l.id, label: l.title, detail: [l.company_name, l.email, l.phone].filter(Boolean).join(" · "), href: `/leads/${l.id}`, reasons });

/** Reasons two probes match, if any. */
function sharedReasons(a: MatchProbe, b: MatchProbe): MatchReason[] {
  const keys = new Set(matchKeys(a).map((k) => k.key));
  return [...new Set(matchKeys(b).filter((k) => keys.has(k.key)).map((k) => k.reason))];
}

export const duplicateProbeInput = z
  .object({
    entity: z.enum(["company", "contact", "lead"]),
    exclude_id: z.uuid().optional(),
    name: z.string().max(200).optional(),
    company_name: z.string().max(200).optional(),
    company_id: z.string().max(36).nullable().optional(),
    first_name: z.string().max(80).optional(),
    last_name: z.string().max(80).optional(),
    website: z.string().max(255).optional(),
    phone: z.string().max(40).optional(),
    email: z.string().max(254).optional(),
  })
  .strict();

/**
 * Records the user can see that look like the one being entered. New leads are compared with
 * leads and contacts (e-mail, phone) and with companies (company name).
 */
export async function findDuplicates(ctx: ServiceContext, input: z.output<typeof duplicateProbeInput>): Promise<DuplicateMatch[]> {
  return ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const out: DuplicateMatch[] = [];
    const notSelf = <T extends { id: string }>(rows: T[]) => rows.filter((r) => r.id !== input.exclude_id);
    if (input.entity === "company") {
      const probe = { name: input.name, website: input.website, phone: input.phone };
      for (const c of notSelf(await findVisible(tx, ctx, "companies", "company", (r) => r.owner_id, { archived_at: null }))) {
        const reasons = sharedReasons(probe, companyProbe(c));
        if (reasons.length) out.push(companyMatch(c, reasons));
      }
    } else {
      const contactLike = { email: input.email, phone: input.phone, name: input.entity === "contact" && input.company_id ? `${input.first_name ?? ""} ${input.last_name ?? ""} ${input.company_id}` : null };
      const companies = new Map((await tx.find("companies")).map((c) => [c.id, c.name]));
      for (const c of notSelf(await findVisible(tx, ctx, "contacts", "contact", (r) => r.owner_id, { archived_at: null }))) {
        const reasons = sharedReasons(contactLike, contactProbe(c));
        if (reasons.length) out.push(contactMatch(c, reasons, companies));
      }
      if (input.entity === "lead") {
        for (const l of notSelf(await findVisible(tx, ctx, "leads", "lead", (r) => r.owner_id, { archived_at: null }))) {
          if (l.status === "converted") continue;
          const reasons = sharedReasons({ email: input.email, phone: input.phone }, leadProbe(l));
          if (reasons.length) out.push(leadMatch(l, reasons));
        }
        if (input.company_name) {
          for (const c of await findVisible(tx, ctx, "companies", "company", (r) => r.owner_id, { archived_at: null })) {
            const reasons = sharedReasons({ name: input.company_name }, { name: c.name });
            if (reasons.length) out.push(companyMatch(c, reasons));
          }
        }
      }
    }
    return out.slice(0, 8);
  });
}

export type DuplicateGroup = { reasons: MatchReason[]; records: DuplicateMatch[] };

/** Every group of possible duplicates among the visible, active companies or contacts. */
export async function listDuplicateGroups(ctx: ServiceContext, entity: "company" | "contact"): Promise<DuplicateGroup[]> {
  return ctx.db.read(ctx.actor.organization_id, async (tx) => {
    if (entity === "company") {
      const rows = await findVisible(tx, ctx, "companies", "company", (r) => r.owner_id, { archived_at: null });
      return groupDuplicates(rows, companyProbe).map((g) => ({ reasons: g.reasons, records: oldestFirst(g.items).map((c) => companyMatch(c, g.reasons)) }));
    }
    const companies = new Map((await tx.find("companies")).map((c) => [c.id, c.name]));
    const rows = await findVisible(tx, ctx, "contacts", "contact", (r) => r.owner_id, { archived_at: null });
    return groupDuplicates(rows, contactProbe).map((g) => ({ reasons: g.reasons, records: oldestFirst(g.items).map((c) => contactMatch(c, g.reasons, companies)) }));
  });
}

const oldestFirst = <T extends { created_at: string }>(rows: T[]) => [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));

export const mergeInput = z
  .object({
    entity: z.enum(["company", "contact"]),
    keep_id: z.uuid(),
    merge_ids: z.array(z.uuid()).min(1).max(20),
  })
  .strict()
  .refine((m) => !m.merge_ids.includes(m.keep_id), { path: ["merge_ids"], message: "The kept record cannot be merged into itself" });

const blank = (v: unknown) => v === null || v === undefined || v === "";

/** Fields of `others` that fill blanks of `kept`, in order. */
function fillBlanks(kept: object, others: object[], fields: string[]): Record<string, unknown> {
  const get = (row: object, f: string) => (row as Record<string, unknown>)[f];
  const patch: Record<string, unknown> = {};
  for (const f of fields) {
    if (!blank(get(kept, f))) continue;
    const value = others.map((o) => get(o, f)).find((v) => !blank(v));
    if (value !== undefined) patch[f] = value;
  }
  return patch;
}

/** Points every link to a merged record at the kept one. */
async function relink(tx: Tx, column: "company_id" | "contact_id", from: string, to: string, at: string) {
  const tables = column === "company_id" ? (["contacts", "leads", "deals", "orders", "tasks", "activities"] as const) : (["leads", "tasks", "activities"] as const);
  let moved = 0;
  for (const table of tables) {
    for (const row of await tx.find(table, { [column]: from } as never)) {
      await tx.update(table, (row as { id: string }).id, { [column]: to, updated_at: at } as never);
      moved++;
    }
  }
  if (column === "contact_id") {
    for (const deal of await tx.find("deals", { primary_contact_id: from })) {
      await tx.update("deals", deal.id, { primary_contact_id: to, updated_at: at });
      moved++;
    }
  }
  const entity = column === "company_id" ? "company" : "contact";
  for (const comment of await tx.find("comments", { entity_type: entity, entity_id: from })) {
    await tx.update("comments", comment.id, { entity_id: to, updated_at: at });
    moved++;
  }
  for (const link of await tx.find("integration_records", { entity_type: entity, entity_id: from })) {
    await tx.update("integration_records", link.id, { entity_id: to, updated_at: at });
  }
  return moved;
}

/**
 * Admin: merges companies or contacts into the kept record. Admin-only (like a permanent delete)
 * because links owned by other users move too.
 */
export async function mergeRecords(ctx: ServiceContext, input: z.output<typeof mergeInput>): Promise<{ id: string; merged: number; moved: number }> {
  const resource = input.entity;
  requireCan(ctx, "delete", resource);
  return ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const at = nowOf(ctx).toISOString();
    const table = input.entity === "company" ? "companies" : "contacts";
    const kept = (await getOwned(tx, ctx, table, input.keep_id)) as Company | Contact;
    const others = [] as Array<Company | Contact>;
    for (const id of [...new Set(input.merge_ids)]) {
      const row = (await getOwned(tx, ctx, table, id)) as Company | Contact;
      if (row.archived_at) throw new DomainError("Archived records cannot be merged. Restore them first.");
      others.push(row);
    }
    if (kept.archived_at) throw new DomainError("Archived records cannot be merged. Restore them first.");

    let moved = 0;
    for (const o of others) moved += await relink(tx, input.entity === "company" ? "company_id" : "contact_id", o.id, kept.id, at);

    // The kept record wins; blanks are filled from the others, oldest first.
    const custom = Object.assign({}, ...[...others].reverse().map((o) => o.custom ?? {}), kept.custom ?? {});
    let patch: Record<string, unknown>;
    if (input.entity === "company") {
      const k = kept as Company;
      const os = others as Company[];
      const notes = [k.notes, ...os.map((o) => o.notes)].map((n) => n.trim()).filter((n, i, all) => n && all.indexOf(n) === i).join("\n\n").slice(0, 5000);
      patch = { ...fillBlanks(k, os, ["website", "phone", "city", "address"]), notes, custom };
    } else {
      const k = kept as Contact;
      const os = others as Contact[];
      const tags = [...new Set([...k.tags, ...os.flatMap((o) => o.tags)])].slice(0, 10);
      const messengers = Object.assign({}, ...[...os].reverse().map((o) => o.messengers ?? {}), k.messengers ?? {});
      patch = { ...fillBlanks(k, os, ["email", "phone", "job_title", "company_id"]), tags, messengers, custom };
    }
    const changes = diffFields(kept as unknown as Record<string, unknown>, patch);
    if (Object.keys(changes).length) {
      await tx.update(table, kept.id, { ...patch, updated_at: at } as never);
      await emit(tx, ctx, { type: "record.updated", payload: { entity: input.entity, id: kept.id, changes } });
    }
    for (const o of others) {
      await tx.update(table, o.id, { archived_at: at, updated_at: at } as never);
      await emit(tx, ctx, { type: "record.archived", payload: { entity: input.entity, id: o.id } });
    }
    const names = others.map((o) => ("name" in o ? o.name : `${o.first_name} ${o.last_name}`));
    await tx.insert("activities", {
      id: newId(),
      organization_id: ctx.actor.organization_id,
      type: "system",
      subject: "Duplicates merged",
      body: `Merged into this record: ${names.join(", ")}. Their links moved here; the merged records were archived.`,
      occurred_at: at,
      actor_id: ctx.actor.id,
      company_id: input.entity === "company" ? kept.id : ((kept as Contact).company_id ?? null),
      contact_id: input.entity === "contact" ? kept.id : null,
      lead_id: null,
      deal_id: null,
      order_id: null,
      created_at: at,
      updated_at: at,
    });
    return { id: kept.id, merged: others.length, moved };
  });
}
