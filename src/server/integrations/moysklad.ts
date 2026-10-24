import "server-only";
import type { Product } from "@/domain/entities";
import { newId, type ServiceContext } from "@/server/services/context";

/**
 * MoySklad (МойСклад) → NEXORA products: names, SKUs and sale prices, so order lines use the same
 * catalogue as the warehouse. MoySklad itself exchanges data with 1C, which covers 1C users too.
 * Token: MoySklad → Settings → Users → Access tokens (MOYSKLAD_TOKEN). Read-only on the MoySklad side.
 */
const API = "https://api.moysklad.ru/api/remap/1.2";

export const moyskladConfigured = (env: NodeJS.ProcessEnv = process.env) => Boolean(env.MOYSKLAD_TOKEN?.trim());

type MsProduct = { id: string; name: string; code?: string; article?: string; description?: string; archived?: boolean; pathName?: string; salePrices?: Array<{ value: number; currency?: { meta?: { href?: string } } }>; vat?: number; vatEnabled?: boolean };

/** NEXORA SKUs are A–Z, 0–9 and "-", 3–32 characters. */
export function skuFor(p: Pick<MsProduct, "id" | "article" | "code">): string {
  const raw = (p.article || p.code || "").toUpperCase().replace(/[^A-Z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return raw.length >= 3 ? raw.slice(0, 32) : `MS-${p.id.replace(/-/g, "").slice(0, 12).toUpperCase()}`;
}

export async function fetchMoyskladProducts(fetchImpl: typeof fetch = fetch, env: NodeJS.ProcessEnv = process.env): Promise<MsProduct[]> {
  const token = env.MOYSKLAD_TOKEN?.trim();
  if (!token) throw new Error("MOYSKLAD_TOKEN is not set.");
  const out: MsProduct[] = [];
  for (let offset = 0; offset < 10_000; offset += 1000) {
    const r = await fetchImpl(`${API}/entity/product?limit=1000&offset=${offset}`, { headers: { Authorization: `Bearer ${token}`, "Accept-Encoding": "gzip" }, signal: AbortSignal.timeout(30_000) });
    const body = (await r.json().catch(() => ({}))) as { rows?: MsProduct[]; errors?: Array<{ error: string }> };
    if (!r.ok || !body.rows) throw new Error(`MoySklad: ${body.errors?.[0]?.error ?? `HTTP ${r.status}`}`);
    out.push(...body.rows);
    if (body.rows.length < 1000) break;
  }
  return out;
}

/** Creates or updates products by SKU. Prices in MoySklad are in kopecks (hundredths). */
export async function syncProducts(ctx: ServiceContext, rows: MsProduct[], currency: string): Promise<{ created: number; updated: number }> {
  return ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const existing = new Map((await tx.find("products")).map((p) => [p.sku, p]));
    let created = 0;
    let updated = 0;
    const at = new Date().toISOString();
    for (const m of rows) {
      const sku = skuFor(m);
      const fields = {
        name: m.name.slice(0, 160) || sku,
        category: (m.pathName?.split("/").pop() || "MoySklad").slice(0, 80),
        description: (m.description ?? "").slice(0, 1000),
        unit_price: Math.round(m.salePrices?.[0]?.value ?? 0) / 100,
        tax_rate: m.vatEnabled ? Math.min(100, Math.max(0, m.vat ?? 0)) : 0,
        is_active: !m.archived,
      };
      const current = existing.get(sku);
      if (current) {
        if (current.name !== fields.name || current.unit_price !== fields.unit_price || current.is_active !== fields.is_active || current.tax_rate !== fields.tax_rate || current.category !== fields.category) {
          await tx.update("products", current.id, { ...fields, updated_at: at });
          updated++;
        }
        continue;
      }
      const product: Product = { id: newId(), organization_id: ctx.actor.organization_id, sku, ...fields, currency, created_at: at, updated_at: at, archived_at: null };
      await tx.insert("products", product);
      existing.set(sku, product);
      created++;
    }
    return { created, updated };
  });
}
