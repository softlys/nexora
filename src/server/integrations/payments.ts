import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Payment } from "@/domain/entities";
import { derivePaymentStatus } from "@/domain/orders/payment-status";
import { DomainError } from "@/server/repositories/types";
import { emit, newId, nowOf, type ServiceContext } from "@/server/services/context";
import { claimExternal, linkExternal } from "./inbound";

/**
 * Online payments for orders: YooKassa (ЮKassa, Russia) and Stripe. NEXORA creates a payment link for
 * the outstanding amount; when the provider confirms the payment (webhook), a real payment
 * (is_simulated = false) is recorded on the order once, whatever the number of notifications.
 */
export type PaymentProvider = "yookassa" | "stripe";
/** Where a recorded payment came from: an online provider or the 1C exchange. */
export type PaymentSource = PaymentProvider | "1c";

export function paymentsConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    yookassa: env.YOOKASSA_SHOP_ID?.trim() && env.YOOKASSA_SECRET_KEY?.trim() ? { shopId: env.YOOKASSA_SHOP_ID.trim(), secret: env.YOOKASSA_SECRET_KEY.trim() } : null,
    stripe: env.STRIPE_SECRET_KEY?.trim() ? { secret: env.STRIPE_SECRET_KEY.trim(), webhookSecret: env.STRIPE_WEBHOOK_SECRET?.trim() || null } : null,
  };
}

const ZERO_DECIMAL = new Set(["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]);
export const minorUnits = (amount: number, currency: string) => Math.round(amount * (ZERO_DECIMAL.has(currency.toUpperCase()) ? 1 : 100));
export const fromMinor = (value: number, currency: string) => value / (ZERO_DECIMAL.has(currency.toUpperCase()) ? 1 : 100);

type LinkInput = { orderId: string; orderNumber: string; amount: number; currency: string; returnUrl: string; organizationId: string };

export async function createPaymentLink(provider: PaymentProvider, input: LinkInput, fetchImpl: typeof fetch = fetch): Promise<{ url: string; id: string }> {
  const config = paymentsConfig();
  if (provider === "yookassa") {
    if (!config.yookassa) throw new DomainError("YooKassa is not configured (YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY).");
    const response = await fetchImpl("https://api.yookassa.ru/v3/payments", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.yookassa.shopId}:${config.yookassa.secret}`).toString("base64")}`,
        "Idempotence-Key": randomUUID(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: { value: input.amount.toFixed(2), currency: input.currency },
        capture: true,
        confirmation: { type: "redirect", return_url: input.returnUrl },
        description: `Order ${input.orderNumber}`.slice(0, 128),
        metadata: { order_id: input.orderId, organization_id: input.organizationId },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json().catch(() => ({}))) as { id?: string; confirmation?: { confirmation_url?: string }; description?: string };
    if (!response.ok || !body.id || !body.confirmation?.confirmation_url) throw new DomainError(`YooKassa refused the payment: ${body.description ?? `HTTP ${response.status}`}`);
    return { url: body.confirmation.confirmation_url, id: body.id };
  }
  if (!config.stripe) throw new DomainError("Stripe is not configured (STRIPE_SECRET_KEY).");
  const form = new URLSearchParams({
    mode: "payment",
    success_url: input.returnUrl,
    cancel_url: input.returnUrl,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": input.currency.toLowerCase(),
    "line_items[0][price_data][unit_amount]": String(minorUnits(input.amount, input.currency)),
    "line_items[0][price_data][product_data][name]": `Order ${input.orderNumber}`,
    "metadata[order_id]": input.orderId,
    "metadata[organization_id]": input.organizationId,
  });
  const response = await fetchImpl("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.stripe.secret}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": randomUUID() },
    body: form,
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json().catch(() => ({}))) as { id?: string; url?: string; error?: { message?: string } };
  if (!response.ok || !body.url || !body.id) throw new DomainError(`Stripe refused the payment: ${body.error?.message ?? `HTTP ${response.status}`}`);
  return { url: body.url, id: body.id };
}

/** Stripe-Signature: t=<unix>,v1=<hex hmac of "t.body">; 5-minute tolerance against replays. */
export function stripeSignatureValid(secret: string, rawBody: string, header: string | null, now = Date.now()): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > 300) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex"));
  return header
    .split(",")
    .filter((p) => p.startsWith("v1="))
    .some((p) => {
      const given = Buffer.from(p.slice(3));
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
}

/** YooKassa notifications are confirmed by reading the payment back from the API with our credentials. */
export async function fetchYookassaPayment(id: string, fetchImpl: typeof fetch = fetch): Promise<{ id: string; status: string; paid: boolean; amount: number; currency: string; orderId: string | null } | null> {
  const config = paymentsConfig().yookassa;
  if (!config || !/^[A-Za-z0-9-]{10,64}$/.test(id)) return null;
  const response = await fetchImpl(`https://api.yookassa.ru/v3/payments/${id}`, {
    headers: { Authorization: `Basic ${Buffer.from(`${config.shopId}:${config.secret}`).toString("base64")}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { id: string; status: string; paid: boolean; amount: { value: string; currency: string }; metadata?: { order_id?: string } };
  return { id: body.id, status: body.status, paid: body.paid, amount: Number(body.amount.value), currency: body.amount.currency, orderId: body.metadata?.order_id ?? null };
}

/** Records a confirmed online payment once. Returns false when it was already recorded or the order is gone. */
export async function recordOnlinePayment(ctx: ServiceContext, input: { provider: PaymentSource; externalId: string; orderId: string; amount: number; currency: string }): Promise<boolean> {
  return ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const order = await tx.get("orders", input.orderId);
    if (!order) return false;
    const claim = await claimExternal(tx, ctx, input.provider, input.externalId, { order_id: order.id, amount: input.amount, currency: input.currency });
    if (!claim) return false;
    if (input.currency.toUpperCase() !== order.currency) throw new Error(`Payment currency ${input.currency} does not match the order (${order.currency}).`);
    const payments = await tx.find("payments", { order_id: order.id });
    const collected = payments.reduce((s, p) => s + p.amount, 0);
    const at = nowOf(ctx).toISOString();
    const payment: Payment = {
      id: newId(),
      organization_id: order.organization_id,
      order_id: order.id,
      amount: Math.round(input.amount * 100) / 100,
      currency: order.currency,
      paid_at: at,
      method: input.provider === "1c" ? "bank_transfer" : "card",
      reference: `${input.provider === "yookassa" ? "YooKassa" : input.provider === "stripe" ? "Stripe" : "1C"} ${input.externalId}`.slice(0, 120),
      is_simulated: false,
      recorded_by: null,
      created_at: at,
      updated_at: at,
    };
    await tx.insert("payments", payment);
    await tx.update("orders", order.id, {
      payment_status: derivePaymentStatus({ total: order.total, collected: collected + payment.amount, status: order.status, payment_due_date: order.payment_due_date, today: at.slice(0, 10) }),
      updated_at: at,
    });
    await emit(tx, ctx, { type: "record.created", payload: { entity: "payment", id: payment.id, after: payment } });
    await linkExternal(tx, claim.id, "payment", payment.id);
    return true;
  });
}
