import { calendarFor, resolveFeedToken } from "@/server/integrations/calendar";
import { publicBaseUrl } from "@/server/integrations/public-url";
import { hitRateLimit } from "@/server/security/rate-limit";
import { supabaseCounter } from "@/server/security/shared-counter";

/** Personal iCalendar feed: GET /api/calendar/<token>.ics (subscribed to by Google, Outlook, Yandex, Apple). */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const owner = await resolveFeedToken(token.replace(/\.ics$/, ""));
  if (!owner) return new Response("Not found", { status: 404 });
  const limit = await hitRateLimit(`calendar:${owner.userId}`, "api", supabaseCounter());
  if (!limit.allowed) return new Response("Too many requests", { status: 429, headers: { "Retry-After": String(limit.rule.windowSeconds) } });
  const body = await calendarFor(owner.orgId, owner.userId, publicBaseUrl(request));
  return new Response(body, {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'inline; filename="nexora.ics"', "Cache-Control": "private, max-age=300" },
  });
}
