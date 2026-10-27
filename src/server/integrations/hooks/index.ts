import "server-only";
import { InboundConfigError } from "../inbound";
import { HookError, readHookBody, text, type HookHandler } from "./common";
import { formsHook } from "./forms";
import { mangoHook, twilioHook, zadarmaHook } from "./telephony";
import { whatsappHook } from "./whatsapp";
import { telegramHook, vkHook } from "./chats";
import { stripeHook, yookassaHook } from "./payments";

/** Inbound webhooks by provider: /api/hooks/<provider>/… */
export const HOOKS: Record<string, HookHandler> = {
  forms: formsHook,
  mango: mangoHook,
  zadarma: zadarmaHook,
  twilio: twilioHook,
  whatsapp: whatsappHook,
  telegram: telegramHook,
  vk: vkHook,
  yookassa: yookassaHook,
  stripe: stripeHook,
};

export async function handleHook(method: "GET" | "POST", request: Request, provider: string, rest: string[]): Promise<Response> {
  const hook = HOOKS[provider];
  const handler = hook?.[method];
  if (!handler) return text("Not found", 404);
  try {
    const rawBody = method === "POST" ? await readHookBody(request) : "";
    return await handler({ request, rest, rawBody });
  } catch (error) {
    if (error instanceof HookError) return text(error.message, error.status);
    if (error instanceof InboundConfigError) {
      console.error(`[hooks] ${provider}: ${error.message}`);
      return text("NEXORA is not configured to receive this integration.", 503);
    }
    const ref = crypto.randomUUID().slice(0, 8);
    console.error(`[hooks] ${provider} failed ref=${ref}`, error);
    // A 5xx makes the service retry later; de-duplication makes the retry safe.
    return text(`Error, reference ${ref}`, 500);
  }
}
