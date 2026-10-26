import { z } from "zod";
import { COMPANY_SIZES, LIFECYCLE_STAGES } from "@/domain/entities";
import { companyInput, contactInput } from "@/domain/inputs";
import { COUNTRY_CODES, countryName } from "@/lib/countries";
import { parseCsv } from "@/lib/csv";
import { MESSENGER_CHANNELS, MESSENGERS } from "@/lib/messengers";
import { companyOptions, createCompany } from "./companies";
import { createContact } from "./contacts";
import { requireCan, type ServiceContext } from "./context";
import { DomainError } from "@/server/repositories/types";

/**
 * CSV import of companies and contacts. The file is checked first (dry run): every row is
 * validated with the same rules as the forms and the errors are listed by row number. Only then
 * are rows created, each as a normal create (audit log, events, automations, permissions).
 * Headers match the export, case-insensitively, so an exported file can be imported back.
 */
export const MAX_IMPORT_ROWS = 2000;
// Server actions accept bodies up to 1 MB by default; this keeps a margin for the request envelope.
export const MAX_IMPORT_BYTES = 900_000;

export const importInput = z
  .object({
    entity: z.enum(["companies", "contacts"]),
    csv: z.string().min(1, "The file is empty").max(MAX_IMPORT_BYTES, "The file is larger than 900 KB; split it into parts"),
    dry_run: z.boolean(),
  })
  .strict();

export type ImportResult = { rows: number; valid: number; errors: Array<{ row: number; message: string }>; created: number };

const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// Names in English and Russian, so files from either interface language import.
const COUNTRY_BY_NAME = new Map<string, string>(COUNTRY_CODES.flatMap((c) => [[countryName(c, "en").toLowerCase(), c] as const, [countryName(c, "ru").toLowerCase(), c] as const]));

/** Accepts "RU", "ru" or "Russia". */
function countryCode(value: string): string {
  const v = value.trim();
  if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
  return COUNTRY_BY_NAME.get(v.toLowerCase()) ?? v;
}

function table(csv: string): { headers: string[]; records: Array<Record<string, string>> } {
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new DomainError("The file needs a header row and at least one data row.");
  if (rows.length - 1 > MAX_IMPORT_ROWS) throw new DomainError(`At most ${MAX_IMPORT_ROWS} rows per file. Split the file and import the parts.`);
  const headers = rows[0]!.map(norm);
  return { headers, records: rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()]))) };
}

const firstIssue = (error: z.ZodError) => {
  const i = error.issues[0]!;
  return `${i.path.join(".") || "row"}: ${i.message}`;
};

function companyRow(r: Record<string, string>) {
  const size = r["size"] || "11-50";
  const stage = (r["lifecycle stage"] || "prospect").toLowerCase();
  return companyInput.safeParse({
    name: r["name"] ?? "",
    website: r["website"] ?? "",
    industry: r["industry"] ?? "",
    size: (COMPANY_SIZES as readonly string[]).includes(size) ? size : size,
    country: countryCode(r["country code"] || r["country"] || ""),
    city: r["city"] ?? "",
    address: r["address"] ?? "",
    phone: r["phone"] ?? "",
    lifecycle_stage: (LIFECYCLE_STAGES as readonly string[]).includes(stage) ? stage : stage,
    notes: r["notes"] ?? "",
  });
}

function contactRow(r: Record<string, string>, companies: Map<string, string>) {
  const companyName = (r["company"] ?? "").toLowerCase();
  const messengers = Object.fromEntries(MESSENGER_CHANNELS.map((c) => [c, r[norm(MESSENGERS[c].label)] ?? r[c] ?? ""]));
  const parsed = contactInput.safeParse({
    company_id: companyName ? (companies.get(companyName) ?? null) : null,
    first_name: r["first name"] ?? "",
    last_name: r["last name"] ?? "",
    email: r["email"] ?? "",
    phone: r["phone"] ?? "",
    job_title: r["job title"] ?? "",
    tags: (r["tags"] ?? "")
      .split(/[;,]/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 10),
    messengers,
  });
  if (parsed.success && companyName && !parsed.data.company_id) return { success: false as const, message: `company: "${r["company"]}" was not found; create it first or leave the column empty` };
  return parsed.success ? { success: true as const, data: parsed.data } : { success: false as const, message: firstIssue(parsed.error) };
}

export async function importCsv(ctx: ServiceContext, input: z.output<typeof importInput>): Promise<ImportResult> {
  requireCan(ctx, "create", input.entity === "companies" ? "company" : "contact");
  const { headers, records } = table(input.csv);
  const required = input.entity === "companies" ? ["name", "industry"] : ["first name", "last name"];
  const missing = required.filter((h) => !headers.includes(h));
  if (input.entity === "companies" && !headers.includes("country") && !headers.includes("country code")) missing.push("country");
  if (missing.length) throw new DomainError(`Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. The first row must hold the column names, as in an export.`);

  const errors: ImportResult["errors"] = [];
  const valid: Array<{ row: number; data: unknown }> = [];
  const companies = input.entity === "contacts" ? new Map((await companyOptions(ctx)).map((c) => [c.name.toLowerCase(), c.id])) : new Map<string, string>();
  records.forEach((r, i) => {
    const row = i + 2; // spreadsheet row number: 1 is the header
    if (input.entity === "companies") {
      const p = companyRow(r);
      if (p.success) valid.push({ row, data: p.data });
      else errors.push({ row, message: firstIssue(p.error) });
    } else {
      const p = contactRow(r, companies);
      if (p.success) valid.push({ row, data: p.data });
      else errors.push({ row, message: p.message });
    }
  });

  let created = 0;
  if (!input.dry_run) {
    if (errors.length) throw new DomainError("Fix the rows with errors first; nothing was imported.");
    for (const v of valid) {
      try {
        if (input.entity === "companies") await createCompany(ctx, v.data as never);
        else await createContact(ctx, v.data as never);
        created++;
      } catch (error) {
        errors.push({ row: v.row, message: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  return { rows: records.length, valid: valid.length, errors: errors.slice(0, 200), created };
}
