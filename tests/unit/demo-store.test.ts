import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { daysBetween, shiftDataset, shiftValue } from "@/domain/seed/shift";
import { generateSeed } from "@/domain/seed/generate";
import { createSeededStore, DemoStore, reanchor, writeStoreFile } from "@/server/demo/file-store";

const dir = mkdtempSync(join(tmpdir(), "nexora-store-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("date shifting keeps the demo relative to today", () => {
  it("shifts timestamps and dates by whole days", () => {
    expect(shiftValue("2026-01-30T10:15:00.000Z", 3)).toBe("2026-02-02T10:15:00.000Z");
    expect(shiftValue("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftValue("not a date", 5)).toBe("not a date");
    expect(daysBetween("2026-10-19T23:00:00Z", "2026-10-21T01:00:00Z")).toBe(2);
  });

  it("preserves relative timing between records", () => {
    const seed = generateSeed(new Date("2026-10-19T12:00:00Z"));
    const shifted = shiftDataset(seed, 10);
    const task = seed.tasks[0]!;
    const moved = shifted.tasks[0]!;
    expect(Date.parse(moved.created_at) - Date.parse(task.created_at)).toBe(10 * 86_400_000);
    expect(moved.title).toBe(task.title);
    expect(shifted.orders[0]!.order_number).toBe(seed.orders[0]!.order_number);
  });

  it("re-anchors only when a day has passed", () => {
    const store = createSeededStore(new Date("2026-10-19T08:00:00Z"));
    expect(reanchor(store, new Date("2026-10-19T22:00:00Z"))).toBe(false);
    const before = store.data.deals[0]!.created_at;
    expect(reanchor(store, new Date("2026-10-22T09:00:00Z"))).toBe(true);
    expect(Date.parse(store.data.deals[0]!.created_at) - Date.parse(before)).toBe(3 * 86_400_000);
  });
});

describe("DemoStore", () => {
  it("seeds a missing file, persists mutations and resets", async () => {
    const path = join(dir, "demo.json");
    const store = new DemoStore(path);
    const data = await store.read();
    expect(data.companies).toHaveLength(25);

    await store.mutate((d) => {
      d.companies[0]!.name = "Renamed Co";
    });
    expect((await store.read()).companies[0]!.name).toBe("Renamed Co");
    expect(JSON.parse(readFileSync(path, "utf8")).data.companies[0].name).toBe("Renamed Co");

    // A fresh instance (e.g. after a server restart) reads the persisted state.
    expect((await new DemoStore(path).read()).companies[0]!.name).toBe("Renamed Co");

    await store.reset();
    expect((await store.read()).companies[0]!.name).not.toBe("Renamed Co");
  });

  it("does not persist a mutation that throws", async () => {
    const path = join(dir, "demo-throw.json");
    const store = new DemoStore(path);
    const original = (await store.read()).companies[0]!.name;
    await expect(
      store.mutate((d) => {
        d.companies[0]!.name = "Half-done";
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect((await store.read()).companies[0]!.name).toBe(original);
  });

  it("serializes concurrent mutations", async () => {
    const path = join(dir, "demo-concurrent.json");
    const store = new DemoStore(path);
    await store.read();
    await Promise.all(
      Array.from({ length: 20 }, () =>
        store.mutate((d) => {
          d.notifications.push({ ...d.notifications[0]!, id: crypto.randomUUID(), dedupe_key: null });
        }),
      ),
    );
    const seeded = generateSeed().notifications.length;
    expect((await store.read()).notifications).toHaveLength(seeded + 20);
  });

  it("picks up a file replaced by another process", async () => {
    const path = join(dir, "demo-external.json");
    const store = new DemoStore(path);
    await store.read();
    const external = createSeededStore();
    external.data.companies[0]!.name = "Changed outside";
    await new Promise((r) => setTimeout(r, 20));
    await writeStoreFile(path, external);
    expect((await store.read()).companies[0]!.name).toBe("Changed outside");
  });
});
