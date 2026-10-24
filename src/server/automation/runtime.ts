import "server-only";
import { after } from "next/server";
import { getServiceDb } from "@/server/db";
import type { RequestMeta } from "@/server/repositories/types";
import type { ServiceContext } from "@/server/services/context";
import { dispatchDomainEvent, sendWorkflowWebhook, type WebhookDeps } from "@/server/integrations/webhooks";
import { telegramSender } from "@/server/integrations/telegram";
import { handleEvent, type EmailSender, type EngineDeps, type WebhookSender } from "./engine";
import { notionWriter, slackSender, whatsappSender } from "@/server/integrations/messaging";
import { publicBaseUrl } from "@/server/integrations/public-url";

/**
 * Email through Resend when RESEND_API_KEY and NEXORA_EMAIL_FROM are set. Without them the
 * send_email step is skipped and logged as skipped, never as sent.
 */
export function emailSender(): EmailSender {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.NEXORA_EMAIL_FROM;
  return {
    configured: Boolean(key && from),
    async send(message) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: message.to, subject: message.subject, text: message.text }),
        signal: AbortSignal.timeout(4_000),
      });
      if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
      const body = (await response.json()) as { id?: string };
      return { id: body.id ?? "unknown" };
    },
  };
}

function webhookSender(deps: WebhookDeps): WebhookSender {
  return {
    available: true,
    async send(input) {
      const result = await sendWorkflowWebhook(deps, input);
      return { delivered: result.delivered, attempted: result.attempted };
    },
  };
}

/**
 * Runs work after the response is sent (Next.js `after`). Outside a request (tests, scripts)
 * `after` throws, and the work runs right away instead.
 */
export function runAfterResponse(work: () => Promise<unknown>, label: string): void {
  const guarded = () =>
    work().catch((error) => {
      console.error(`[after] ${label} failed`, error);
    });
  try {
    after(guarded);
  } catch {
    void guarded();
  }
}

export function engineDeps(meta: RequestMeta): EngineDeps {
  const db = getServiceDb();
  const webhookDeps: WebhookDeps = { db, meta };
  return {
    db,
    meta,
    email: emailSender(),
    telegram: telegramSender(),
    whatsapp: whatsappSender(),
    slack: slackSender(),
    notion: notionWriter(),
    baseUrl: publicBaseUrl(),
    webhooks: webhookSender(webhookDeps),
    // Outbound webhooks for every handled event, including events caused by workflow runs.
    // Sent after the response so a slow receiver never delays the user's action.
    onEvent: async (event) => {
      runAfterResponse(() => dispatchDomainEvent(webhookDeps, event), `webhooks for ${event.type}`);
    },
  };
}

/**
 * Runs automations for events a user action produced, after that action committed.
 * Automation failures are recorded in their runs and never fail the user's action.
 */
export async function dispatchAutomations(ctx: ServiceContext): Promise<void> {
  const events = ctx.pendingEvents?.splice(0) ?? [];
  if (events.length === 0) return;
  const deps = engineDeps(ctx.meta);
  for (const event of events) {
    try {
      await handleEvent(deps, event);
    } catch (error) {
      console.error(`[automation] dispatch failed for ${event.type} request_id=${ctx.meta.request_id}`, error);
    }
  }
}
