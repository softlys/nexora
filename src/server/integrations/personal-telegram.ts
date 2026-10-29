import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Notification } from "@/domain/entities";
import type { Db } from "@/server/db/types";
import { tr } from "@/lib/i18n";
import { TELEGRAM_MAX_TEXT } from "./telegram";

/**
 * Personal Telegram notifications. A user links the CRM's Telegram bot from Settings → Profile (a
 * t.me/<bot>?start=<token> link signed for their user id); after that, every NEXORA notification
 * of theirs is also sent to that chat. The scheduler (every 5 minutes) also creates notifications
 * for new leads and overdue tasks.
 *
 *   TELEGRAM_BOT_TOKEN     the same bot as the inbox
 *   TELEGRAM_BOT_USERNAME  its @username, for the link (without @)
 */

export function personalBotConfig(env: NodeJS.ProcessEnv = process.env): { token: string | null; username: string | null } {
  const username = env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "") || null;
  return { token: env.TELEGRAM_BOT_TOKEN?.trim() || null, username: username && /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username) ? username : null };
}

const sign = (hex: string, secret: string) => createHmac("sha256", secret).update(`tg-link:${hex}`).digest("hex").slice(0, 16);

/** The /start parameter for a user: their id without dashes and a signature (Telegram allows 64 chars of [A-Za-z0-9_-]). */
export function telegramLinkToken(userId: string, secret: string): string {
  const hex = userId.replace(/-/g, "");
  return `${hex}_${sign(hex, secret)}`;
}

/** The user id from a /start parameter, or null when it is not a valid signed token. */
export function userFromLinkToken(token: string, secret: string): string | null {
  const m = /^([0-9a-f]{32})_([0-9a-f]{16})$/.exec(token.trim());
  if (!m) return null;
  const expected = Buffer.from(sign(m[1]!, secret));
  if (!timingSafeEqual(expected, Buffer.from(m[2]!))) return null;
  const h = m[1]!;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export type SendToChat = (chatId: string, text: string) => Promise<void>;

export function telegramChatSender(token: string, fetchImpl: typeof fetch = fetch): SendToChat {
  return async (chatId, text) => {
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, TELEGRAM_MAX_TEXT), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(5_000),
    });
    const body = (await response.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (!response.ok || !body.ok) throw new Error(`Telegram refused the message: ${body.description ?? `HTTP ${response.status}`}`);
  };
}

const DAY = 86_400_000;

/**
 * Scheduler step: notifications for leads created in the last day (to the owner, or to admins and
 * managers when nobody owns the lead) and for overdue open tasks (to the owner). Each is created once.
 */
export async function createReminderNotifications(db: Db, orgId: string, now: Date): Promise<{ leads: number; tasks: number }> {
  return db.write(orgId, async (tx) => {
    const since = new Date(now.getTime() - DAY).toISOString();
    const at = now.toISOString();
    const profiles = (await tx.find("profiles")).filter((p) => p.is_active && !p.archived_at);
    const leads_ = await tx.find("leads", { archived_at: null });
    // Checked up front: a failed unique insert would abort a Postgres transaction.
    const done = new Set((await tx.find("notifications")).map((n) => n.dedupe_key).filter(Boolean));
    const notify = async (n: Omit<Notification, "id" | "read_at" | "organization_id" | "created_at">) => {
      if (done.has(n.dedupe_key)) return false;
      done.add(n.dedupe_key);
      await tx.insert("notifications", { ...n, id: randomUUID(), organization_id: orgId, read_at: null, created_at: at });
      return true;
    };
    let leads = 0;
    let tasks = 0;
    const leadTeam = profiles.filter((p) => p.role === "admin" || p.role === "manager").map((p) => p.id);
    for (const lead of leads_.filter((l) => l.created_at >= since && l.status === "new")) {
      for (const recipient of lead.owner_id ? [lead.owner_id] : leadTeam) {
        if (await notify({ recipient_id: recipient, type: "lead.new", title: tr("New lead: {p0}", { p0: lead.title }).slice(0, 200), body: [lead.company_name, lead.contact_name, lead.phone].filter(Boolean).join(" · ").slice(0, 1000), link: `/leads/${lead.id}`, dedupe_key: `lead-new:${lead.id}:${recipient}` })) leads++;
      }
    }
    for (const task of await tx.find("tasks")) {
      if (!task.due_at || task.due_at > at || task.due_at < since || task.status === "done" || task.status === "cancelled" || task.archived_at) continue;
      if (await notify({ recipient_id: task.assignee_id, type: "task.overdue", title: tr("Overdue task: {p0}", { p0: task.title }).slice(0, 200), body: "", link: `/tasks/${task.id}`, dedupe_key: `task-overdue:${task.id}` })) tasks++;
    }
    return { leads, tasks };
  });
}

/** Sends notifications of the last day that were not sent yet to their recipients' linked Telegram chats. */
export async function pushNotificationsToTelegram(db: Db, orgId: string, send: SendToChat, baseUrl: string, now: Date = new Date()): Promise<{ sent: number; failed: number }> {
  const { pending, chats } = await db.read(orgId, async (tx) => {
    const chats = new Map((await tx.find("profiles")).filter((p) => p.telegram_chat_id && p.is_active).map((p) => [p.id, p.telegram_chat_id!]));
    const since = new Date(now.getTime() - DAY).toISOString();
    const pending = (await tx.find("notifications")).filter((n) => !n.pushed_at && !n.read_at && n.created_at >= since && chats.has(n.recipient_id));
    return { pending, chats };
  });
  let sent = 0;
  let failed = 0;
  for (const n of pending) {
    try {
      await send(chats.get(n.recipient_id)!, [n.title, n.body, n.link && `${baseUrl}${n.link}`].filter(Boolean).join("\n"));
      sent++;
    } catch {
      failed++;
    }
    // Marked either way, so a chat that blocked the bot is not retried every run.
    await db.write(orgId, (tx) => tx.update("notifications", n.id, { pushed_at: new Date().toISOString() }));
  }
  return { sent, failed };
}
