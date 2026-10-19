/**
 * Domain entities: Zod schemas and inferred TypeScript types.
 * These mirror supabase/migrations and are shared by the demo and Supabase adapters.
 * Column names use snake_case so rows map 1:1 to PostgreSQL.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const id = z.uuid();
export const timestamp = z.iso.datetime({ offset: true });
export const dateOnly = z.iso.date();
export const money = z.number().finite().min(0).max(1_000_000_000);
export const currencyCode = z.string().regex(/^[A-Z]{3}$/, "Use a 3-letter ISO currency code");
export const countryCode = z.string().regex(/^[A-Z]{2}$/, "Use a 2-letter ISO country code");
const shortText = (max: number) => z.string().trim().max(max);
const requiredText = (max: number) => z.string().trim().min(1, "Required").max(max);

const base = {
  id,
  organization_id: id,
  created_at: timestamp,
  updated_at: timestamp,
};
const archivable = { archived_at: timestamp.nullable() };

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const ROLES = ["admin", "manager", "sales_rep"] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

export const COMPANY_SIZES = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1000+"] as const;
export const LIFECYCLE_STAGES = ["prospect", "customer", "partner", "churned"] as const;
export const LEAD_SOURCES = ["website", "referral", "trade_show", "outbound", "partner", "inbound_call", "api"] as const;
export const LEAD_STATUSES = ["new", "contacted", "qualified", "unqualified", "converted"] as const;
export const LEAD_QUALIFICATIONS = ["cold", "warm", "hot"] as const;
export const ORDER_STATUSES = ["draft", "confirmed", "processing", "shipped", "delivered", "cancelled"] as const;
export const PAYMENT_STATUSES = ["unpaid", "partially_paid", "paid", "overdue"] as const;
export const FULFILLMENT_STATUSES = ["unfulfilled", "partially_fulfilled", "fulfilled", "returned"] as const;
export const PAYMENT_METHODS = ["bank_transfer", "card", "other"] as const;
export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export const TASK_STATUSES = ["todo", "in_progress", "done", "cancelled"] as const;
export const TASK_TYPES = ["follow_up", "call", "email", "meeting", "todo"] as const;
export const ACTIVITY_TYPES = ["call", "meeting", "email", "note", "follow_up", "system"] as const;
export const ENTITY_TYPES = ["company", "contact", "lead", "deal", "order", "task"] as const;
export const INTEGRATION_PROVIDERS = ["make", "n8n", "generic_webhook", "email"] as const;
export const EXECUTION_STATUSES = ["running", "success", "failed", "skipped"] as const;
export const DELIVERY_STATUSES = ["pending", "success", "failed"] as const;
export const API_KEY_KINDS = ["integration", "siem"] as const;
export const ORDER_CONVERSION_MODES = ["draft", "confirmed"] as const;

export type CompanySize = (typeof COMPANY_SIZES)[number];
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];
export type LeadSource = (typeof LEAD_SOURCES)[number];
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export type EntityType = (typeof ENTITY_TYPES)[number];

// ---------------------------------------------------------------------------
// Organization and people
// ---------------------------------------------------------------------------

export const organizationSettingsSchema = z
  .object({
    order_conversion_mode: z.enum(ORDER_CONVERSION_MODES),
  })
  .strict();

export const organizationSchema = z.object({
  id,
  name: requiredText(120),
  slug: z.string().regex(/^[a-z0-9-]{2,60}$/),
  currency: currencyCode,
  locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
  timezone: requiredText(64),
  settings: organizationSettingsSchema,
  created_at: timestamp,
  updated_at: timestamp,
});
export type Organization = z.infer<typeof organizationSchema>;

export const profileSchema = z.object({
  ...base,
  ...archivable,
  full_name: requiredText(120),
  email: z.email().max(254),
  role: roleSchema,
  title: shortText(120),
  manager_id: id.nullable(),
  is_active: z.boolean(),
});
export type Profile = z.infer<typeof profileSchema>;

// ---------------------------------------------------------------------------
// CRM
// ---------------------------------------------------------------------------

export const companySchema = z.object({
  ...base,
  ...archivable,
  name: requiredText(160),
  website: z.url().max(255).nullable(),
  industry: requiredText(80),
  size: z.enum(COMPANY_SIZES),
  country: countryCode,
  city: shortText(120),
  address: shortText(255),
  phone: shortText(40).nullable(),
  lifecycle_stage: z.enum(LIFECYCLE_STAGES),
  owner_id: id,
  notes: shortText(5000),
});
export type Company = z.infer<typeof companySchema>;

export const contactSchema = z.object({
  ...base,
  ...archivable,
  company_id: id.nullable(),
  first_name: requiredText(80),
  last_name: requiredText(80),
  email: z.email().max(254).nullable(),
  phone: z
    .string()
    .regex(/^\+?[0-9 ()-]{6,24}$/, "Enter a valid phone number")
    .nullable(),
  job_title: shortText(120),
  owner_id: id,
  tags: z.array(z.string().trim().min(1).max(32)).max(10),
});
export type Contact = z.infer<typeof contactSchema>;

export const leadSchema = z.object({
  ...base,
  ...archivable,
  title: requiredText(160),
  company_name: requiredText(160),
  contact_name: requiredText(160),
  email: z.email().max(254).nullable(),
  phone: shortText(40).nullable(),
  country: countryCode.nullable(),
  source: z.enum(LEAD_SOURCES),
  status: z.enum(LEAD_STATUSES),
  qualification: z.enum(LEAD_QUALIFICATIONS),
  owner_id: id.nullable(),
  next_action: shortText(255),
  next_action_at: timestamp.nullable(),
  estimated_value: money,
  currency: currencyCode,
  company_id: id.nullable(),
  contact_id: id.nullable(),
  converted_deal_id: id.nullable(),
  converted_at: timestamp.nullable(),
});
export type Lead = z.infer<typeof leadSchema>;

export const pipelineStageSchema = z
  .object({
    ...base,
    name: requiredText(60),
    position: z.number().int().min(0).max(100),
    probability: z.number().int().min(0).max(100),
    is_won: z.boolean(),
    is_lost: z.boolean(),
  })
  .refine((s) => !(s.is_won && s.is_lost), { message: "A stage cannot be both won and lost" });
export type PipelineStage = z.infer<typeof pipelineStageSchema>;

export const dealSchema = z.object({
  ...base,
  ...archivable,
  name: requiredText(160),
  company_id: id,
  primary_contact_id: id.nullable(),
  amount: money,
  currency: currencyCode,
  stage_id: id,
  probability: z.number().int().min(0).max(100),
  expected_close_date: dateOnly.nullable(),
  owner_id: id,
  source: z.enum(LEAD_SOURCES),
  next_activity: shortText(255),
  notes: shortText(5000),
  lost_reason: shortText(255).nullable(),
  stage_entered_at: timestamp,
  closed_at: timestamp.nullable(),
  lead_id: id.nullable(),
});
export type Deal = z.infer<typeof dealSchema>;

export const dealStageHistorySchema = z.object({
  id,
  organization_id: id,
  deal_id: id,
  from_stage_id: id.nullable(),
  to_stage_id: id,
  changed_by: id.nullable(),
  changed_at: timestamp,
});
export type DealStageHistory = z.infer<typeof dealStageHistorySchema>;

// ---------------------------------------------------------------------------
// Commerce
// ---------------------------------------------------------------------------

export const productSchema = z.object({
  ...base,
  ...archivable,
  sku: z.string().regex(/^[A-Z0-9-]{3,32}$/),
  name: requiredText(160),
  category: requiredText(80),
  description: shortText(1000),
  unit_price: money,
  currency: currencyCode,
  tax_rate: z.number().min(0).max(100),
  is_active: z.boolean(),
});
export type Product = z.infer<typeof productSchema>;

export const orderSchema = z.object({
  ...base,
  ...archivable,
  order_number: z.string().regex(/^NX-\d{4}-\d{4,}$/),
  company_id: id,
  source_deal_id: id.nullable(),
  status: z.enum(ORDER_STATUSES),
  payment_status: z.enum(PAYMENT_STATUSES),
  fulfillment_status: z.enum(FULFILLMENT_STATUSES),
  currency: currencyCode,
  subtotal: money,
  discount_total: money,
  tax_total: money,
  total: money,
  order_date: dateOnly,
  payment_due_date: dateOnly.nullable(),
  expected_delivery_date: dateOnly.nullable(),
  delivered_at: timestamp.nullable(),
  owner_id: id,
  notes: shortText(5000),
});
export type Order = z.infer<typeof orderSchema>;

export const orderItemSchema = z.object({
  id,
  organization_id: id,
  order_id: id,
  product_id: id.nullable(),
  description: requiredText(255),
  quantity: z.number().positive().max(1_000_000),
  unit_price: money,
  discount_pct: z.number().min(0).max(100),
  tax_rate: z.number().min(0).max(100),
  line_total: money,
  position: z.number().int().min(0),
  created_at: timestamp,
  updated_at: timestamp,
});
export type OrderItem = z.infer<typeof orderItemSchema>;

export const paymentSchema = z.object({
  ...base,
  order_id: id,
  amount: money.refine((v) => v > 0, "Amount must be positive"),
  currency: currencyCode,
  paid_at: timestamp,
  method: z.enum(PAYMENT_METHODS),
  reference: shortText(120),
  /** NEXORA never processes real payments. Always true. */
  is_simulated: z.literal(true),
  recorded_by: id.nullable(),
});
export type Payment = z.infer<typeof paymentSchema>;

