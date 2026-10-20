/**
 * Minimal data-access primitive used by the domain services (phase 2+).
 *
 * Every Tx is bound to one organization (taken from the server session) and
 * automatically scopes every read and write to it. Role visibility is applied by
 * the services through src/domain/permissions.ts; in Supabase mode RLS enforces it again.
 *
 * Atomicity: the demo adapter runs a write callback against a copy of the dataset and
 * commits only if it succeeds. The Supabase adapter issues the statements one by one;
 * critical invariants (one order per deal, one conversion per lead, notification dedupe)
 * are guaranteed by unique constraints instead. See PROGRESS.md.
 */
import type { Dataset, TableName } from "@/domain/entities";
import type { SecurityEvent, SecurityEventDraft } from "@/domain/security/events";

export type Row<T extends TableName> = Dataset[T][number];

/** Equality filters. An array means "in", null means "is null". */
export type Where<R> = { [K in keyof R]?: R[K] | ReadonlyArray<NonNullable<R[K]>> | null };

export interface Tx {
  readonly orgId: string;
  find<T extends TableName>(table: T, where?: Where<Row<T>>): Promise<Row<T>[]>;
  get<T extends TableName>(table: T, id: string): Promise<Row<T> | null>;
  insert<T extends TableName>(table: T, row: Row<T>): Promise<Row<T>>;
  update<T extends TableName>(table: T, id: string, patch: Partial<Row<T>>): Promise<Row<T>>;
  remove(table: TableName, id: string): Promise<void>;
  /** Next order number for the year across the whole organization (not just visible orders). */
  nextOrderNumber(year: number): Promise<string>;
  /**
   * Appends to the organization's hash-chained security log. Sequence and prev_hash are
   * assigned here so the chain stays consistent; concurrent appends are serialized
   * (demo: write queue; Supabase: unique (organization_id, sequence) + retry).
   */
  appendSecurityEvent(draft: SecurityEventDraft): Promise<SecurityEvent>;
}

export interface Db {
  read<R>(orgId: string, fn: (tx: Tx) => Promise<R>): Promise<R>;
  write<R>(orgId: string, fn: (tx: Tx) => Promise<R>): Promise<R>;
}

/** Raised when a unique constraint would be violated (both adapters). */
export class UniqueViolation extends Error {
  constructor(
    public readonly table: TableName,
    public readonly constraint: string,
  ) {
    super(`Unique constraint ${constraint} on ${table}`);
    this.name = "UniqueViolation";
  }
}

/** Unique keys the demo adapter enforces, mirroring supabase/migrations. Values are column lists, all scoped to the organization unless noted. */
export const UNIQUE_KEYS: Partial<Record<TableName, string[][]>> = {
  orders: [["source_deal_id"], ["order_number"]],
  leads: [["converted_deal_id"]],
  deals: [["lead_id"]],
  notifications: [["dedupe_key"]],
  automation_executions: [["idempotency_key"]],
  products: [["sku"]],
  api_keys: [["key_hash"]],
};
