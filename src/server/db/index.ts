import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApiKey, TableName } from "@/domain/entities";
import { getDataMode } from "@/server/env";
import { getDemoStore } from "@/server/repositories/demo";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { createSupabaseServiceClient } from "@/server/supabase/service";
import { sealSecurityEvent, type SecurityEvent } from "@/domain/security/events";
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

/**
 * PostgREST returns at most `max_rows` rows per request (1000 on Supabase by default), silently.
 * Reads therefore page through the table in a stable order until a short page comes back.
 */
export const SUPABASE_PAGE_SIZE = 1000;

export function supabaseTx(db: SupabaseClient, orgId: string): Tx {
  const scope = (table: TableName) => (table === "organizations" ? "id" : "organization_id");
  const orderKey = (table: TableName) => (table === "security_events" ? "sequence" : "id");
  const raise = (table: TableName, error: { code?: string; message: string }): never => {
    if (error.code === "23505") throw new UniqueViolation(table, error.message);
    throw new Error(`${table}: ${error.message}`);
  };
  return {
    orgId,
    async find<T extends TableName>(table: T, where?: Where<Row<T>>) {
      const all: Row<T>[] = [];
      for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
        let q = db.from(table).select("*").eq(scope(table), orgId);
        for (const [key, value] of Object.entries((where ?? {}) as Record<string, unknown>)) {
          if (value === undefined) continue;
          if (value === null) q = q.is(key, null);
          else if (Array.isArray(value)) q = q.in(key, value);
          else q = q.eq(key, value as string);
        }
        const { data, error } = await q.order(orderKey(table), { ascending: true }).range(from, from + SUPABASE_PAGE_SIZE - 1);
        if (error) raise(table, error);
        const page = (data ?? []) as Row<T>[];
        all.push(...page);
        if (page.length < SUPABASE_PAGE_SIZE) return all;
      }
    },
    async get<T extends TableName>(table: T, id: string) {
      const { data, error } = await db.from(table).select("*").eq(scope(table), orgId).eq("id", id).maybeSingle();
      if (error) raise(table, error);
      return (data as Row<T> | null) ?? null;
    },
    async insert<T extends TableName>(table: T, row: Row<T>) {
      // The service client bypasses RLS, so the organization boundary is enforced here too (as in the demo adapter).
      const owner = table === "organizations" ? (row as { id?: string }).id : (row as { organization_id?: string }).organization_id;
      if (owner !== orgId) throw new Error("Cross-organization insert refused");
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
    async appendSecurityEvent(draft) {
      // Written with the service client: some events have no session (failed login, cron).
      const service = createSupabaseServiceClient();
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data: last, error: readError } = await service
          .from("security_events")
          .select("sequence, hash")
          .eq("organization_id", orgId)
          .order("sequence", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (readError) raise("security_events", readError);
        const event = sealSecurityEvent({ ...draft, organization_id: orgId }, (last as Pick<SecurityEvent, "sequence" | "hash"> | null) ?? null);
        const { error } = await service.from("security_events").insert(event);
        if (!error) return event;
        if (error.code !== "23505") raise("security_events", error);
      }
      throw new Error("security_events: could not append after 5 attempts");
    },
    async securityEventsAfter(after, limit) {
      const page = await db.from("security_events").select("*").eq("organization_id", orgId).gt("sequence", after).order("sequence", { ascending: true }).limit(limit);
      if (page.error) raise("security_events", page.error);
      const last = await db.from("security_events").select("sequence").eq("organization_id", orgId).order("sequence", { ascending: false }).limit(1).maybeSingle();
      if (last.error) raise("security_events", last.error);
      return { rows: (page.data ?? []) as SecurityEvent[], lastSequence: (last.data as { sequence: number } | null)?.sequence ?? 0 };
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

/**
 * PostgREST has no multi-statement transactions, so a write callback runs with an undo journal:
 * every insert, update and delete it makes is recorded, and if the callback throws, the changes are
 * reverted in reverse order (with the service client, scoped to the same organization). This turns
 * "a company without its deal" after a failure into "nothing happened". Security events are not
 * reverted: they record what was attempted. Single-statement invariants stay on unique constraints.
 */
export function journaledTx(tx: Tx, undo: Tx): { tx: Tx; rollback: () => Promise<string[]> } {
  const steps: Array<() => Promise<void>> = [];
  const journaled: Tx = {
    ...tx,
    orgId: tx.orgId,
    find: (table, where) => tx.find(table, where),
    get: (table, id) => tx.get(table, id),
    async insert(table, row) {
      const created = await tx.insert(table, row);
      steps.push(() => undo.remove(table, (created as { id: string }).id));
      return created;
    },
    async update(table, id, patch) {
      const before = await tx.get(table, id);
      const updated = await tx.update(table, id, patch);
      if (before) {
        const restore = Object.fromEntries(Object.keys(patch).map((k) => [k, (before as Record<string, unknown>)[k]]));
        steps.push(async () => void (await undo.update(table, id, restore as never)));
      }
      return updated;
    },
    async remove(table, id) {
      const before = await tx.get(table, id);
      await tx.remove(table, id);
      if (before) steps.push(async () => void (await undo.insert(table, before as never)));
    },
    nextOrderNumber: (year) => tx.nextOrderNumber(year),
    appendSecurityEvent: (draft) => tx.appendSecurityEvent(draft),
    securityEventsAfter: (after, limit) => tx.securityEventsAfter(after, limit),
  };
  const rollback = async () => {
    const failures: string[] = [];
    for (const step of steps.reverse()) {
      try {
        await step();
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
    return failures;
  };
  return { tx: journaled, rollback };
}

async function journaledWrite<R>(client: SupabaseClient, orgId: string, fn: (tx: Tx) => Promise<R>): Promise<R> {
  const { tx, rollback } = journaledTx(supabaseTx(client, orgId), supabaseTx(createSupabaseServiceClient(), orgId));
  try {
    return await fn(tx);
  } catch (error) {
    const failures = await rollback();
    if (failures.length) console.error("[db] rollback incomplete; manual check needed", { orgId, failures });
    throw error;
  }
}

const supabaseDb: Db = {
  async read(orgId, fn) {
    return fn(supabaseTx(await createSupabaseServerClient(), orgId));
  },
  async write(orgId, fn) {
    return journaledWrite(await createSupabaseServerClient(), orgId, fn);
  },
};

export function getDb(): Db {
  return getDataMode() === "supabase" ? supabaseDb : demoDb;
}

/**
 * Database access for the automation engine and scheduler, which act as a service
 * principal rather than as the signed-in user. Demo mode uses the same store.
 */
const supabaseServiceDb: Db = {
  async read(orgId, fn) {
    return fn(supabaseTx(createSupabaseServiceClient(), orgId));
  },
  async write(orgId, fn) {
    return journaledWrite(createSupabaseServiceClient(), orgId, fn);
  },
};

export function getServiceDb(): Db {
  return getDataMode() === "supabase" ? supabaseServiceDb : demoDb;
}

/** Every organization id, for system jobs (scheduler, cron) that run across tenants. */
export async function listOrganizationIds(): Promise<string[]> {
  if (getDataMode() === "supabase") {
    const { data, error } = await createSupabaseServiceClient().from("organizations").select("id");
    if (error) throw new Error(`organizations: ${error.message}`);
    return (data ?? []).map((o) => o.id as string);
  }
  return (await getDemoStore().read()).organizations.map((o) => o.id);
}

/**
 * Finds an API key by the hash of the presented key, across organizations: the key itself
 * says which organization it belongs to. Used only by the public API authentication.
 */
export async function findApiKeyByHash(hash: string): Promise<ApiKey | null> {
  if (getDataMode() === "supabase") {
    const { data, error } = await createSupabaseServiceClient().from("api_keys").select("*").eq("key_hash", hash).maybeSingle();
    if (error) throw new Error(`api_keys: ${error.message}`);
    return (data as ApiKey | null) ?? null;
  }
  return (await getDemoStore().read()).api_keys.find((k) => k.key_hash === hash) ?? null;
}

/** Keys with a given public prefix (to attribute a wrong secret to an organization's log). */
export async function findApiKeysByPrefix(prefix: string): Promise<ApiKey[]> {
  if (getDataMode() === "supabase") {
    const { data, error } = await createSupabaseServiceClient().from("api_keys").select("*").eq("prefix", prefix);
    if (error) throw new Error(`api_keys: ${error.message}`);
    return (data ?? []) as ApiKey[];
  }
  return (await getDemoStore().read()).api_keys.filter((k) => k.prefix === prefix);
}

export type { Db, Row, Tx, Where } from "./types";
export { UniqueViolation } from "./types";
