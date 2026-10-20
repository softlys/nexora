import "server-only";
import { getServiceDb } from "@/server/db";
import type { RequestMeta } from "@/server/repositories/types";
import type { ServiceContext } from "@/server/services/context";
import { handleEvent, type EmailSender, type EngineDeps, type WebhookSender } from "./engine";

/**
 * Email through Resend when RESEND_API_KEY and NEXORA_EMAIL_FROM are set. Without them the
 * send_email step is skipped and logged as skipped, never as sent.
 */
function emailSender(): EmailSender {
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

/** Outbound webhooks are implemented by the integrations module in phase 4. */
const webhookSender: WebhookSender = {
  available: false,
  async send() {
    return { delivered: 0 };
  },
};

export function engineDeps(meta: RequestMeta): EngineDeps {
  return { db: getServiceDb(), meta, email: emailSender(), webhooks: webhookSender };
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
