/**
 * Demo-mode persistence: the whole dataset lives server-side in a JSON file
 * (.data/demo.json by default, git-ignored). Never in browser storage.
 *
 * This module has no Next.js imports so the demo:seed / demo:reset scripts can use it.
 * Writes are serialized through a promise queue and written atomically (temp file + rename).
 */
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Dataset } from "../../domain/entities";
import { defaultEmailTemplates, DEMO_ORG_ID, DEMO_PIPELINE_IDS, generateSeed, SEED_NUMBER, seedMessengers } from "../../domain/seed/generate";
import { capPastTimestamps, daysBetween, shiftDataset } from "../../domain/seed/shift";
import { seedConversations } from "../../domain/seed/conversations";
import { seedTargets } from "../../domain/seed/targets";
import { seedSpend, seedUtm } from "../../domain/seed/utm";

/** Bump when the dataset shape changes; older files are replaced by a fresh seed. */
export const STORE_VERSION = 3;

export type StoreFile = {
  version: number;
  seed_number: number;
  /** Day the dataset dates are currently relative to. */
  anchored_at: string;
  data: Dataset;
};

export function createSeededStore(now: Date = new Date()): StoreFile {
  return { version: STORE_VERSION, seed_number: SEED_NUMBER, anchored_at: now.toISOString(), data: generateSeed(now) };
}

/** Moves all dates forward if the store was anchored on an earlier day. Returns true when shifted. */
/**
 * Fills fields added after a demo store was created, in place, without resetting the demo
 * (which would also drop API keys created in it). Returns true when something changed.
 */
export function upgradeDataset(data: Dataset, now: Date = new Date()): boolean {
  let changed = capPastTimestamps(data, now) > 0;
  // Stores written before pipelines existed: one default pipeline that owns every stage.
  if (!data.pipelines) {
    const created = data.organizations[0]?.created_at ?? now.toISOString();
    data.pipelines = data.organizations.map((o, i) => ({ id: i === 0 ? DEMO_PIPELINE_IDS.sales : crypto.randomUUID(), organization_id: o.id, name: "Sales", position: 0, created_at: created, updated_at: created, archived_at: null }));
    for (const s of data.pipeline_stages) {
      if (!(s as { pipeline_id?: string }).pipeline_id) s.pipeline_id = data.pipelines.find((p) => p.organization_id === s.organization_id)!.id;
    }
    // The demo organization also gets the empty tenders pipeline that fresh demos have.
    const demo = data.organizations.find((o) => o.id === DEMO_ORG_ID);
    if (demo) {
      const fresh = generateSeed(now);
      data.pipelines.push(...fresh.pipelines.filter((p) => p.id === DEMO_PIPELINE_IDS.tenders));
      data.pipeline_stages.push(...fresh.pipeline_stages.filter((s) => s.pipeline_id === DEMO_PIPELINE_IDS.tenders));
    }
    changed = true;
  }
  if (!data.custom_fields) {
    data.custom_fields = [];
    changed = true;
  }
  if (!data.email_templates) {
    data.email_templates = data.organizations.map((o) => defaultEmailTemplates(o.id, now.toISOString())).flat();
    changed = true;
  }
  if (!data.conversations) {
    const demo = data.organizations.some((o) => o.id === DEMO_ORG_ID);
    const seeded = demo ? seedConversations(DEMO_ORG_ID, data.contacts, data.leads, now) : { conversations: [], chat_messages: [] };
    data.conversations = seeded.conversations;
    data.chat_messages = seeded.chat_messages;
    changed = true;
  }
  if (!data.deal_items) {
    data.deal_items = [];
    changed = true;
  }
  if (!data.sales_targets) {
    data.sales_targets = data.organizations.some((o) => o.id === DEMO_ORG_ID) ? seedTargets(DEMO_ORG_ID, data.profiles, data.deals, data.pipeline_stages, now) : [];
    changed = true;
  }
  if (!data.ad_spend) {
    data.ad_spend = [];
    changed = true;
  }
  // Demo stores written before UTM tags existed get the demo tags and ad spend once.
  const demo = data.organizations.some((o) => o.id === DEMO_ORG_ID);
  if (demo && data.leads.every((l) => l.utm === undefined)) {
    seedUtm(data.leads, data.deals);
    if (data.ad_spend.length === 0) data.ad_spend = seedSpend(DEMO_ORG_ID, now);
    changed = true;
  }
  if (!data.campaigns) {
    data.campaigns = [];
    changed = true;
  }
  // Tables added after a store was written start empty.
  if (!data.integration_records) {
    data.integration_records = [];
    changed = true;
  }
  data.contacts.forEach((c, i) => {
    if ((c as Partial<typeof c>).messengers !== undefined) return;
    const dial = c.phone?.match(/^\+\d{1,3}/)?.[0] ?? "+1";
    c.messengers = seedMessengers(i, c.first_name, c.last_name, dial);
    changed = true;
  });
  return changed;
}

