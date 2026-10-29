import { createHash, timingSafeEqual } from "node:crypto";
import { runScheduler } from "@/server/automation/scheduler";
import { engineDeps } from "@/server/automation/runtime";
import { getRequestMeta } from "@/server/auth";
import { listOrganizationIds } from "@/server/db";
import { runIntegrationJobs } from "@/server/integrations/jobs";
import { createReminderNotifications, personalBotConfig, pushNotificationsToTelegram, telegramChatSender } from "@/server/integrations/personal-telegram";
import { publicBaseUrl } from "@/server/integrations/public-url";
import { recordSystemSecurity } from "@/server/security/record";

/**
 * Scheduler endpoint for an external cron (Vercel Cron, GitHub Actions, crontab + curl).
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/scheduler
 * Vercel Cron sends a GET with the same header, so both methods are accepted.
 * The secret is compared in constant time; requests without it are rejected and logged as
 * cron.unauthorized. Without CRON_SECRET configured the endpoint stays disabled.
 */
function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function authorized(request: Request, secret: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  // Compare fixed-length digests so neither length nor content leaks through timing.
  return given.length > 0 && timingSafeEqual(digest(given), digest(secret));
}

async function handle(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) {
    return Response.json({ ok: false, error: "The scheduler endpoint is disabled: set CRON_SECRET (16+ characters)." }, { status: 503 });
  }
  const orgIds = await listOrganizationIds();
  if (!authorized(request, secret)) {
    const meta = await getRequestMeta();
    await recordSystemSecurity(orgIds, "anonymous", {
      type: "cron.unauthorized",
      payload: { target: { type: "endpoint", id: "/api/cron/scheduler" }, method: request.method, ip: meta.ip },
    });
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const meta = await getRequestMeta();
  const deps = engineDeps(meta);
  const results = [];
  const bot = personalBotConfig();
  for (const orgId of orgIds) {
    const run = await runScheduler(deps, orgId);
    // New-lead and overdue-task reminders, then every unsent notification to linked Telegram chats.
    const reminders = await createReminderNotifications(deps.db, orgId, new Date());
    const telegram = bot.token ? await pushNotificationsToTelegram(deps.db, orgId, telegramChatSender(bot.token), publicBaseUrl(request)) : null;
    results.push({ organization_id: orgId, ...run, reminders, telegram });
  }
  // Mailbox sync and other connector jobs (each isolated; failures are reported, not thrown).
  const integrations = await runIntegrationJobs(meta);
  return Response.json({ ok: true, ran_at: new Date().toISOString(), results, integrations });
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}
