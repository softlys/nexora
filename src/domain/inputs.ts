/**
 * Strict input schemas for CRM mutations. Unknown keys are rejected (mass assignment).
 * Fields such as organization_id, stage history, totals and payment status are never
 * accepted from clients; they are set by the services that own them. owner_id is
 * accepted only where reassignment makes sense, and the service checks who may change it.
 */
import { messengersInput } from "@/lib/messengers";
import { isCountryCode } from "@/lib/countries";
import { z } from "zod";
import { locale } from "@/lib/i18n";

// Zod's built-in messages ("too long", "invalid input"…) follow the interface language.
if (locale() === "ru") z.config(z.locales.ru());
import {
  ACTIVITY_TYPES,
  COMPANY_SIZES,
  ENTITY_TYPES,
  LEAD_QUALIFICATIONS,
  LEAD_SOURCES,
  LIFECYCLE_STAGES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  TASK_TYPES,
} from "./entities";

/** Form fields send "" for empty optional inputs; treat that as null. */
const emptyToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);
const optionalText = (max: number) => z.preprocess(emptyToNull, z.string().trim().max(max).nullable());
const text = (max: number) => z.string().trim().max(max);
const required = (max: number) => z.string().trim().min(1, "Required").max(max);
const optionalId = z.preprocess(emptyToNull, z.uuid().nullable());
const optionalDate = z.preprocess(emptyToNull, z.iso.date().nullable());
const optionalDateTime = z.preprocess(emptyToNull, z.iso.datetime({ offset: true }).nullable());
/**
 * Numbers as people type them: "10600", "10,600", "$10,600.50", " 12.5 ". Thousands separators
 * are commas, as the app displays amounts. Anything else becomes a clear message, never "NaN".
 */
export function parseNumberInput(v: unknown): unknown {
  if (typeof v !== "string") return v;
  let s = v.trim().replace(/[\s$€£]/g, "").replace(/−/g, "-");
  if (s === "") return undefined;
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  return /^-?(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : Number.NaN;
}
const numberField = (opts: { min?: number; minMessage?: string; max: number; positive?: boolean }) => {
  let n = z.number({ error: "Enter a number, for example 10600 or 10,600" }).refine(Number.isFinite, "Enter a number, for example 10600 or 10,600");
  if (opts.positive) n = n.refine((x) => x > 0, "Must be more than 0");
  if (opts.min !== undefined) n = n.refine((x) => x >= opts.min!, opts.minMessage ?? `Must be at least ${opts.min}`);
  n = n.refine((x) => x <= opts.max, `Must be at most ${opts.max.toLocaleString("en-US")}`);
  return z.preprocess(parseNumberInput, n);
};
const amount = numberField({ min: 0, minMessage: "Must be zero or more", max: 1_000_000_000 });
const percent = numberField({ min: 0, minMessage: "Must be zero or more", max: 100 });
const currency = z.string().regex(/^[A-Z]{3}$/);

export const idInput = z.object({ id: z.uuid() }).strict();

const website = z.preprocess(
  emptyToNull,
  z
    .url({ protocol: /^https?$/, message: "Use an http(s) address" })
    .max(255)
    .nullable(),
);
const email = z.preprocess(emptyToNull, z.email("Enter a valid email").max(254).nullable());
const phone = z.preprocess(emptyToNull, z.string().regex(/^\+?[0-9 ()-]{6,24}$/, "Enter a valid phone number").nullable());

// --- Companies -------------------------------------------------------------

export const companyFields = {
  name: required(160),
  website,
  industry: required(80),
  size: z.enum(COMPANY_SIZES),
  country: z.string().refine(isCountryCode, "Choose a country from the list"),
  city: text(120),
  address: text(255),
  phone,
  lifecycle_stage: z.enum(LIFECYCLE_STAGES),
  notes: text(5000),
  owner_id: z.uuid().optional(),
};
export const companyInput = z.object(companyFields).strict();
export const companyUpdateInput = z.object({ id: z.uuid(), ...companyFields }).strict();

// --- Contacts --------------------------------------------------------------

export const contactFields = {
  company_id: optionalId,
  first_name: required(80),
  last_name: required(80),
  email,
  phone,
  job_title: text(120),
  tags: z.array(z.string().trim().min(1).max(32)).max(10),
  messengers: messengersInput.default({}),
  owner_id: z.uuid().optional(),
};
export const contactInput = z.object(contactFields).strict();
export const contactUpdateInput = z.object({ id: z.uuid(), ...contactFields }).strict();

// --- Leads -----------------------------------------------------------------

export const leadFields = {
  title: required(160),
  company_name: required(160),
  contact_name: required(160),
  email,
  phone,
  country: z.preprocess(emptyToNull, z.string().refine(isCountryCode, "Choose a country from the list").nullable()),
  source: z.enum(LEAD_SOURCES),
  status: z.enum(["new", "contacted", "qualified", "unqualified"]),
  qualification: z.enum(LEAD_QUALIFICATIONS),
  next_action: text(255),
  next_action_at: optionalDateTime,
  estimated_value: amount,
  owner_id: z.uuid().nullable().optional(),
};
export const leadInput = z.object(leadFields).strict();
export const leadUpdateInput = z.object({ id: z.uuid(), ...leadFields }).strict();

export const convertLeadInput = z
  .object({
    lead_id: z.uuid(),
    company: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("existing"), company_id: z.uuid() }).strict(),
      z
        .object({
          mode: z.literal("new"),
          name: required(160),
          industry: required(80),
          size: z.enum(COMPANY_SIZES),
          country: z.string().refine(isCountryCode, "Choose a country from the list"),
        })
        .strict(),
    ]),
    contact: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("existing"), contact_id: z.uuid() }).strict(),
      z.object({ mode: z.literal("new") }).strict(),
      z.object({ mode: z.literal("none") }).strict(),
    ]),
    deal: z
      .object({
        name: required(160),
        amount,
        expected_close_date: optionalDate,
      })
      .strict(),
  })
  .strict();

