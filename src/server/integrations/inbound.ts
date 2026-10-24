import "server-only";
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { Activity, Contact, Lead, Profile } from "@/domain/entities";
import type { Actor } from "@/domain/permissions";
import { dispatchAutomations } from "@/server/automation/runtime";
import { getServiceDb, listOrganizationIds } from "@/server/db";
import { UniqueViolation, type Tx } from "@/server/db/types";
import type { RequestMeta } from "@/server/repositories/types";
import { emit, flushSecurityEvents, newId, type ServiceContext } from "@/server/services/context";

/**
 * Shared plumbing for data that external services push into NEXORA (web forms, calls, chat
 * messages, payments, mail):
 * - which organization and which user the records are created as;
 * - the shared hook secret for services that cannot sign their requests;
 * - de-duplication by the service's own id (integration_records), so retries never double up;
 * - finding the contact or lead behind a phone number or an email address.
 */

export class InboundConfigError extends Error {}

/** NEXORA_HOOK_SECRET: 24+ characters, part of the URL for services without signatures (Tilda, Yandex Forms). */
export function hookSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env.NEXORA_HOOK_SECRET?.trim();
  return value && value.length >= 24 ? value : null;
}

export function secretMatches(given: string | null | undefined, expected: string | null): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function toActor(profile: Profile, all: Profile[]): Actor {
  return { id: profile.id, role: profile.role, organization_id: profile.organization_id, team_member_ids: all.filter((p) => p.manager_id === profile.id && !p.archived_at).map((p) => p.id) };
}

/**
 * The context inbound records are created in: NEXORA_INBOUND_ORG_ID (or the only organization), acting
 * as NEXORA_INBOUND_USER_EMAIL (or the organization's first active admin). Created records go through
 * the normal services: validation, audit log, events and automations (for example New lead → assign owner).
 */
export async function inboundContext(meta: RequestMeta, env: NodeJS.ProcessEnv = process.env): Promise<ServiceContext> {
  const db = getServiceDb();
  let orgId = env.NEXORA_INBOUND_ORG_ID?.trim() || null;
  if (!orgId) {
    const orgs = await listOrganizationIds();
    if (orgs.length !== 1) throw new InboundConfigError("Set NEXORA_INBOUND_ORG_ID: there is more than one organization.");
    orgId = orgs[0]!;
  }
  const profiles = await db.read(orgId, (tx) => tx.find("profiles"));
  const active = profiles.filter((p) => p.is_active && !p.archived_at);
  const wanted = env.NEXORA_INBOUND_USER_EMAIL?.trim().toLowerCase();
  const user = wanted ? active.find((p) => p.email.toLowerCase() === wanted) : active.filter((p) => p.role === "admin").sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  if (!user) throw new InboundConfigError(wanted ? `NEXORA_INBOUND_USER_EMAIL ${wanted} is not an active user.` : "The organization has no active admin to create inbound records as.");
  return { actor: toActor(user, profiles), principal: "service", meta, db, deferred: [], pendingEvents: [] };
}

export function inboundMeta(request: Request): RequestMeta {
  return { ip: null, user_agent: request.headers.get("user-agent")?.slice(0, 512) ?? null, request_id: randomUUID() };
}

/** Runs automations for what was created and writes pending security events. */
export async function finishInbound(ctx: ServiceContext): Promise<void> {
  await dispatchAutomations(ctx);
  await flushSecurityEvents(ctx);
}

/**
 * Claims an external id inside the transaction that creates the record. Returns false when it was
 * already processed (a webhook retry, a mailbox read twice): the caller then does nothing.
 */
export async function claimExternal(tx: Tx, ctx: ServiceContext, source: string, externalId: string, data: Record<string, unknown> = {}): Promise<{ id: string } | null> {
  const existing = await tx.find("integration_records", { source, external_id: externalId.slice(0, 255) });
  if (existing.length) return null;
  const at = new Date().toISOString();
  const id = randomUUID();
  try {
    await tx.insert("integration_records", { id, organization_id: ctx.actor.organization_id, source, external_id: externalId.slice(0, 255), entity_type: null, entity_id: null, data, created_at: at, updated_at: at });
  } catch (error) {
    if (error instanceof UniqueViolation) return null;
    throw error;
  }
  return { id };
}

