import { getDataMode } from "@/server/env";
import { listOrganizationIds } from "@/server/db";

/**
 * Readiness for load balancers, Docker HEALTHCHECK and uptime monitors: the configuration is
 * valid and the data store answers. Reports no details beyond the release label.
 */
export async function GET() {
  const release = process.env.APP_RELEASE ?? "dev";
  try {
    getDataMode();
    await listOrganizationIds();
    return Response.json({ status: "ok", release, time: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[health] not ready", error instanceof Error ? error.message : error);
    return Response.json({ status: "error", release }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
