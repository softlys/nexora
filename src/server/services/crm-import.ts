import { z } from "zod";
import type { PipelineStage } from "@/domain/entities";
import { companyInput, contactInput, dealInput } from "@/domain/inputs";
import type { SourceData } from "@/server/integrations/crm-sources";
import { createCompany } from "./companies";
import { createContact } from "./contacts";
import { newId, requireCan, type ServiceContext } from "./context";
import { createDeal, moveDealStage, sortedPipelines, sortedStages } from "./deals";

/**
 * Moving from Bitrix24 or amoCRM: pipelines with their stages, companies, contacts and deals are
 * written with the normal services (validation, audit, events). Every imported record is
 * remembered by its id in the other CRM (integration_records, source "import:<crm>"), so running
 * the import again only adds what is new. Automations do not run for imported records.
 */

export const IMPORT_SOURCES = ["bitrix24", "amocrm"] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

export type StageSpec = { name: string; probability: number; is_won: boolean; is_lost: boolean };
export type CreatePipeline = (name: string, stages: StageSpec[]) => Promise<string>;

export type ImportReport = {
  dry_run: boolean;
  pipelines: { total: number; created: number; matched: string[] };
  companies: { total: number; created: number; skipped: number };
  contacts: { total: number; created: number; skipped: number };
  deals: { total: number; created: number; skipped: number };
  errors: Array<{ kind: "company" | "contact" | "deal"; key: string; message: string }>;
};

export const importRunInput = z
  .object({
    source: z.enum(IMPORT_SOURCES),
    dry_run: z.boolean(),
    webhook: z.string().trim().max(500).optional(),
    subdomain: z.string().trim().max(100).optional(),
    token: z.string().trim().max(4000).optional(),
  })
  .strict();

const validEmail = (v: string) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254 ? v : "");
const validPhone = (v: string) => (/^\+?[0-9 ()-]{6,24}$/.test(v) ? v : "");
const validUrl = (v: string) => {
  if (!v) return "";
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(v) ? v : `https://${v}`);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString().slice(0, 255) : "";
  } catch {
    return "";
  }
};
const message = (error: unknown) => (error instanceof z.ZodError ? `${error.issues[0]?.path.join(".")}: ${error.issues[0]?.message}` : error instanceof Error ? error.message : String(error));

/** Open stages in the source order, then one won and one lost stage (NEXORA has exactly one of each). */
export function stagesFor(source: SourceData["pipelines"][number]): StageSpec[] {
  const open = source.stages.filter((s) => s.kind === "open").sort((a, b) => a.sort - b.sort);
  const won = source.stages.find((s) => s.kind === "won");
  const lost = source.stages.find((s) => s.kind === "lost");
  return [
    ...open.map((s, i) => ({ name: s.name.slice(0, 60), probability: Math.round(((i + 1) / (open.length + 1)) * 90), is_won: false, is_lost: false })),
    { name: (won?.name ?? "Won").slice(0, 60), probability: 100, is_won: true, is_lost: false },
    { name: (lost?.name ?? "Lost").slice(0, 60), probability: 0, is_won: false, is_lost: true },
  ];
}

