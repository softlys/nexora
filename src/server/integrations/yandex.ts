import "server-only";
import { createHash } from "node:crypto";
import type { ZipEntry } from "@/lib/zip";
import type { ServiceContext } from "@/server/services/context";
import { readCursor, writeCursor } from "./inbound";

/**
 * Yandex 360 services with an OAuth token (oauth.yandex.ru → create an app with the needed scopes):
 * - Yandex Disk (YANDEX_DISK_TOKEN, scopes cloud_api:disk.write/read): the Obsidian notes are kept in
 *   a Disk folder; with the Yandex Disk app on your computer that folder is a live Obsidian vault.
 * - Telemost (YANDEX_TELEMOST_TOKEN, scope telemost-api:conferences.create, Yandex 360 for business):
 *   video meeting links for deals.
 */
const API = "https://cloud-api.yandex.net/v1";
const auth = (token: string) => ({ Authorization: `OAuth ${token}` });

export function yandexConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    diskToken: env.YANDEX_DISK_TOKEN?.trim() || null,
    diskFolder: (env.YANDEX_DISK_FOLDER?.trim() || "NEXORA").replace(/^\/+|\/+$/g, ""),
    telemostToken: env.YANDEX_TELEMOST_TOKEN?.trim() || env.YANDEX_DISK_TOKEN?.trim() || null,
    telemostConfigured: Boolean(env.YANDEX_TELEMOST_TOKEN?.trim()),
  };
}

async function ensureFolder(token: string, path: string, fetchImpl: typeof fetch, known: Set<string>): Promise<void> {
  const parts = path.split("/").filter(Boolean);
  for (let i = 1; i <= parts.length; i++) {
    const p = parts.slice(0, i).join("/");
    if (known.has(p)) continue;
    const r = await fetchImpl(`${API}/disk/resources?path=${encodeURIComponent(`disk:/${p}`)}`, { method: "PUT", headers: auth(token), signal: AbortSignal.timeout(15_000) });
    if (!r.ok && r.status !== 409) throw new Error(`Yandex Disk: cannot create folder ${p} (HTTP ${r.status})`);
    known.add(p);
  }
}

export async function uploadToDisk(token: string, path: string, content: string | Uint8Array, fetchImpl: typeof fetch = fetch): Promise<void> {
  const r = await fetchImpl(`${API}/disk/resources/upload?path=${encodeURIComponent(`disk:/${path}`)}&overwrite=true`, { headers: auth(token), signal: AbortSignal.timeout(15_000) });
  const body = (await r.json().catch(() => ({}))) as { href?: string; message?: string };
  if (!r.ok || !body.href) throw new Error(`Yandex Disk: ${body.message ?? `HTTP ${r.status}`}`);
  const data = typeof content === "string" ? new TextEncoder().encode(content) : content;
  const put = await fetchImpl(body.href, { method: "PUT", body: Buffer.from(data), signal: AbortSignal.timeout(60_000) });
  if (!put.ok) throw new Error(`Yandex Disk upload failed: HTTP ${put.status}`);
}

/**
 * Mirrors the vault notes into <folder>/Obsidian on Yandex Disk, uploading only notes whose content
 * changed since the last run (hashes are kept in the sync cursor).
 */
export async function syncVaultToDisk(ctx: ServiceContext, files: ZipEntry[], fetchImpl: typeof fetch = fetch): Promise<{ uploaded: number; unchanged: number }> {
  const { diskToken, diskFolder } = yandexConfig();
  if (!diskToken) throw new Error("YANDEX_DISK_TOKEN is not set.");
  const cursor = (await ctx.db.read(ctx.actor.organization_id, (tx) => readCursor(tx, "yandex_disk", "obsidian"))) ?? {};
  const previous = (cursor.hashes ?? {}) as Record<string, string>;
  const hashes: Record<string, string> = {};
  const folders = new Set<string>();
  let uploaded = 0;
  for (const f of files) {
    const hash = createHash("sha1").update(f.content).digest("hex");
    hashes[f.path] = hash;
    if (previous[f.path] === hash) continue;
    const path = `${diskFolder}/Obsidian/${f.path}`;
    await ensureFolder(diskToken, path.split("/").slice(0, -1).join("/"), fetchImpl, folders);
    await uploadToDisk(diskToken, path, f.content, fetchImpl);
    uploaded++;
  }
  await ctx.db.write(ctx.actor.organization_id, (tx) => writeCursor(tx, ctx, "yandex_disk", "obsidian", { hashes, synced_at: new Date().toISOString() }));
  return { uploaded, unchanged: files.length - uploaded };
}

/** A Telemost video meeting anyone with the link can join. */
export async function createTelemostMeeting(fetchImpl: typeof fetch = fetch): Promise<{ id: string; joinUrl: string }> {
  const { telemostToken } = yandexConfig();
  if (!telemostToken) throw new Error("Telemost is not configured (YANDEX_TELEMOST_TOKEN).");
  const r = await fetchImpl(`${API}/telemost-api/conferences`, {
    method: "POST",
    headers: { ...auth(telemostToken), "Content-Type": "application/json" },
    body: JSON.stringify({ access_level: "PUBLIC" }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await r.json().catch(() => ({}))) as { id?: string; join_url?: string; message?: string; description?: string };
  if (!r.ok || !body.join_url) throw new Error(`Telemost: ${body.message ?? body.description ?? `HTTP ${r.status}`}`);
  return { id: body.id ?? "", joinUrl: body.join_url };
}
