import "server-only";
import { finishInbound, inboundContext, inboundMeta } from "../inbound";
import { fetchYookassaPayment, fromMinor, paymentsConfig, recordOnlinePayment, stripeSignatureValid } from "../payments";
import { HookError, json, text, type HookHandler } from "./common";

/**
 * YooKassa: HTTP notifications URL https://<host>/api/hooks/yookassa, event payment.succeeded. The body
 * is not trusted: the payment is read back from the YooKassa API with the shop's credentials.
 */
export const yookassaHook: HookHandler = {
  async POST({ request, rawBody }) {
    if (!paymentsConfig().yookassa) throw new HookError(503, "YooKassa is not configured");
    const note = JSON.parse(rawBody) as { event?: string; object?: { id?: string } };
    if (note.event !== "payment.succeeded" || !note.object?.id) return text("ok");
    const payment = await fetchYookassaPayment(note.object.id);
    if (!payment || payment.status !== "succeeded" || !payment.paid || !payment.orderId) return text("ok");
    const ctx = await inboundContext(inboundMeta(request));
    await recordOnlinePayment(ctx, { provider: "yookassa", externalId: payment.id, orderId: payment.orderId, amount: payment.amount, currency: payment.currency });
    await finishInbound(ctx);
    return text("ok");
  },
};

/** Stripe: webhook endpoint https://<host>/api/hooks/stripe, event checkout.session.completed, signing secret STRIPE_WEBHOOK_SECRET. */
export const stripeHook: HookHandler = {
  async POST({ request, rawBody }) {
    const config = paymentsConfig().stripe;
    if (!config?.webhookSecret) throw new HookError(503, "Stripe webhooks are not configured");
    if (!stripeSignatureValid(config.webhookSecret, rawBody, request.headers.get("stripe-signature"))) throw new HookError(400, "Bad signature");
    const event = JSON.parse(rawBody) as { type?: string; data?: { object?: { id?: string; payment_status?: string; amount_total?: number; currency?: string; metadata?: { order_id?: string } } } };
    const session = event.data?.object;
    if (event.type !== "checkout.session.completed" || session?.payment_status !== "paid" || !session.id || !session.metadata?.order_id) return json({ received: true });
    const ctx = await inboundContext(inboundMeta(request));
    const currency = (session.currency ?? "").toUpperCase();
    await recordOnlinePayment(ctx, { provider: "stripe", externalId: session.id, orderId: session.metadata.order_id, amount: fromMinor(session.amount_total ?? 0, currency), currency });
    await finishInbound(ctx);
    return json({ received: true });
  },
};
