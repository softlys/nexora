import type { Activity } from "@/domain/entities";
import { requireCan, type ServiceContext } from "./context";
import { getOwned } from "./records";

/**
 * E-mail correspondence on a record, grouped into threads by subject ("Re:"/"Fwd:" ignored).
 * Incoming e-mails come from the mailbox sync (subject "Email from <address>: …", with the
 * Message-ID kept in integration_records); outgoing ones from "Write e-mail" ("To: <address>" in the body)
 * or the mailbox's Sent folder ("Email to <address>: …").
 */

export type ThreadMessage = { id: string; direction: "in" | "out"; address: string | null; subject: string; body: string; at: string; message_id: string | null };
export type EmailThread = { key: string; subject: string; messages: ThreadMessage[]; last_at: string; /** Who to answer and which e-mail to answer to. */ reply_to: string | null; in_reply_to: string | null };

export type ThreadTarget = { contact_id?: string; company_id?: string; deal_id?: string; lead_id?: string };

const SYNCED = /^Email (from|to) (\S+): ([\s\S]*)$/;

export function threadSubject(subject: string): string {
  let s = subject.trim();
  for (let i = 0; i < 5; i++) {
    const next = s.replace(/^(re|fwd?|fw|ответ|пересл)(\[\d+\])?\s*:\s*/i, "");
    if (next === s) break;
    s = next;
  }
  return s || "(no subject)";
}

export function parseEmailActivity(a: Activity, messageId: string | null): ThreadMessage {
  const synced = SYNCED.exec(a.subject);
  if (synced) return { id: a.id, direction: synced[1] === "from" ? "in" : "out", address: synced[2]!, subject: synced[3]!.trim(), body: a.body, at: a.occurred_at, message_id: messageId };
  const to = /^To: (\S+)\n\n/.exec(a.body);
  return { id: a.id, direction: "out", address: to?.[1] ?? null, subject: a.subject, body: to ? a.body.slice(to[0].length) : a.body, at: a.occurred_at, message_id: messageId };
}

export function groupThreads(messages: ThreadMessage[]): EmailThread[] {
  const threads = new Map<string, ThreadMessage[]>();
  for (const m of messages) {
    const key = threadSubject(m.subject).toLowerCase();
    threads.set(key, [...(threads.get(key) ?? []), m]);
  }
  return [...threads.entries()]
    .map(([key, list]) => {
      const sorted = list.sort((a, b) => a.at.localeCompare(b.at));
      const lastIn = [...sorted].reverse().find((m) => m.direction === "in");
      return { key, subject: threadSubject(sorted[0]!.subject), messages: sorted, last_at: sorted.at(-1)!.at, reply_to: lastIn?.address ?? sorted.find((m) => m.address)?.address ?? null, in_reply_to: lastIn?.message_id ?? null };
    })
    .sort((a, b) => b.last_at.localeCompare(a.last_at));
}

export async function emailThreads(ctx: ServiceContext, target: ThreadTarget): Promise<EmailThread[]> {
  requireCan(ctx, "view", "activity");
  return ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const [key, id] = Object.entries(target).find(([, v]) => v)!;
    const table = ({ contact_id: "contacts", company_id: "companies", deal_id: "deals", lead_id: "leads" } as const)[key as keyof ThreadTarget];
    await getOwned(tx, ctx, table, id!);
    const emails = (await tx.find("activities", { [key]: id, type: "email" } as Partial<Activity>));
    const ids = new Set(emails.map((e) => e.id));
    const messageIds = new Map((await tx.find("integration_records", { source: "imap" })).filter((r) => r.entity_type === "activity" && r.entity_id && ids.has(r.entity_id)).map((r) => [r.entity_id!, r.external_id]));
    return groupThreads(emails.map((a) => parseEmailActivity(a, messageIds.get(a.id) ?? null)));
  });
}