export async function linkExternal(tx: Tx, recordId: string, entityType: string, entityId: string): Promise<void> {
  await tx.update("integration_records", recordId, { entity_type: entityType, entity_id: entityId, updated_at: new Date().toISOString() });
}

/** A sync cursor (for example the last mailbox UID). */
export async function readCursor(tx: Tx, source: string, key: string): Promise<Record<string, unknown> | null> {
  return (await tx.find("integration_records", { source: `cursor:${source}`, external_id: key }))[0]?.data ?? null;
}

export async function writeCursor(tx: Tx, ctx: ServiceContext, source: string, key: string, data: Record<string, unknown>): Promise<void> {
  const existing = (await tx.find("integration_records", { source: `cursor:${source}`, external_id: key }))[0];
  const at = new Date().toISOString();
  if (existing) await tx.update("integration_records", existing.id, { data, updated_at: at });
  else await tx.insert("integration_records", { id: randomUUID(), organization_id: ctx.actor.organization_id, source: `cursor:${source}`, external_id: key, entity_type: null, entity_id: null, data, created_at: at, updated_at: at });
}

/** Digits only, without a leading 8 or 7 for Russian numbers, compared on the last 10 digits. */
export function phoneKey(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 7) return null;
  return digits.slice(-10);
}

export type Party = { contact: Contact | null; lead: Lead | null };

/** The contact (or else open lead) with this phone number or email. */
export async function findParty(tx: Tx, by: { phone?: string | null; email?: string | null }): Promise<Party> {
  const key = phoneKey(by.phone);
  const email = by.email?.trim().toLowerCase() || null;
  if (!key && !email) return { contact: null, lead: null };
  const contacts = await tx.find("contacts", { archived_at: null });
  const contact = contacts.find((c) => (key && phoneKey(c.phone) === key) || (email && c.email?.toLowerCase() === email) || (key && Object.values(c.messengers ?? {}).some((v) => phoneKey(String(v)) === key))) ?? null;
  if (contact) return { contact, lead: null };
  const leads = await tx.find("leads", { archived_at: null });
  const lead = leads.filter((l) => !l.converted_deal_id).find((l) => (key && phoneKey(l.phone) === key) || (email && l.email?.toLowerCase() === email)) ?? null;
  return { contact: null, lead };
}

/** The open deal of a contact (most recently updated), for linking calls and messages. */
export async function openDealOf(tx: Tx, contactId: string): Promise<string | null> {
  const stages = new Map((await tx.find("pipeline_stages")).map((s) => [s.id, s]));
  const deals = (await tx.find("deals", { primary_contact_id: contactId, archived_at: null })).filter((d) => !stages.get(d.stage_id)?.is_won && !stages.get(d.stage_id)?.is_lost);
  return deals.sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]?.id ?? null;
}

/**
 * An activity written by an integration (a call, an email, a chat message). It has no NEXORA author
 * (actor_id null), so timelines show it as coming from the service, not from a user.
 */
export async function recordActivity(
  tx: Tx,
  ctx: ServiceContext,
  input: { type: Activity["type"]; subject: string; body: string; occurred_at?: string; contact_id?: string | null; lead_id?: string | null; deal_id?: string | null; company_id?: string | null; order_id?: string | null },
): Promise<Activity> {
  const at = new Date().toISOString();
  let companyId = input.company_id ?? null;
  if (!companyId && input.contact_id) companyId = (await tx.get("contacts", input.contact_id))?.company_id ?? null;
  if (!companyId && input.deal_id) companyId = (await tx.get("deals", input.deal_id))?.company_id ?? null;
  const activity: Activity = {
    id: newId(),
    organization_id: ctx.actor.organization_id,
    type: input.type,
    subject: input.subject.slice(0, 200) || "(no subject)",
    body: input.body.slice(0, 5000),
    occurred_at: input.occurred_at ?? at,
    actor_id: null,
    company_id: companyId,
    contact_id: input.contact_id ?? null,
    lead_id: input.lead_id ?? null,
    deal_id: input.deal_id ?? null,
    order_id: input.order_id ?? null,
    created_at: at,
    updated_at: at,
  };
  await tx.insert("activities", activity);
  await emit(tx, ctx, { type: "record.created", payload: { entity: "activity", id: activity.id, after: activity } });
  return activity;
}
