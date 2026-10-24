import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Deal, PipelineStage, Task } from "@/domain/entities";
import { getServiceDb, listOrganizationIds } from "@/server/db";
import { signValue } from "@/server/session-signing";
import type { ServiceContext } from "@/server/services/context";
import { readCursor, writeCursor } from "./inbound";

/**
 * Personal calendar feed (iCalendar, RFC 5545): a secret URL per user that Google Calendar, Outlook,
 * Yandex Calendar and Apple Calendar subscribe to. It lists the user's open tasks with a due time
 * (calls, meetings, follow-ups) and the expected close dates of their open deals. Read-only: the
 * calendar app polls it (Google every few hours, Yandex and Outlook more often).
 *
 * The URL holds the user id and an HMAC over it and a version; "Reset link" bumps the version, so
 * an old, leaked link stops working.
 */

function feedKey(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.NEXORA_FEED_SECRET?.trim() || env.NEXORA_ENCRYPTION_KEY?.trim() || env.NEXORA_SESSION_SECRET?.trim() || null;
}

async function sign(value: string): Promise<string> {
  const key = feedKey();
  if (key) return createHmac("sha256", key).update(value).digest("base64url");
  const signed = await signValue(value);
  return signed.slice(signed.lastIndexOf(".") + 1);
}

async function feedVersion(ctx: ServiceContext, userId: string): Promise<number> {
  const cursor = await ctx.db.read(ctx.actor.organization_id, (tx) => readCursor(tx, "calendar", userId));
  return Number(cursor?.version ?? 1);
}

export async function feedToken(ctx: ServiceContext): Promise<string> {
  const version = await feedVersion(ctx, ctx.actor.id);
  return `${ctx.actor.id}.${version}.${await sign(`calendar:${ctx.actor.id}:${version}`)}`;
}

export async function resetFeedToken(ctx: ServiceContext): Promise<void> {
  const version = (await feedVersion(ctx, ctx.actor.id)) + 1;
  await ctx.db.write(ctx.actor.organization_id, (tx) => writeCursor(tx, ctx, "calendar", ctx.actor.id, { version }));
}

/** Resolves a token to the user and organization, or null. */
export async function resolveFeedToken(token: string): Promise<{ orgId: string; userId: string } | null> {
  const m = /^([0-9a-f-]{36})\.(\d{1,6})\.([A-Za-z0-9_-]{20,100})$/.exec(token);
  if (!m) return null;
  const [, userId, version, mac] = m;
  const expected = Buffer.from(await sign(`calendar:${userId}:${version}`));
  const given = Buffer.from(mac!);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const db = getServiceDb();
  for (const orgId of await listOrganizationIds()) {
    const profile = await db.read(orgId, async (tx) => (await tx.get("profiles", userId!)) ?? null);
    if (!profile) continue;
    if (!profile.is_active || profile.archived_at) return null;
    const current = await db.read(orgId, (tx) => readCursor(tx, "calendar", userId!));
    if (Number(current?.version ?? 1) !== Number(version)) return null;
    return { orgId, userId: userId! };
  }
  return null;
}

// --- iCalendar -----------------------------------------------------------------

/** RFC 5545 text escaping. */
export function icsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Folds lines longer than 75 octets (continuation lines start with a space), never splitting a UTF-8 character. */
export function foldLine(line: string): string {
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch);
    if (bytes + size > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = "";
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const utc = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "").replace(/Z?$/, "Z");
const dateOnly = (d: string) => d.replace(/-/g, "");

const DURATION: Record<Task["type"], string> = { call: "PT30M", meeting: "PT1H", email: "PT15M", follow_up: "PT30M", todo: "PT30M" };

export function buildCalendar(input: { name: string; baseUrl: string; tasks: Task[]; deals: Deal[]; stages: PipelineStage[]; companyName: (id: string | null) => string; now: Date }): string {
  const stamp = utc(input.now.toISOString());
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//NEXORA//CRM//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${icsText(input.name)}`, "X-PUBLISHED-TTL:PT1H", "REFRESH-INTERVAL;VALUE=DURATION:PT1H"];
  for (const t of input.tasks) {
    if (!t.due_at) continue;
    const company = input.companyName(t.company_id);
    lines.push(
      "BEGIN:VEVENT",
      `UID:task-${t.id}@nexora`,
      `DTSTAMP:${stamp}`,
      `LAST-MODIFIED:${utc(t.updated_at)}`,
      `DTSTART:${utc(t.due_at)}`,
      `DURATION:${DURATION[t.type]}`,
      `SUMMARY:${icsText(`${t.title}${company ? ` · ${company}` : ""}`)}`,
      `DESCRIPTION:${icsText([t.description, `${input.baseUrl}/tasks?task=${t.id}`].filter(Boolean).join("\n\n"))}`,
      `URL:${input.baseUrl}/tasks?task=${t.id}`,
      `CATEGORIES:${icsText(t.type)}`,
      `PRIORITY:${t.priority === "urgent" ? 1 : t.priority === "high" ? 3 : t.priority === "low" ? 9 : 5}`,
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${icsText(t.title)}`,
      "TRIGGER:-PT15M",
      "END:VALARM",
      "END:VEVENT",
    );
  }
  const stage = new Map(input.stages.map((s) => [s.id, s]));
  for (const d of input.deals) {
    const s = stage.get(d.stage_id);
    if (!d.expected_close_date || s?.is_won || s?.is_lost) continue;
    const next = new Date(`${d.expected_close_date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    lines.push(
      "BEGIN:VEVENT",
      `UID:deal-close-${d.id}@nexora`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${dateOnly(d.expected_close_date)}`,
      `DTEND;VALUE=DATE:${dateOnly(next.toISOString().slice(0, 10))}`,
      `SUMMARY:${icsText(`Expected close: ${d.name} (${d.amount.toLocaleString("en-US")} ${d.currency})`)}`,
      `DESCRIPTION:${icsText(`${input.companyName(d.company_id)} · ${s?.name ?? ""}\n${input.baseUrl}/deals/${d.id}`)}`,
      `URL:${input.baseUrl}/deals/${d.id}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** The feed of one user: open tasks with a due time from 30 days ago on, and their open deals' close dates. */
export async function calendarFor(orgId: string, userId: string, baseUrl: string, now = new Date()): Promise<string> {
  const db = getServiceDb();
  return db.read(orgId, async (tx) => {
    const from = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    const tasks = (await tx.find("tasks", { assignee_id: userId, archived_at: null })).filter((t) => (t.status === "todo" || t.status === "in_progress") && t.due_at && t.due_at >= from);
    const deals = await tx.find("deals", { owner_id: userId, archived_at: null });
    const companies = new Map((await tx.find("companies")).map((c) => [c.id, c.name]));
    const profile = await tx.get("profiles", userId);
    return buildCalendar({ name: `NEXORA · ${profile?.full_name ?? "tasks"}`, baseUrl, tasks, deals, stages: await tx.find("pipeline_stages"), companyName: (id) => (id ? (companies.get(id) ?? "") : ""), now });
  });
}
