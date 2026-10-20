/**
 * Tx implementation over an in-memory Dataset. Used by the demo adapter and by unit tests.
 * No Next.js imports, so it can run anywhere.
 */
import type { Dataset, TableName } from "@/domain/entities";
import { nextOrderNumber } from "@/domain/rules/orders";
import { sealSecurityEvent } from "@/domain/security/events";
import { UNIQUE_KEYS, UniqueViolation, type Row, type Tx, type Where } from "./types";

type AnyRow = Record<string, unknown> & { id: string };

function belongs(table: TableName, row: AnyRow, orgId: string): boolean {
  return table === "organizations" ? row.id === orgId : row.organization_id === orgId;
}

export function matches(row: Record<string, unknown>, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  for (const [key, expected] of Object.entries(where)) {
    if (expected === undefined) continue;
    const actual = row[key] ?? null;
    if (Array.isArray(expected)) {
      if (!expected.includes(actual)) return false;
    } else if (actual !== expected) return false;
  }
  return true;
}

export function createMemoryTx(data: Dataset, orgId: string, writable: boolean): Tx {
  const rows = (table: TableName) => data[table] as unknown as AnyRow[];
  const guard = () => {
    if (!writable) throw new Error("Write attempted in a read-only transaction");
  };
  const checkUnique = (table: TableName, candidate: AnyRow) => {
    for (const cols of UNIQUE_KEYS[table] ?? []) {
      if (cols.some((c) => candidate[c] === null || candidate[c] === undefined)) continue;
      const clash = rows(table).find(
        (r) => r.id !== candidate.id && belongs(table, r, orgId) && cols.every((c) => r[c] === candidate[c]),
      );
      if (clash) throw new UniqueViolation(table, cols.join(","));
    }
  };

  return {
    orgId,
    // Reads return copies, like a database round trip: callers can keep a "before" row
    // while updating, and nothing mutates the store outside update().
    async find<T extends TableName>(table: T, where?: Where<Row<T>>) {
      return rows(table)
        .filter((r) => belongs(table, r, orgId) && matches(r, where as Record<string, unknown>))
        .map((r) => ({ ...r })) as unknown as Row<T>[];
    },
    async get<T extends TableName>(table: T, id: string) {
      const row = rows(table).find((r) => r.id === id && belongs(table, r, orgId));
      return row ? ({ ...row } as unknown as Row<T>) : null;
    },
    async insert<T extends TableName>(table: T, row: Row<T>) {
      guard();
      const r = row as unknown as AnyRow;
      if (table !== "organizations" && r.organization_id !== orgId) throw new Error("Cross-organization insert refused");
      if (rows(table).some((x) => x.id === r.id)) throw new UniqueViolation(table, "id");
      checkUnique(table, r);
      rows(table).push({ ...r });
      return row;
    },
    async update<T extends TableName>(table: T, id: string, patch: Partial<Row<T>>) {
      guard();
      const target = rows(table).find((r) => r.id === id && belongs(table, r, orgId));
      if (!target) throw new Error(`${table} ${id} not found`);
      // id and organization_id can never change through an update.
      const next = { ...target, ...(patch as Record<string, unknown>), id: target.id } as AnyRow;
      if ("organization_id" in target) next.organization_id = target.organization_id;
      checkUnique(table, next);
      Object.assign(target, next);
      return { ...target } as unknown as Row<T>;
    },
    async appendSecurityEvent(draft) {
      guard();
      if (draft.organization_id !== orgId) throw new Error("Cross-organization security event refused");
      const chain = data.security_events.filter((e) => e.organization_id === orgId);
      const last = chain.reduce<(typeof chain)[number] | null>((a, b) => (!a || b.sequence > a.sequence ? b : a), null);
      const event = sealSecurityEvent(draft, last);
      data.security_events.push(event);
      return event;
    },
    async nextOrderNumber(year) {
      return nextOrderNumber(
        rows("orders").filter((r) => belongs("orders", r, orgId)).map((r) => r.order_number as string),
        year,
      );
    },
    async remove(table, id) {
      guard();
      const list = rows(table);
      const index = list.findIndex((r) => r.id === id && belongs(table, r, orgId));
      if (index >= 0) list.splice(index, 1);
    },
  };
}
