import { formatRelative } from "@/lib/format";
import { intlLocale, tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { loadPage } from "@/server/page-data";
import type { EmailComposer } from "@/server/services/email";
import { emailThreads, type ThreadTarget } from "@/server/services/email-threads";
import { EmailComposerButton } from "./email-composer";

/** E-mail correspondence on a record, by thread, with a reply that stays in the customer's thread. */
export async function EmailThreads({ target, composer, canReply }: { target: ThreadTarget; composer: EmailComposer; canReply: boolean }) {
  const threads = await loadPage((ctx) => emailThreads(ctx, target));
  if (threads.length === 0) return <p className="text-sm text-text-muted">{tr("No e-mails yet. Incoming mail appears here once the mailbox is connected (Integrations → Mailbox).")}</p>;
  return (
    <ul className="divide-y divide-border" data-testid="email-threads">
      {threads.map((t, i) => (
        <li key={t.key}>
          <details open={i === 0} className="group py-2">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
              <span className="min-w-0 truncate text-sm font-medium">{t.subject}</span>
              <span className="shrink-0 text-xs text-text-muted">
                {t.messages.length} · {formatRelative(t.last_at)}
              </span>
            </summary>
            <div className="mt-2 space-y-2">
              {t.messages.map((m) => (
                <div key={m.id} className={cn("flex", m.direction === "out" ? "justify-end" : "justify-start")}>
                  <div className={cn("max-w-[85%] rounded-lg border px-3 py-2 text-sm", m.direction === "out" ? "border-brand/30 bg-brand-subtle" : "border-border bg-surface-subtle")}>
                    <p className="mb-1 text-[11px] text-text-muted">
                      {m.direction === "out" ? tr("To {p0}", { p0: m.address ?? "—" }) : tr("From {p0}", { p0: m.address ?? "—" })} · {new Date(m.at).toLocaleString(intlLocale(), { dateStyle: "short", timeStyle: "short" })}
                    </p>
                    <p className="line-clamp-[12] whitespace-pre-wrap">{m.body}</p>
                  </div>
                </div>
              ))}
              {canReply && (
                <div className="flex justify-end">
                  <EmailComposerButton composer={composer} reply={{ to: t.reply_to, subject: t.subject, inReplyTo: t.in_reply_to }} />
                </div>
              )}
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}
