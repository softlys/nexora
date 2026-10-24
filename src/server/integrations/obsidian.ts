import "server-only";
import type { Activity, Company, Contact, Deal, PipelineStage, Profile, Task } from "@/domain/entities";
import { countryName } from "@/lib/countries";
import { MESSENGER_CHANNELS, MESSENGERS } from "@/lib/messengers";
import { createZip, type ZipEntry } from "@/lib/zip";
import { findVisible, type ServiceContext } from "@/server/services/context";

/**
 * Obsidian vault export: one Markdown note per company, contact and deal, linked with [[wikilinks]],
 * so Obsidian's graph shows who belongs to which company and deal. Properties (YAML front matter)
 * hold the structured fields for Dataview and Bases. Only records the user may see are included.
 */
export type VaultData = {
  companies: Company[];
  contacts: Contact[];
  deals: Deal[];
  stages: PipelineStage[];
  activities: Activity[];
  tasks: Task[];
  profiles: Profile[];
  baseUrl: string;
  generatedAt: Date;
};

/** Characters Obsidian (and Windows) do not allow in note names, plus link syntax. */
export function noteName(text: string): string {
  const clean = text
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return clean || "Untitled";
}

/** Gives every record a unique note name ("Acme", "Acme (2)") so links stay unambiguous. */
function uniqueNames<T extends { id: string }>(rows: T[], label: (row: T) => string): Map<string, string> {
  const used = new Map<string, number>();
  const out = new Map<string, string>();
  for (const row of rows) {
    const base = noteName(label(row));
    const key = base.toLowerCase();
    const n = (used.get(key) ?? 0) + 1;
    used.set(key, n);
    out.set(row.id, n === 1 ? base : `${base} (${n})`);
  }
  return out;
}