// ---------------------------------------------------------------------------
// Work management
// ---------------------------------------------------------------------------

export const taskSchema = z.object({
  ...base,
  ...archivable,
  title: requiredText(200),
  description: shortText(5000),
  type: z.enum(TASK_TYPES),
  assignee_id: id,
  created_by: id.nullable(),
  due_at: timestamp.nullable(),
  priority: z.enum(TASK_PRIORITIES),
  status: z.enum(TASK_STATUSES),
  completed_at: timestamp.nullable(),
  company_id: id.nullable(),
  contact_id: id.nullable(),
  deal_id: id.nullable(),
  order_id: id.nullable(),
});
export type Task = z.infer<typeof taskSchema>;

export const activitySchema = z.object({
  ...base,
  type: z.enum(ACTIVITY_TYPES),
  subject: requiredText(200),
  body: shortText(5000),
  occurred_at: timestamp,
  actor_id: id.nullable(),
  company_id: id.nullable(),
  contact_id: id.nullable(),
  lead_id: id.nullable(),
  deal_id: id.nullable(),
  order_id: id.nullable(),
});
export type Activity = z.infer<typeof activitySchema>;

export const commentSchema = z.object({
  ...base,
  ...archivable,
  entity_type: z.enum(ENTITY_TYPES),
  entity_id: id,
  author_id: id,
  body: requiredText(5000),
});
export type Comment = z.infer<typeof commentSchema>;