export async function importCrm(ctx: ServiceContext, source: ImportSource, data: SourceData, options: { dryRun: boolean; createPipeline: CreatePipeline }): Promise<ImportReport> {
  requireCan(ctx, "manage", "organization");
  // Imported records must not trigger automations (no follow-up tasks for 5 000 old deals).
  const quiet: ServiceContext = { ...ctx, pendingEvents: undefined };
  const origin = `import:${source}`;
  const report: ImportReport = {
    dry_run: options.dryRun,
    pipelines: { total: data.pipelines.length, created: 0, matched: [] },
    companies: { total: data.companies.length, created: 0, skipped: 0 },
    contacts: { total: data.contacts.length, created: 0, skipped: 0 },
    deals: { total: data.deals.length, created: 0, skipped: 0 },
    errors: [],
  };
  const fail = (kind: ImportReport["errors"][number]["kind"], key: string, error: unknown) => {
    if (report.errors.length < 100) report.errors.push({ kind, key, message: message(error) });
  };

  const known = await ctx.db.read(ctx.actor.organization_id, async (tx) => new Map((await tx.find("integration_records", { source: origin })).map((r) => [r.external_id, r.entity_id] as const)));
  const remember = (key: string, entityType: string, entityId: string) =>
    ctx.db.write(ctx.actor.organization_id, async (tx) => {
      const at = new Date().toISOString();
      await tx.insert("integration_records", { id: newId(), organization_id: ctx.actor.organization_id, source: origin, external_id: key, entity_type: entityType, entity_id: entityId, data: {}, created_at: at, updated_at: at });
      known.set(key, entityId);
    });

  // Pipelines: the same name is reused; otherwise a pipeline is created with the source stages.
  const existing = await ctx.db.read(ctx.actor.organization_id, async (tx) => ({ pipelines: await sortedPipelines(tx), stages: await sortedStages(tx) }));
  const stageMaps = new Map<string, { pipelineId: string; stage: (key: string) => PipelineStage | undefined }>();
  for (const p of data.pipelines) {
    let target = existing.pipelines.find((x) => x.name.trim().toLowerCase() === p.name.trim().toLowerCase());
    if (target) report.pipelines.matched.push(target.name);
    else if (!options.dryRun) {
      const id = await options.createPipeline(p.name.slice(0, 60), stagesFor(p));
      report.pipelines.created++;
      const reloaded = await ctx.db.read(ctx.actor.organization_id, async (tx) => ({ pipelines: await sortedPipelines(tx), stages: await sortedStages(tx) }));
      existing.pipelines = reloaded.pipelines;
      existing.stages = reloaded.stages;
      target = existing.pipelines.find((x) => x.id === id);
    } else report.pipelines.created++;
    if (!target) continue;
    const ours = existing.stages.filter((s) => s.pipeline_id === target!.id);
    const open = ours.filter((s) => !s.is_won && !s.is_lost);
    stageMaps.set(p.key, {
      pipelineId: target.id,
      stage: (key) => {
        const src = p.stages.find((s) => s.key === key);
        if (!src) return open[0];
        if (src.kind === "won") return ours.find((s) => s.is_won);
        if (src.kind === "lost") return ours.find((s) => s.is_lost);
        return open.find((s) => s.name.trim().toLowerCase() === src.name.trim().toLowerCase()) ?? open[0];
      },
    });
  }

  const companyId = new Map<string, string>();
  for (const c of data.companies) {
    const key = `company:${c.key}`;
    const done = known.get(key);
    if (done) {
      companyId.set(c.key, done);
      report.companies.skipped++;
      continue;
    }
    if (options.dryRun) {
      report.companies.created++;
      continue;
    }
    try {
      const created = await createCompany(
        quiet,
        companyInput.parse({ name: (c.name || "Без названия").slice(0, 160), website: validUrl(c.website), industry: (c.industry || "Other").slice(0, 80), size: "11-50", country: "RU", city: "", address: c.address.slice(0, 255), phone: c.phone.slice(0, 40), lifecycle_stage: "prospect", notes: "" }),
      );
      companyId.set(c.key, created.id);
      await remember(key, "company", created.id);
      report.companies.created++;
    } catch (error) {
      fail("company", c.key, error);
    }
  }

  const contactId = new Map<string, string>();
  const contactCompany = new Map<string, string | null>();
  for (const c of data.contacts) {
    const key = `contact:${c.key}`;
    const company = c.company_key ? (companyId.get(c.company_key) ?? known.get(`company:${c.company_key}`) ?? null) : null;
    contactCompany.set(c.key, company);
    const done = known.get(key);
    if (done) {
      contactId.set(c.key, done);
      report.contacts.skipped++;
      continue;
    }
    if (options.dryRun) {
      report.contacts.created++;
      continue;
    }
    try {
      const created = await createContact(
        quiet,
        contactInput.parse({ company_id: company, first_name: (c.first_name || c.last_name || "Без имени").slice(0, 80), last_name: (c.first_name ? c.last_name : "").slice(0, 80) || "—", email: validEmail(c.email), phone: validPhone(c.phone), job_title: c.job_title.slice(0, 120), tags: [] }),
      );
      contactId.set(c.key, created.id);
      await remember(key, "contact", created.id);
      report.contacts.created++;
    } catch (error) {
      fail("contact", c.key, error);
    }
  }

  for (const d of data.deals) {
    const key = `deal:${d.key}`;
    if (known.get(key)) {
      report.deals.skipped++;
      continue;
    }
    if (options.dryRun) {
      report.deals.created++;
      continue;
    }
    try {
      const map = stageMaps.get(d.pipeline_key) ?? stageMaps.values().next().value;
      if (!map) throw new Error("No pipeline to put the deal in.");
      const contact = d.contact_key ? (contactId.get(d.contact_key) ?? known.get(`contact:${d.contact_key}`) ?? null) : null;
      let company = d.company_key ? (companyId.get(d.company_key) ?? known.get(`company:${d.company_key}`) ?? null) : null;
      if (!company && d.contact_key) company = contactCompany.get(d.contact_key) ?? null;
      const currency = /^[A-Z]{3}$/.test(d.currency) ? d.currency : "RUB";
      const base = { name: (d.name || `Deal ${d.key}`).slice(0, 160), primary_contact_id: contact, amount: Math.max(0, d.amount), currency, expected_close_date: null, source: "outbound" as const, next_activity: "", notes: "", pipeline_id: map.pipelineId };
      const deal = await createDeal(quiet, dealInput.parse(company ? { ...base, company_id: company } : { ...base, new_company: { name: (d.name || "Без компании").slice(0, 160), industry: "Other", country: "RU" } }));
      const stage = map.stage(d.stage_key);
      if (stage && stage.id !== deal.stage_id) await moveDealStage(quiet, { deal_id: deal.id, stage_id: stage.id, ...(stage.is_lost && { lost_reason: "Imported" }) } as never);
      await remember(key, "deal", deal.id);
      report.deals.created++;
    } catch (error) {
      fail("deal", d.key, error);
    }
  }
  return report;
}