/** YAML scalar: quoted unless it is a plain number or boolean. */
function yaml(value: unknown): string {
  if (value === null || value === undefined || value === "") return '""';
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map(yaml).join(", ")}]`;
  return JSON.stringify(String(value));
}

function frontMatter(fields: Record<string, unknown>): string {
  return ["---", ...Object.entries(fields).map(([k, v]) => `${k}: ${yaml(v)}`), "---", ""].join("\n");
}

const link = (name: string | undefined) => (name ? `[[${name}]]` : "");
const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");
const money = (amount: number, currency: string) => `${amount.toLocaleString("en-US")} ${currency}`;

export function buildVault(data: VaultData): ZipEntry[] {
  const companyNames = uniqueNames(data.companies, (c) => c.name);
  const contactNames = uniqueNames(data.contacts, (c) => `${c.first_name} ${c.last_name}`);
  const dealNames = uniqueNames(data.deals, (d) => d.name);
  const owner = new Map(data.profiles.map((p) => [p.id, p.full_name]));
  const stage = new Map(data.stages.map((s) => [s.id, s]));
  const url = (path: string) => `${data.baseUrl}${path}`;
  const activitiesFor = (pick: (a: Activity) => boolean) =>
    data.activities
      .filter(pick)
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
      .slice(0, 50)
      .map((a) => `- ${day(a.occurred_at)} **${a.type}** ${a.subject.replace(/\n/g, " ")}${a.body ? ` — ${a.body.replace(/\n+/g, " ").slice(0, 300)}` : ""}`);
  const openTasksFor = (pick: (t: Task) => boolean) =>
    data.tasks.filter((t) => pick(t) && t.status !== "done" && !t.archived_at).map((t) => `- [ ] ${t.title}${t.due_at ? ` (due ${day(t.due_at)})` : ""}`);
  const section = (title: string, lines: string[]) => (lines.length ? [`## ${title}`, "", ...lines, ""] : []);

  const files: ZipEntry[] = [];
  for (const c of data.companies) {
    const name = companyNames.get(c.id)!;
    const body = [
      frontMatter({
        type: "company",
        industry: c.industry,
        country: countryName(c.country),
        city: c.city,
        lifecycle: c.lifecycle_stage,
        owner: owner.get(c.owner_id) ?? "",
        website: c.website ?? "",
        phone: c.phone ?? "",
        nexora: url(`/companies/${c.id}`),
        tags: ["nexora/company"],
      }),
      `# ${name}`,
      "",
      ...(c.notes ? [c.notes, ""] : []),
      ...section(
        "Contacts",
        data.contacts.filter((x) => x.company_id === c.id).map((x) => `- ${link(contactNames.get(x.id))}${x.job_title ? `, ${x.job_title}` : ""}`),
      ),
      ...section(
        "Deals",
        data.deals.filter((d) => d.company_id === c.id).map((d) => `- ${link(dealNames.get(d.id))} · ${stage.get(d.stage_id)?.name ?? ""} · ${money(d.amount, d.currency)}`),
      ),
      ...section("Open tasks", openTasksFor((t) => t.company_id === c.id)),
      ...section("Activity", activitiesFor((a) => a.company_id === c.id)),
    ];
    files.push({ path: `NEXORA/Companies/${name}.md`, content: body.join("\n") });
  }
  for (const c of data.contacts) {
    const name = contactNames.get(c.id)!;
    const messengers = MESSENGER_CHANNELS.filter((m) => c.messengers?.[m]).map((m) => `- ${MESSENGERS[m].label}: ${c.messengers![m]}`);
    const body = [
      frontMatter({
        type: "contact",
        company: link(c.company_id ? companyNames.get(c.company_id) : undefined),
        job_title: c.job_title,
        email: c.email ?? "",
        phone: c.phone ?? "",
        owner: owner.get(c.owner_id) ?? "",
        nexora: url(`/contacts/${c.id}`),
        tags: ["nexora/contact", ...c.tags.map((t) => `nexora/${noteName(t).replace(/\s+/g, "-").toLowerCase()}`)],
      }),
      `# ${name}`,
      "",
      ...(c.company_id && companyNames.get(c.company_id) ? [`${c.job_title ? `${c.job_title} at ` : "Works at "}${link(companyNames.get(c.company_id))}`, ""] : []),
      ...section("Messengers", messengers),
      ...section(
        "Deals",
        data.deals.filter((d) => d.primary_contact_id === c.id).map((d) => `- ${link(dealNames.get(d.id))}`),
      ),
      ...section("Activity", activitiesFor((a) => a.contact_id === c.id)),
    ];
    files.push({ path: `NEXORA/Contacts/${name}.md`, content: body.join("\n") });
  }
  for (const d of data.deals) {
    const name = dealNames.get(d.id)!;
    const s = stage.get(d.stage_id);
    const body = [
      frontMatter({
        type: "deal",
        company: link(companyNames.get(d.company_id)),
        contact: link(d.primary_contact_id ? contactNames.get(d.primary_contact_id) : undefined),
        stage: s?.name ?? "",
        status: s?.is_won ? "won" : s?.is_lost ? "lost" : "open",
        amount: d.amount,
        currency: d.currency,
        probability: d.probability,
        expected_close: day(d.expected_close_date),
        owner: owner.get(d.owner_id) ?? "",
        nexora: url(`/deals/${d.id}`),
        tags: ["nexora/deal"],
      }),
      `# ${name}`,
      "",
      `${link(companyNames.get(d.company_id))} · ${s?.name ?? ""} · ${money(d.amount, d.currency)}`,
      "",
      ...(d.next_activity ? [`**Next:** ${d.next_activity}`, ""] : []),
      ...(d.notes ? [d.notes, ""] : []),
      ...section("Open tasks", openTasksFor((t) => t.deal_id === d.id)),
      ...section("Activity", activitiesFor((a) => a.deal_id === d.id)),
    ];
    files.push({ path: `NEXORA/Deals/${name}.md`, content: body.join("\n") });
  }
  const open = data.deals.filter((d) => !stage.get(d.stage_id)?.is_won && !stage.get(d.stage_id)?.is_lost);
  files.unshift({
    path: "NEXORA/NEXORA.md",
    content: [
      frontMatter({ type: "index", exported: data.generatedAt.toISOString(), source: data.baseUrl }),
      "# NEXORA",
      "",
      `Exported ${data.generatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC: ${data.companies.length} companies, ${data.contacts.length} contacts, ${data.deals.length} deals.`,
      "",
      "Notes are regenerated on every export; write your own notes in separate files that link to these.",
      "",
      ...section(
        "Open deals",
        open.sort((a, b) => b.amount - a.amount).map((d) => `- ${link(dealNames.get(d.id))} · ${link(companyNames.get(d.company_id))} · ${money(d.amount, d.currency)}`),
      ),
      ...section("Companies", data.companies.map((c) => `- ${link(companyNames.get(c.id))}`)),
    ].join("\n"),
  });
  return files;
}

/** Loads everything the user may see and returns the vault as a ZIP. */
export async function exportVault(ctx: ServiceContext, baseUrl: string, now = new Date()): Promise<{ zip: Uint8Array; notes: number }> {
  const files = await vaultFiles(ctx, baseUrl, now);
  return { zip: createZip(files, now), notes: files.length };
}

/** The vault's notes for everything the user may see. */
export async function vaultFiles(ctx: ServiceContext, baseUrl: string, now = new Date()): Promise<ZipEntry[]> {
  const data = await ctx.db.read(ctx.actor.organization_id, async (tx) => ({
    companies: await findVisible(tx, ctx, "companies", "company", (r) => r.owner_id, { archived_at: null }),
    contacts: await findVisible(tx, ctx, "contacts", "contact", (r) => r.owner_id, { archived_at: null }),
    deals: await findVisible(tx, ctx, "deals", "deal", (r) => r.owner_id, { archived_at: null }),
    stages: await tx.find("pipeline_stages"),
    activities: await findVisible(tx, ctx, "activities", "activity", (r) => r.actor_id),
    tasks: await findVisible(tx, ctx, "tasks", "task", (r) => r.assignee_id),
    profiles: await tx.find("profiles"),
  }));
  return buildVault({ ...data, baseUrl, generatedAt: now });
}