export const notificationSchema = z.object({
  id,
  organization_id: id,
  recipient_id: id,
  type: requiredText(64),
  title: requiredText(200),
  body: shortText(1000),
  link: z
    .string()
    .regex(/^\/[A-Za-z0-9/_?=&.-]*$/, "Internal links only")
    .nullable(),
  read_at: timestamp.nullable(),
  dedupe_key: shortText(200).nullable(),
  created_at: timestamp,
});
export type Notification = z.infer<typeof notificationSchema>;

// ---------------------------------------------------------------------------
// Automation, integrations, security
// ---------------------------------------------------------------------------

export const automationWorkflowSchema = z.object({
  ...base,
  ...archivable,
  name: requiredText(120),
  description: shortText(1000),
  trigger_type: requiredText(64),
  /** Validated by the automation engine schema (phase 3). */
  definition: z.record(z.string(), z.unknown()),
  enabled: z.boolean(),
  version: z.number().int().min(1),
  created_by: id.nullable(),
  updated_by: id.nullable(),
});
export type AutomationWorkflow = z.infer<typeof automationWorkflowSchema>;

export const automationExecutionSchema = z.object({
  id,
  organization_id: id,
  workflow_id: id,
  workflow_version: z.number().int().min(1),
  event_id: z.string().max(120),
  idempotency_key: z.string().max(200),
  trigger_payload: z.record(z.string(), z.unknown()),
  status: z.enum(EXECUTION_STATUSES),
  steps: z.array(z.record(z.string(), z.unknown())),
  causation_depth: z.number().int().min(0),
  retry_of: id.nullable(),
  error: shortText(2000).nullable(),
  started_at: timestamp,
  finished_at: timestamp.nullable(),
  duration_ms: z.number().int().min(0).nullable(),
  created_at: timestamp,
});
export type AutomationExecution = z.infer<typeof automationExecutionSchema>;

export const integrationSettingSchema = z.object({
  ...base,
  provider: z.enum(INTEGRATION_PROVIDERS),
  name: requiredText(120),
  /** Non-secret configuration only (URLs, options). */
  config: z.record(z.string(), z.unknown()),
  /** Hash of the signing secret; the secret itself is shown once. */
  secret_hash: z.string().nullable(),
  subscribed_events: z.array(z.string().max(64)).max(32),
  enabled: z.boolean(),
  last_tested_at: timestamp.nullable(),
  last_test_ok: z.boolean().nullable(),
  last_error: shortText(1000).nullable(),
});
export type IntegrationSetting = z.infer<typeof integrationSettingSchema>;

export const webhookDeliverySchema = z.object({
  id,
  organization_id: id,
  integration_id: id,
  event_id: z.string().max(120),
  event_type: z.string().max(64),
  url: z.url(),
  attempt: z.number().int().min(1).max(10),
  status: z.enum(DELIVERY_STATUSES),
  status_code: z.number().int().nullable(),
  duration_ms: z.number().int().min(0).nullable(),
  request_body: z.record(z.string(), z.unknown()),
  response_excerpt: shortText(2000).nullable(),
  error: shortText(1000).nullable(),
  next_retry_at: timestamp.nullable(),
  created_at: timestamp,
});
export type WebhookDelivery = z.infer<typeof webhookDeliverySchema>;

