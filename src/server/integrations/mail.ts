import "server-only";
import type { ServiceContext } from "@/server/services/context";
import { claimExternal, findParty, linkExternal, openDealOf, readCursor, recordActivity, writeCursor } from "./inbound";

/**
 * Mail → timelines over IMAP: Yandex 360 (Яндекс Почта), Gmail, Mail.ru or any IMAP server. The
 * scheduler reads new messages in the configured folders; a message is recorded as an email activity
 * only when its other party (the sender of an incoming message, the first recipient of a sent one) is
 * a contact or open lead in NEXORA, so private and unrelated mail never enters the CRM.
 *
 * Use an app password (Yandex ID → Security → App passwords; Google Account → App passwords), not the
 * account password. Credentials live in the server environment only.
 */
const PRESETS = {
  yandex: { host: "imap.yandex.ru", sent: "Отправленные" },
  gmail: { host: "imap.gmail.com", sent: "[Gmail]/Sent Mail" },
  mailru: { host: "imap.mail.ru", sent: "Отправленные" },
} as const;

export type MailConfig = { host: string; port: number; user: string; password: string; folders: string[]; provider: string };

export function mailConfig(env: NodeJS.ProcessEnv = process.env): { config: MailConfig | null; problem: string | null } {
  const user = env.MAIL_IMAP_USER?.trim();
  const password = env.MAIL_IMAP_PASSWORD?.trim();
  if (!user && !password) return { config: null, problem: null };
  if (!user || !password) return { config: null, problem: "Set both MAIL_IMAP_USER and MAIL_IMAP_PASSWORD (an app password)." };
  const provider = (env.MAIL_IMAP_PROVIDER?.trim().toLowerCase() || (user.endsWith("@gmail.com") ? "gmail" : /@(yandex\.(ru|com)|ya\.ru)$/.test(user) ? "yandex" : /@(mail|bk|inbox|list)\.ru$/.test(user) ? "mailru" : "custom")) as keyof typeof PRESETS | "custom";
  const preset = provider === "custom" ? null : PRESETS[provider];
  const host = env.MAIL_IMAP_HOST?.trim() || preset?.host;
  if (!host) return { config: null, problem: "Set MAIL_IMAP_HOST for this mail provider (or MAIL_IMAP_PROVIDER=yandex|gmail|mailru)." };
  const folders = (env.MAIL_IMAP_FOLDERS?.split(",").map((f) => f.trim()).filter(Boolean) ?? ["INBOX", ...(preset ? [preset.sent] : [])]).slice(0, 5);
  return { config: { host, port: Number(env.MAIL_IMAP_PORT ?? 993) || 993, user, password, folders, provider }, problem: null };
}

export type MailMessage = {
  messageId: string;
  folder: string;
  uid: number;
  date: string;
  subject: string;
  from: string | null;
  to: string[];
  text: string;
};

/** Records messages whose other party is known. Returns how many were recorded. */
export async function recordMessages(ctx: ServiceContext, mailbox: string, messages: MailMessage[]): Promise<number> {
  const self = mailbox.toLowerCase();
  let recorded = 0;
  for (const m of messages) {
    const outgoing = m.from?.toLowerCase() === self;
    const other = outgoing ? m.to.find((t) => t.toLowerCase() !== self) : m.from;
    if (!other) continue;
    const done = await ctx.db.write(ctx.actor.organization_id, async (tx) => {
      const party = await findParty(tx, { email: other });
      if (!party.contact && !party.lead) return false;
      const claim = await claimExternal(tx, ctx, "imap", m.messageId, { folder: m.folder });
      if (!claim) return false;
      const activity = await recordActivity(tx, ctx, {
        type: "email",
        subject: `${outgoing ? "Email to" : "Email from"} ${other}: ${m.subject || "(no subject)"}`,
        body: m.text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 4000),
        occurred_at: m.date,
        contact_id: party.contact?.id ?? null,
        lead_id: party.lead?.id ?? null,
        deal_id: party.contact ? await openDealOf(tx, party.contact.id) : null,
      });
      await linkExternal(tx, claim.id, "activity", activity.id);
      return true;
    });
    if (done) recorded++;
  }
  return recorded;
}

/**
 * One sync pass: per folder, messages after the last seen UID (on the first run, the last 7 days), at
 * most 100 per folder per run. The cursor is saved per folder and reset when the folder's UIDVALIDITY changes.
 */
export async function syncMailbox(ctx: ServiceContext, config: MailConfig, now = new Date()): Promise<{ read: number; recorded: number }> {
  const { ImapFlow } = await import("imapflow");
  const { simpleParser } = await import("mailparser");
  const client = new ImapFlow({ host: config.host, port: config.port, secure: true, auth: { user: config.user, pass: config.password }, logger: false, socketTimeout: 30_000 });
  await client.connect();
  let read = 0;
  let recorded = 0;
  try {
    for (const folder of config.folders) {
      const lock = await client.getMailboxLock(folder).catch(() => null);
      if (!lock) continue;
      try {
        const mailbox = client.mailbox;
        const validity = mailbox && typeof mailbox === "object" ? String(mailbox.uidValidity) : "";
        const cursor = await ctx.db.read(ctx.actor.organization_id, (tx) => readCursor(tx, "imap", `${config.user}:${folder}`));
        const lastUid = cursor && cursor.validity === validity ? Number(cursor.uid ?? 0) : 0;
        const range = lastUid > 0 ? { uid: `${lastUid + 1}:*` } : { since: new Date(now.getTime() - 7 * 86_400_000) };
        const messages: MailMessage[] = [];
        let maxUid = lastUid;
        for await (const msg of client.fetch(range, { uid: true, envelope: true, source: { maxLength: 256 * 1024 } }, { uid: true })) {
          if (msg.uid <= lastUid) continue;
          maxUid = Math.max(maxUid, msg.uid);
          if (messages.length >= 100) continue;
          const env = msg.envelope;
          const parsed = msg.source ? await simpleParser(msg.source).catch(() => null) : null;
          messages.push({
            messageId: env?.messageId || `${folder}:${validity}:${msg.uid}`,
            folder,
            uid: msg.uid,
            date: new Date(env?.date ?? now).toISOString(),
            subject: env?.subject ?? "",
            // Addresses come from the server-parsed ENVELOPE, not from the raw headers.
            from: env?.from?.[0]?.address ?? null,
            to: [...(env?.to ?? []), ...(env?.cc ?? [])].map((a) => a.address).filter((a): a is string => Boolean(a)),
            text: parsed?.text ?? "",
          });
        }
        read += messages.length;
        recorded += await recordMessages(ctx, config.user, messages);
        await ctx.db.write(ctx.actor.organization_id, (tx) => writeCursor(tx, ctx, "imap", `${config.user}:${folder}`, { uid: maxUid, validity, synced_at: now.toISOString() }));
      } finally {
        lock.release();
      }
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
  return { read, recorded };
}
