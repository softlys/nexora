"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { emailSender } from "@/server/automation/runtime";
import { getServiceDb } from "@/server/db";
import { WEBHOOK_PROVIDERS, type WebhookDeps } from "@/server/integrations/webhooks";
import { apiKeyInput, createApiKey, revokeApiKey, revokeInput } from "@/server/services/api-keys";
import type { ServiceContext } from "@/server/services/context";
import { disconnectIntegration, integrationInput, redeliverDelivery, rotateSecret, saveIntegration, testEmail, testIntegration } from "@/server/services/integrations";
import { serviceAction } from "@/server/service-action";

const providerInput = z.object({ provider: z.enum(WEBHOOK_PROVIDERS) }).strict();

function refresh(provider?: string) {
  revalidatePath("/integrations");
  if (provider) revalidatePath(`/integrations/${provider === "generic_webhook" ? "webhooks" : provider}`);
}

/** Deliveries are written by the server principal (they also happen without a user session). */
function webhookDeps(ctx: ServiceContext): WebhookDeps {
  return { db: getServiceDb(), meta: ctx.meta };
}

export async function saveIntegrationAction(input: unknown) {
  return serviceAction({ name: "saveIntegration", schema: integrationInput }, input, async (ctx, data) => {
    const result = await saveIntegration(ctx, data);
    refresh(data.provider);
    return result;
  });
}

export async function rotateSecretAction(input: unknown) {
  return serviceAction({ name: "rotateIntegrationSecret", schema: providerInput }, input, async (ctx, data) => {
    const secret = await rotateSecret(ctx, data.provider);
    refresh(data.provider);
    return { secret };
  });
}

export async function disconnectIntegrationAction(input: unknown) {
  return serviceAction({ name: "disconnectIntegration", schema: providerInput }, input, async (ctx, data) => {
    await disconnectIntegration(ctx, data.provider);
    refresh(data.provider);
    return undefined;
  });
}

export async function sendTestEventAction(input: unknown) {
  return serviceAction({ name: "sendTestEvent", schema: providerInput }, input, async (ctx, data) => {
    const d = await testIntegration(ctx, webhookDeps(ctx), data.provider);
    refresh(data.provider);
    return { status: d.status, status_code: d.status_code, error: d.error, duration_ms: d.duration_ms };
  });
}

export async function redeliverAction(input: unknown) {
  return serviceAction({ name: "redeliverWebhook", schema: z.object({ delivery_id: z.uuid() }).strict() }, input, async (ctx, data) => {
    const d = await redeliverDelivery(ctx, webhookDeps(ctx), data.delivery_id);
    refresh();
    revalidatePath("/integrations", "layout");
    return { status: d.status, status_code: d.status_code, error: d.error };
  });
}

export async function testEmailAction(input: unknown) {
  return serviceAction({ name: "testEmail", schema: z.object({ to: z.email().max(254) }).strict() }, input, async (ctx, data) => {
    const sender = emailSender();
    const result = await testEmail(ctx, (m) => sender.send(m), data.to);
    refresh();
    return result;
  });
}

export async function createApiKeyAction(input: unknown) {
  return serviceAction({ name: "createApiKey", schema: apiKeyInput, bucket: "create" }, input, async (ctx, data) => {
    const result = await createApiKey(ctx, data);
    revalidatePath("/settings/api-keys");
    return result;
  });
}

export async function revokeApiKeyAction(input: unknown) {
  return serviceAction({ name: "revokeApiKey", schema: revokeInput }, input, async (ctx, data) => {
    await revokeApiKey(ctx, data);
    revalidatePath("/settings/api-keys");
    return undefined;
  });
}