// --- Deals -----------------------------------------------------------------

export const dealFields = {
  name: required(160),
  company_id: z.uuid(),
  primary_contact_id: optionalId,
  amount,
  currency,
  /** Overrides the stage default when provided. */
  probability: z.coerce.number().int().min(0).max(100).optional(),
  expected_close_date: optionalDate,
  source: z.enum(LEAD_SOURCES),
  next_activity: text(255),
  notes: text(5000),
  owner_id: z.uuid().optional(),
};
/** A company typed by name in the deal form; it is created with the deal (or matched to an existing one). */
export const newCompanyInput = z
  .object({ name: required(160), industry: text(80), country: z.string().refine(isCountryCode, "Choose the company's country") })
  .strict();
const companyChoice = {
  company_id: z.uuid().optional(),
  new_company: newCompanyInput.optional(),
};
const needsCompany = (d: { company_id?: string; new_company?: unknown }) => Boolean(d.company_id || d.new_company);
const companyMessage = { path: ["company_id"], message: "Choose a company or type a new name" };
export const dealInput = z.object({ ...dealFields, ...companyChoice, stage_id: z.uuid().optional() }).strict().refine(needsCompany, companyMessage);
export const dealUpdateInput = z.object({ id: z.uuid(), ...dealFields, ...companyChoice }).strict().refine(needsCompany, companyMessage);
/** Quick edit from a pipeline card. */
export const dealQuickEditInput = z
  .object({ id: z.uuid(), amount: amount.optional(), expected_close_date: optionalDate.optional(), probability: z.coerce.number().int().min(0).max(100).optional() })
  .strict();
export const moveStageInput = z
  .object({ deal_id: z.uuid(), stage_id: z.uuid(), lost_reason: optionalText(255).optional() })
  .strict();

// --- Orders ----------------------------------------------------------------

export const orderItemInput = z
  .object({
    product_id: optionalId,
    description: required(255),
    quantity: numberField({ positive: true, max: 1_000_000 }),
    unit_price: amount,
    discount_pct: percent,
    tax_rate: percent,
  })
  .strict();

export const orderFields = {
  company_id: z.uuid(),
  currency,
  order_date: z.iso.date(),
  expected_delivery_date: optionalDate,
  notes: text(5000),
  items: z.array(orderItemInput).min(1, "Add at least one line").max(50),
  owner_id: z.uuid().optional(),
};
export const orderInput = z.object(orderFields).strict();
export const orderUpdateInput = z.object({ id: z.uuid(), ...orderFields }).strict();
export const orderStatusInput = z.object({ id: z.uuid(), status: z.enum(ORDER_STATUSES) }).strict();
export const paymentInput = z
  .object({
    order_id: z.uuid(),
    amount: numberField({ positive: true, max: 1_000_000_000 }),
    paid_at: z.iso.date(),
    method: z.enum(PAYMENT_METHODS),
    reference: text(120),
  })
  .strict();
export const convertDealInput = z.object({ deal_id: z.uuid() }).strict();

// --- Tasks, activities, comments ------------------------------------------

export const taskFields = {
  title: required(200),
  description: text(5000),
  type: z.enum(TASK_TYPES),
  assignee_id: z.uuid(),
  due_at: optionalDateTime,
  priority: z.enum(TASK_PRIORITIES),
  status: z.enum(TASK_STATUSES),
  company_id: optionalId,
  contact_id: optionalId,
  deal_id: optionalId,
  order_id: optionalId,
};
export const taskInput = z.object(taskFields).strict();
export const taskUpdateInput = z.object({ id: z.uuid(), ...taskFields }).strict();

export const activityInput = z
  .object({
    type: z.enum(ACTIVITY_TYPES.filter((t) => t !== "system") as ["call", "meeting", "email", "note", "follow_up", "message"]),
    subject: required(200),
    body: text(5000),
    occurred_at: optionalDateTime,
    company_id: optionalId,
    contact_id: optionalId,
    lead_id: optionalId,
    deal_id: optionalId,
    order_id: optionalId,
  })
  .strict()
  .refine((a) => a.company_id || a.contact_id || a.lead_id || a.deal_id || a.order_id, { message: "Link the activity to a record" });

export const commentInput = z
  .object({ entity_type: z.enum(ENTITY_TYPES), entity_id: z.uuid(), body: required(5000) })
  .strict();

export const searchInput = z.object({ q: z.string().trim().min(1).max(100) }).strict();

/** A YooKassa or Stripe payment page for an order's outstanding amount. */
export const paymentLinkInput = z.object({ order_id: z.uuid(), provider: z.enum(["yookassa", "stripe"]) }).strict();
