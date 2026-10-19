import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TableName } from "@/domain/entities";
import { getDataMode } from "@/server/env";
import { getDemoStore } from "@/server/repositories/demo";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { createMemoryTx } from "./memory-tx";
import { UniqueViolation, type Db, type Row, type Tx, type Where } from "./types";

const demoDb: Db = {
  async read(orgId, fn) {
    const data = await getDemoStore().read();
    return fn(createMemoryTx(data, orgId, false));
  },
  write(orgId, fn) {
    return getDemoStore().mutate((data) => fn(createMemoryTx(data, orgId, true)));
  },
};

function supabaseTx(db: SupabaseClient, orgId: string): Tx {
  const scope = (table: TableName) => (table === "organizations" ? "id" : "organization_id");
  const raise = (table: TableName, error: { code?: string; message: string }): never => {
    if (error.code === "23505") throw new UniqueViolation(table, error.message);
    throw new Error(`${table}: ${error.message}`);
  };
  return {
    orgId,
    async find<T extends TableName>(table: T, where?: Where<Row<T>>) {
      let q = db.from(table).select("*").eq(scope(table), orgId);
      for (const [key, value] of Object.entries((where ?? {}) as Record<string, unknown>)) {
        if (value === undefined) continue;
        if (value === null) q = q.is(key, null);
        else if (Array.isArray(value)) q = q.in(key, value);
        else q = q.eq(key, value as string);
      }
      const { data, error } = await q;
      if (error) raise(table, error);
      return (data ?? []) as Row<T>[];
    },
    async get<T extends TableName>(table: T, id: string) {
      const { data, error } = await db.from(table).select("*").eq(scope(table), orgId).eq("id", id).maybeSingle();
      if (error) raise(table, error);
      return (data as Row<T> | null) ?? null;
    },
    async insert<T extends TableName>(table: T, row: Row<T>) {
      const { data, error } = await db.from(table).insert(row as never).select("*").single();
      if (error) raise(table, error);
      return data as Row<T>;
    },
    async update<T extends TableName>(table: T, id: string, patch: Partial<Row<T>>) {
      const { id: _ignored, organization_id: _org, ...rest } = patch as Record<string, unknown>;
      void _ignored;
      void _org;
      const { data, error } = await db.from(table).update(rest as never).eq(scope(table), orgId).eq("id", id).select("*").single();
      if (error) raise(table, error);
      return data as Row<T>;
    },
    async nextOrderNumber(year) {
      const { data, error } = await db.rpc("next_order_number", { order_year: year });
      if (error) raise("orders", error);
      return data as string;
    },
    async remove(table, id) {
      const { error } = await db.from(table).delete().eq(scope(table), orgId).eq("id", id);
      if (error) raise(table, error);
    },
  };
}

const supabaseDb: Db = {
  async read(orgId, fn) {
    return fn(supabaseTx(await createSupabaseServerClient(), orgId));
  },
  async write(orgId, fn) {
    return fn(supabaseTx(await createSupabaseServerClient(), orgId));
  },
};

export function getDb(): Db {
  return getDataMode() === "supabase" ? supabaseDb : demoDb;
}

export type { Db, Row, Tx, Where } from "./types";
export { UniqueViolation } from "./types";
