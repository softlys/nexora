import { z } from "zod";

/**
 * Custom fields (свои поля): admins add fields such as ИНН, customer type or a contract date to
 * companies, contacts, leads and deals. Definitions live in custom_fields; values are stored on each
 * record in its `custom` object, keyed by the field's key, and validated against the definition.
 */
export const CUSTOM_FIELD_ENTITIES = ["company", "contact", "lead", "deal"] as const;
export type CustomFieldEntity = (typeof CUSTOM_FIELD_ENTITIES)[number];
export const CUSTOM_FIELD_TYPES = ["text", "number", "date", "select", "checkbox", "url"] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];
/** English UI names of the types (translated where shown). */
export const CUSTOM_FIELD_TYPE_LABELS: Record<CustomFieldType, string> = { text: "Text", number: "Number", date: "Date", select: "List of values", checkbox: "Yes / no", url: "Link" };

export type CustomValue = string | number | boolean | null;
export type CustomValues = Record<string, CustomValue>;

/** What records store; older rows have no `custom` and read as {}. */
export const customValuesSchema = z.record(z.string().max(40), z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]));

export type CustomFieldDef = {
  id: string;
  key: string;
  label: string;
  type: CustomFieldType;
  options: string[];
  required: boolean;
  position: number;
};

/** A field key from its label: latin letters, digits and _ ("ИНН" → "inn"). */
const TRANSLIT: Record<string, string> = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" };
export function fieldKey(label: string): string {
  const latin = label
    .toLowerCase()
    .split("")
    .map((c) => TRANSLIT[c] ?? c)
    .join("");
  const key = latin.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return /^[a-z]/.test(key) ? key : `f_${key || "field"}`.slice(0, 40);
}

export type CustomIssue = { key: string; message: string };

/**
 * Normalizes submitted values against the definitions: numbers from text, checkboxes as booleans,
 * dates as YYYY-MM-DD, select values from the options; unknown keys are dropped, required fields
 * enforced. Messages are English UI texts (translated where they are shown).
 */
export function normalizeCustom(defs: CustomFieldDef[], input: Record<string, unknown> | undefined, previous: CustomValues = {}): { values: CustomValues; issues: CustomIssue[] } {
  const values: CustomValues = {};
  const issues: CustomIssue[] = [];
  for (const def of defs) {
    const raw = input && def.key in input ? input[def.key] : previous[def.key];
    const empty = raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "");
    if (empty) {
      if (def.type === "checkbox") values[def.key] = false;
      else if (def.required) issues.push({ key: def.key, message: "Required" });
      continue;
    }
    switch (def.type) {
      case "text": {
        const text = String(raw).trim();
        if (text.length > 2000) issues.push({ key: def.key, message: "At most 2000 characters" });
        else values[def.key] = text;
        break;
      }
      case "number": {
        const n = typeof raw === "number" ? raw : Number(String(raw).replace(/\s/g, "").replace(",", "."));
        if (!Number.isFinite(n)) issues.push({ key: def.key, message: "Enter a number" });
        else values[def.key] = n;
        break;
      }
      case "date": {
        const d = String(raw).slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) issues.push({ key: def.key, message: "Enter a date" });
        else values[def.key] = d;
        break;
      }
      case "select": {
        const v = String(raw);
        if (!def.options.includes(v)) issues.push({ key: def.key, message: "Choose a value from the list" });
        else values[def.key] = v;
        break;
      }
      case "checkbox":
        values[def.key] = raw === true || raw === "true" || raw === "1" || raw === "on" || raw === "yes" || raw === "да";
        break;
      case "url": {
        const v = String(raw).trim();
        try {
          const u = new URL(/^[a-z]+:\/\//i.test(v) ? v : `https://${v}`);
          if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("protocol");
          values[def.key] = u.toString();
        } catch {
          issues.push({ key: def.key, message: "Use an http(s) address" });
        }
        break;
      }
    }
  }
  return { values, issues };
}

/** A value as text for record pages, timelines and CSV. */
export function formatCustom(def: CustomFieldDef, value: CustomValue | undefined, yes = "Yes", no = "No"): string {
  if (value === undefined || value === null || value === "") return "";
  if (def.type === "checkbox") return value ? yes : no;
  return String(value);
}
