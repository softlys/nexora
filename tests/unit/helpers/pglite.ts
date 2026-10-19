/**
 * Boots an in-process PostgreSQL (PGlite) that imitates the parts of Supabase the
 * migrations rely on: the anon/authenticated roles, auth.users and auth.uid().
 * Used to prove the migrations apply cleanly and that RLS matches the permission matrix.
 */
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Dataset } from "@/domain/entities";
import { deferredLeadLinks, LOAD_ORDER, rowsForLoad } from "@/domain/seed/load-order";

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

export async function createDatabase(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  const dir = join(process.cwd(), "supabase", "migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    try {
      await db.exec(readFileSync(join(dir, file), "utf8"));
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }
  return db;
}

function toParam(value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) return JSON.stringify(value);
  if (Array.isArray(value) && value.some((v) => typeof v === "object" && v !== null)) return JSON.stringify(value);
  return value;
}

/** `table` is schema-qualified, e.g. "public.companies". */
export async function insertRows(db: PGlite, table: string, rows: Record<string, unknown>[]) {
  for (const row of rows) {
    const cols = Object.keys(row);
    const sql = `insert into ${table} (${cols.map((c) => `"${c}"`).join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`;
    await db.query(sql, cols.map((c) => toParam(row[c])));
  }
}

/** Loads a dataset as the table owner (RLS does not apply to the owner). */
export async function loadDataset(db: PGlite, data: Dataset) {
  await insertRows(db, "auth.users", data.profiles.map((p) => ({ id: p.id, email: p.email })));
  for (const table of LOAD_ORDER) await insertRows(db, `public.${table}`, rowsForLoad(data, table));
  for (const link of deferredLeadLinks(data)) {
    await db.query("update public.leads set converted_deal_id = $1 where id = $2", [link.converted_deal_id, link.id]);
  }
}

/** Runs `fn` as the `authenticated` role with auth.uid() = userId, inside a rolled-back transaction. */
export async function asUser<T>(db: PGlite, userId: string, fn: (tx: Pick<PGlite, "query" | "exec">) => Promise<T>): Promise<T> {
  let result: T;
  await db.exec("begin");
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    await db.exec("set local role authenticated");
    result = await fn(db);
  } finally {
    await db.exec("rollback");
  }
  return result!;
}
