import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { generateSeed } from "@/domain/seed/generate";
import { journaledTx, SUPABASE_PAGE_SIZE, supabaseTx } from "@/server/db";
import { createMemoryTx } from "@/server/db/memory-tx";

const ORG = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-0000000000ff";

/**
 * A stand-in for the PostgREST client: applies eq/gt/order/range/limit to an array and, like
 * Supabase, never returns more than SUPABASE_PAGE_SIZE rows per request.
 */
function fakeClient(tables: Record<string, Array<Record<string, unknown>>>) {
  const requests: string[] = [];
  const from = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    let window: [number, number] | null = null;
    let max = Infinity;
    const q = {
      select: () => q,
      eq: (k: string, v: unknown) => ((rows = rows.filter((r) => r[k] === v)), q),
      gt: (k: string, v: number) => ((rows = rows.filter((r) => (r[k] as number) > v)), q),
      is: (k: string, v: unknown) => ((rows = rows.filter((r) => (r[k] ?? null) === v)), q),
      in: (k: string, v: unknown[]) => ((rows = rows.filter((r) => v.includes(r[k]))), q),
      order: (k: string, o: { ascending: boolean }) => ((rows = rows.sort((a, b) => ((a[k] as number) > (b[k] as number) ? 1 : -1) * (o.ascending ? 1 : -1))), q),
      range: (a: number, b: number) => ((window = [a, b]), q),
      limit: (n: number) => ((max = n), q),
      maybeSingle: () => Promise.resolve({ data: rows.slice(0, 1)[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => void) => {
        requests.push(table);
        const page = (window ? rows.slice(window[0], window[1] + 1) : rows).slice(0, Math.min(max, SUPABASE_PAGE_SIZE));
        resolve({ data: page, error: null });
      },
    };
    return q;
  };
  return { client: { from } as unknown as SupabaseClient, requests };
}

describe("Supabase adapter", () => {
  it("reads every row, not just the first page PostgREST returns", async () => {
    const companies = Array.from({ length: 2_350 }, (_, i) => ({ id: String(i).padStart(6, "0"), organization_id: ORG }));
    const { client, requests } = fakeClient({ companies: [...companies, { id: "x", organization_id: OTHER }] });
    const rows = await supabaseTx(client, ORG).find("companies");
    expect(rows).toHaveLength(2_350);
    expect(requests).toHaveLength(3);
  });

  it("pages the security log with the cursor in the database", async () => {
    const events = Array.from({ length: 1_500 }, (_, i) => ({ event_id: `e${i}`, organization_id: ORG, sequence: i + 1 }));
    const { client } = fakeClient({ security_events: events });
    const page = await supabaseTx(client, ORG).securityEventsAfter(1_200, 200);
    expect(page.rows.map((e) => e.sequence)).toEqual(Array.from({ length: 200 }, (_, i) => 1_201 + i));
    expect(page.lastSequence).toBe(1_500);
  });

  it("refuses to insert into another organization through the service client", async () => {
    const { client } = fakeClient({});
    await expect(supabaseTx(client, ORG).insert("companies", { id: "c1", organization_id: OTHER } as never)).rejects.toThrow(/Cross-organization/);
  });
});

describe("undo journal for multi-step writes", () => {
  it("reverts inserts, updates and deletes when a later step fails", async () => {
    const data = generateSeed(new Date("2026-10-19T12:00:00Z"));
    const org = data.organizations[0]!.id;
    const base = createMemoryTx(data, org, true);
    const { tx, rollback } = journaledTx(base, base);
    const company = data.companies[0]!;
    const task = data.tasks[0]!;
    const before = { companies: data.companies.length, name: company.name, tasks: data.tasks.length };

    await tx.insert("companies", { ...company, id: "11111111-1111-4111-8111-111111111111", name: "Half-done Ltd" });
    await tx.update("companies", company.id, { name: "Renamed" });
    await tx.remove("tasks", task.id);
    expect(await rollback()).toEqual([]);

    expect(data.companies).toHaveLength(before.companies);
    expect(data.companies.find((c) => c.id === company.id)!.name).toBe(before.name);
    expect(data.tasks).toHaveLength(before.tasks);
    expect(data.tasks.some((t) => t.id === task.id)).toBe(true);
  });
});