export function reanchor(store: StoreFile, now: Date = new Date()): boolean {
  const days = daysBetween(store.anchored_at, now.toISOString());
  if (days <= 0) return false;
  store.data = shiftDataset(store.data, days, now);
  store.anchored_at = now.toISOString();
  return true;
}

export async function readStoreFile(path: string): Promise<StoreFile | null> {
  try {
    const raw = await readFile(resolve(path), "utf8");
    const parsed = JSON.parse(raw) as StoreFile;
    if (parsed.version !== STORE_VERSION || parsed.seed_number !== SEED_NUMBER) return null;
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function writeStoreFile(path: string, store: StoreFile): Promise<void> {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, JSON.stringify(store), "utf8");
  // Windows refuses a rename while another process has the target open (EPERM/EBUSY): retry briefly.
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(temp, target);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if ((code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") || attempt >= 10) {
        await unlink(temp).catch(() => undefined);
        throw error;
      }
      await new Promise((r) => setTimeout(r, 20 * (attempt + 1)));
    }
  }
}

/**
 * In-process store with a serialized write queue. One instance per data file.
 */
export class DemoStore {
  private store: StoreFile | null = null;
  private lastMtime: number | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly path: string) {}

  private async persist(store: StoreFile): Promise<void> {
    await writeStoreFile(this.path, store);
    this.lastMtime = await stat(resolve(this.path)).then((s) => s.mtimeMs, () => null);
  }

  private async load(): Promise<StoreFile> {
    // Pick up changes made by another process (e.g. `npm run demo:reset` while the server runs).
    const mtime = await stat(resolve(this.path)).then((s) => s.mtimeMs, () => null);
    if (this.store && mtime !== this.lastMtime) this.store = null;

    if (!this.store) {
      const existing = await readStoreFile(this.path);
      if (existing) {
        this.store = existing;
        this.lastMtime = mtime;
        const upgraded = upgradeDataset(this.store.data);
        if (reanchor(this.store) || upgraded) await this.persist(this.store);
      } else {
        this.store = createSeededStore();
        await this.persist(this.store);
      }
    } else if (reanchor(this.store)) {
      await this.persist(this.store);
    }
    return this.store;
  }

  /** Read-only snapshot. Callers must not mutate it; use `mutate` instead. */
  async read(): Promise<Dataset> {
    await this.queue;
    return (await this.load()).data;
  }

  /** Runs `fn` against a copy of the dataset and persists it if `fn` succeeds. Mutations run one at a time. */
  mutate<T>(fn: (data: Dataset) => T | Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const store = await this.load();
      const draft = structuredClone(store.data);
      const result = await fn(draft);
      store.data = draft;
      await this.persist(store);
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  reset(now: Date = new Date()): Promise<void> {
    const run = this.queue.then(async () => {
      this.store = createSeededStore(now);
      await this.persist(this.store);
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
