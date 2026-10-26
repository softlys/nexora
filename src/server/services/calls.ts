import { z } from "zod";
import type { Notification } from "@/domain/entities";
import { callbackConfig, processRinging, startCallback, type CallbackConfig } from "@/server/integrations/telephony";
import { DomainError } from "@/server/repositories/types";
import { findVisible, newId, requireCan, type ServiceContext } from "./context";
import { getOwned } from "./records";

/**
 * Click-to-call and the incoming call pop-up. A call started from a record rings the user's own
 * phone (their internal number) through the PBX, then the customer; the PBX's call notification
 * later logs it like any other call (src/server/integrations/telephony.ts).
 */

export type CallSetup = { callback: boolean; reason: "ready" | "no_provider" | "no_extension" };

export async function callSetup(ctx: ServiceContext, config: CallbackConfig = callbackConfig()): Promise<CallSetup> {
  if (!config.mango && !config.zadarma) return { callback: false, reason: "no_provider" };
  const me = await ctx.db.read(ctx.actor.organization_id, (tx) => tx.get("profiles", ctx.actor.id));
  return me?.phone_extension ? { callback: true, reason: "ready" } : { callback: false, reason: "no_extension" };
}

export const startCallInput = z.object({ entity: z.enum(["contact", "lead", "company"]), id: z.uuid() }).strict();

/** Starts a call to a record's phone number from the user's extension. */
export async function startCall(ctx: ServiceContext, input: z.output<typeof startCallInput>, config: CallbackConfig = callbackConfig(), fetchImpl: typeof fetch = fetch): Promise<{ provider: string; phone: string }> {
  requireCan(ctx, "create", "activity");
  const { phone, extension } = await ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const table = input.entity === "contact" ? "contacts" : input.entity === "lead" ? "leads" : "companies";
    const record = (await getOwned(tx, ctx, table, input.id)) as { phone: string | null };
    const me = await tx.get("profiles", ctx.actor.id);
    return { phone: record.phone, extension: me?.phone_extension ?? null };
  });
  if (!phone) throw new DomainError("This record has no phone number.");
  if (!extension) throw new DomainError("Set your internal phone number in Settings → Profile first.");
  if (!config.mango && !config.zadarma) throw new DomainError("Calls from NEXORA need Mango Office or Zadarma to be connected.");
  try {
    const { provider } = await startCallback(config, extension, phone, fetchImpl);
    return { provider, phone };
  } catch (error) {
    throw new DomainError(`The call could not be started: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The newest unanswered incoming call card for the user, from the last few minutes. */
export async function currentIncomingCall(ctx: ServiceContext, now: Date = new Date()): Promise<Pick<Notification, "id" | "title" | "body" | "link" | "created_at"> | null> {
  const since = new Date(now.getTime() - 3 * 60_000).toISOString();
  return ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const calls = (await tx.find("notifications", { recipient_id: ctx.actor.id, type: "incoming_call", read_at: null })).filter((n) => n.created_at >= since);
    const latest = calls.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    return latest ? { id: latest.id, title: latest.title, body: latest.body, link: latest.link, created_at: latest.created_at } : null;
  });
}

/**
 * Demo mode only: a customer "calls" the current user, so the caller's card can be shown without a
 * PBX. Picks a contact with a phone number that the user can see.
 */
export async function simulateIncomingCall(ctx: ServiceContext): Promise<{ contact_id: string }> {
  const contact = await ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const visible = await findVisible(tx, ctx, "contacts", "contact", (r) => r.owner_id, { archived_at: null });
    const withPhone = visible.filter((c) => c.phone);
    return withPhone[Math.floor(Math.random() * withPhone.length)] ?? null;
  });
  if (!contact?.phone) throw new DomainError("No contact with a phone number to simulate a call from.");
  await processRinging(ctx, { provider: "demo", id: newId(), customer: contact.phone, extension: null, forUser: ctx.actor.id });
  return { contact_id: contact.id };
}
