/**
 * Insert order for loading a Dataset into PostgreSQL so foreign keys resolve.
 * leads.converted_deal_id points forward to deals, so leads are inserted without it
 * and patched after deals exist (`deferredLeadLinks`).
 */
import type { Dataset, Lead, TableName } from "../entities";

export const LOAD_ORDER: TableName[] = [
  "organizations",
  "profiles",
  "companies",
  "contacts",
  "pipeline_stages",
  "leads",
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
];

export function rowsForLoad(data: Dataset, table: TableName): Record<string, unknown>[] {
  const rows = data[table] as unknown as Record<string, unknown>[];
  if (table === "leads") return (rows as unknown as Lead[]).map((l) => ({ ...l, converted_deal_id: null }));
  return rows;
}

export function deferredLeadLinks(data: Dataset): Array<{ id: string; converted_deal_id: string }> {
  return data.leads.filter((l) => l.converted_deal_id).map((l) => ({ id: l.id, converted_deal_id: l.converted_deal_id! }));
}
