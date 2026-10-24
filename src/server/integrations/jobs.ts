import "server-only";
import type { RequestMeta } from "@/server/repositories/types";
import type { ServiceContext } from "@/server/services/context";
import { finishInbound, inboundContext, readCursor, writeCursor } from "./inbound";
import { mailConfig, syncMailbox } from "./mail";
import { fetchMoyskladProducts, moyskladConfigured, syncProducts } from "./moysklad";
import { vaultFiles } from "./obsidian";
import { publicBaseUrl } from "./public-url";
import { syncVaultToDisk, yandexConfig } from "./yandex";

/**
 * Integration work run by the scheduler (every 5 minutes): mailbox sync and the periodic jobs added by
 * other connectors. Each job is isolated: a failing provider is reported and the others still run.
 */
export type JobResult = { job: string; ok: boolean; detail: string };

type Job = { name: string; everyMinutes: number; enabled: () => boolean; run: (ctx: ServiceContext, now: Date) => Promise<string> };

export const JOBS: Job[] = [
  {
    name: "mail",
    everyMinutes: 5,
    enabled: () => Boolean(mailConfig().config),
    async run(ctx, now) {
      const r = await syncMailbox(ctx, mailConfig().config!, now);
      return `${r.read} read, ${r.recorded} recorded`;
    },
  },
  {
    name: "yandex_disk",
    everyMinutes: 60,
    enabled: () => Boolean(yandexConfig().diskToken),
    async run(ctx, now) {
      const r = await syncVaultToDisk(ctx, await vaultFiles(ctx, publicBaseUrl(), now));
      return `${r.uploaded} notes uploaded, ${r.unchanged} unchanged`;
    },
  },
  {
    name: "moysklad",
    everyMinutes: 60,
    enabled: () => moyskladConfigured(),
    async run(ctx) {
      const org = await ctx.db.read(ctx.actor.organization_id, (tx) => tx.get("organizations", ctx.actor.organization_id));
      const r = await syncProducts(ctx, await fetchMoyskladProducts(), org?.currency ?? "RUB");
      return `${r.created} products created, ${r.updated} updated`;
    },
  },
];

export async function runIntegrationJobs(meta: RequestMeta, now = new Date()): Promise<JobResult[]> {
  const active = JOBS.filter((j) => j.enabled());
  if (active.length === 0) return [];
  let ctx: ServiceContext;
  try {
    ctx = await inboundContext(meta);
  } catch (error) {
    return [{ job: "integrations", ok: false, detail: error instanceof Error ? error.message : String(error) }];
  }
  const results: JobResult[] = [];
  for (const job of active) {
    try {
      const last = await ctx.db.read(ctx.actor.organization_id, (tx) => readCursor(tx, "job", job.name));
      if (last?.ran_at && now.getTime() - Date.parse(String(last.ran_at)) < job.everyMinutes * 60_000 - 30_000) continue;
      const detail = await job.run(ctx, now);
      await ctx.db.write(ctx.actor.organization_id, (tx) => writeCursor(tx, ctx, "job", job.name, { ran_at: now.toISOString(), ok: true, detail }));
      results.push({ job: job.name, ok: true, detail });
    } catch (error) {
      const detail = error instanceof Error ? error.message.slice(0, 300) : String(error);
      console.error(`[integrations] ${job.name} failed`, error);
      await ctx.db.write(ctx.actor.organization_id, (tx) => writeCursor(tx, ctx, "job", job.name, { ran_at: now.toISOString(), ok: false, detail })).catch(() => undefined);
      results.push({ job: job.name, ok: false, detail });
    }
  }
  await finishInbound(ctx);
  return results;
}

/** Last run of each job, for the integrations page. */
export async function jobStatus(ctx: ServiceContext): Promise<Record<string, { ran_at: string; ok: boolean; detail: string }>> {
  return ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const rows = await tx.find("integration_records", { source: "cursor:job" });
    return Object.fromEntries(rows.map((r) => [r.external_id, r.data as { ran_at: string; ok: boolean; detail: string }]));
  });
}