export const apiKeySchema = z.object({
  ...base,
  name: requiredText(120),
  kind: z.enum(API_KEY_KINDS),
  /** First characters of the key, shown in the UI to identify it. */
  prefix: z.string().max(16),
  /** SHA-256 of the full key. The key itself is never stored. */
  key_hash: z.string().regex(/^[a-f0-9]{64}$/),
  scopes: z.array(z.string().max(64)).min(1).max(16),
  created_by: id.nullable(),
  last_used_at: timestamp.nullable(),
  revoked_at: timestamp.nullable(),
});
export type ApiKey = z.infer<typeof apiKeySchema>;

export const auditLogSchema = z.object({
  id,
  organization_id: id,
  actor_id: id.nullable(),
  actor_role: z.string().max(32).nullable(),
  action: requiredText(80),
  target_type: requiredText(64),
  target_id: z.string().max(120).nullable(),
  changes: z.record(z.string(), z.unknown()),
  ip: z.string().max(64).nullable(),
  user_agent: z.string().max(512).nullable(),
  request_id: z.string().max(64).nullable(),
  created_at: timestamp,
});
export type AuditLog = z.infer<typeof auditLogSchema>;

// ---------------------------------------------------------------------------
// Whole dataset (demo store shape and seed output)
// ---------------------------------------------------------------------------

export const TABLES = [
  "organizations",
  "profiles",
  "companies",
  "contacts",
  "leads",
  "pipeline_stages",
  "deals",
  "deal_stage_history",
  "products",
  "orders",
  "order_items",
  "payments",
  "tasks",
  "activities",
  "comments",
  "notifications",
  "automation_workflows",
  "automation_executions",
  "integration_settings",
  "webhook_deliveries",
  "api_keys",
  "audit_logs",
] as const;
export type TableName = (typeof TABLES)[number];

export type Dataset = {
  organizations: Organization[];
  profiles: Profile[];
  companies: Company[];
  contacts: Contact[];
  leads: Lead[];
  pipeline_stages: PipelineStage[];
  deals: Deal[];
  deal_stage_history: DealStageHistory[];
  products: Product[];
  orders: Order[];
  order_items: OrderItem[];
  payments: Payment[];
  tasks: Task[];
  activities: Activity[];
  comments: Comment[];
  notifications: Notification[];
  automation_workflows: AutomationWorkflow[];
  automation_executions: AutomationExecution[];
  integration_settings: IntegrationSetting[];
  webhook_deliveries: WebhookDelivery[];
  api_keys: ApiKey[];
  audit_logs: AuditLog[];
};

export const entitySchemas: Record<TableName, z.ZodType> = {
  organizations: organizationSchema,
  profiles: profileSchema,
  companies: companySchema,
  contacts: contactSchema,
  leads: leadSchema,
  pipeline_stages: pipelineStageSchema,
  deals: dealSchema,
  deal_stage_history: dealStageHistorySchema,
  products: productSchema,
  orders: orderSchema,
  order_items: orderItemSchema,
  payments: paymentSchema,
  tasks: taskSchema,
  activities: activitySchema,
  comments: commentSchema,
  notifications: notificationSchema,
  automation_workflows: automationWorkflowSchema,
  automation_executions: automationExecutionSchema,
  integration_settings: integrationSettingSchema,
  webhook_deliveries: webhookDeliverySchema,
  api_keys: apiKeySchema,
  audit_logs: auditLogSchema,
};

// ---------------------------------------------------------------------------
// Input schemas for phase 1 mutations (strict: unknown keys are rejected)
// ---------------------------------------------------------------------------

export const updateOrganizationInput = z
  .object({
    name: requiredText(120),
    currency: currencyCode,
    locale: z.enum(["en-US", "en-GB", "de-DE", "fr-FR", "nl-NL", "sv-SE"]),
    order_conversion_mode: z.enum(ORDER_CONVERSION_MODES),
  })
  .strict();

export const updateProfileInput = z
  .object({
    full_name: requiredText(120),
    title: shortText(120),
  })
  .strict();

export const changeRoleInput = z
  .object({
    profile_id: id,
    role: roleSchema,
  })
  .strict();

export const pipelineStageInput = z
  .object({
    id: id.optional(),
    name: requiredText(60),
    probability: z.coerce.number().int().min(0).max(100),
    is_won: z.boolean(),
    is_lost: z.boolean(),
  })
  .strict()
  .refine((s) => !(s.is_won && s.is_lost), {
    message: "A stage cannot be both won and lost",
    path: ["is_lost"],
  });

export const reorderStagesInput = z
  .object({
    ordered_ids: z.array(id).min(2).max(30),
  })
  .strict();
