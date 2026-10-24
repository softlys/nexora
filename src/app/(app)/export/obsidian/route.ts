import { can } from "@/domain/permissions";
import { publicBaseUrl } from "@/server/integrations/public-url";
import { exportVault } from "@/server/integrations/obsidian";
import { hitRateLimit } from "@/server/security/rate-limit";
import { supabaseCounter } from "@/server/security/shared-counter";
import { getServiceContext } from "@/server/service-action";
import { flushSecurityEvents, trackRead } from "@/server/services/context";

/** Downloads the records the user may see as an Obsidian vault (ZIP of linked Markdown notes). */
export async function GET(request: Request) {
  const ctx = await getServiceContext();
  try {
    if (!can(ctx.actor, "view", "company")) return new Response("Forbidden", { status: 403 });
    const limit = await hitRateLimit(ctx.actor.id, "search", supabaseCounter());
    if (!limit.allowed) return new Response("Too many requests. Please wait a minute.", { status: 429, headers: { "Retry-After": String(limit.rule.windowSeconds) } });
    const { zip, notes } = await exportVault(ctx, publicBaseUrl(request));
    // A vault is a bulk read like any large export.
    await trackRead(ctx, "obsidian_export", notes);
    const date = new Date().toISOString().slice(0, 10);
    return new Response(Buffer.from(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="nexora-obsidian-${date}.zip"`,
        "Cache-Control": "no-store",
      },
    });
  } finally {
    await flushSecurityEvents(ctx);
  }
}
