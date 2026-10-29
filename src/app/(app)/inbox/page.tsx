import { ExternalLink, MessagesSquare, Paperclip } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/patterns/empty-state";
import { PageHeader } from "@/components/patterns/page-header";
import { StatusBadge } from "@/components/patterns/status-badge";
import { CHAT_CHANNELS, type ChatChannel } from "@/domain/entities";
import { first } from "@/domain/list";
import { formatRelative } from "@/lib/format";
import { intlLocale, tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { requirePermission } from "@/server/guards";
import { CHANNEL_NAMES, channelSenders } from "@/server/integrations/chat";
import { loadPage } from "@/server/page-data";
import { getQuickReplies, listConversations, openConversation } from "@/server/services/inbox";
import { activeProfiles } from "@/server/services/records";
import { AssigneeSelect, DealFromChatButton, InboxRefresh, ReplyBox, ScrollToEnd, StatusButton } from "./inbox-client";

export const metadata = { title: tr("Inbox") };

/** Shown until the organization saves its own quick replies. */
const DEFAULT_QUICK_REPLIES = [
  "Hello! Thank you for your message, we will answer within a few minutes.",
  "Could you leave your phone number? A manager will call you back.",
  "We have sent the price list to your e-mail.",
  "Thank you for your order! We will let you know when it ships.",
];

const CHANNEL_TONE: Record<ChatChannel, "accent" | "success" | "neutral" | "warning"> = { telegram: "accent", whatsapp: "success", vk: "accent", avito: "warning", instagram: "warning", site: "neutral" };

/** Customer chats from Telegram, WhatsApp, VK and the website chat, with replies in the same channel. */
export default async function InboxPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("view", "activity");
  const params = await searchParams;
  const channel = (CHAT_CHANNELS as readonly string[]).includes(first(params.channel) ?? "") ? (first(params.channel) as ChatChannel) : undefined;
  const status = first(params.status) === "closed" ? "closed" : "open";
  const mine = first(params.mine) === "1";
  const selected = first(params.c);
  const { list, view, users, quickReplies, me, role } = await loadPage(async (ctx) => {
    const list = await listConversations(ctx, { channel, status, mine });
    const id = selected && /^[0-9a-f-]{36}$/.test(selected) ? selected : list.rows[0]?.id;
    const view = id ? await openConversation(ctx, id).catch(() => null) : null;
    const users = (await ctx.db.read(ctx.actor.organization_id, activeProfiles)).map((p) => ({ id: p.id, name: p.full_name }));
    return { list, view, users, quickReplies: await getQuickReplies(ctx), me: ctx.actor.id, role: ctx.actor.role };
  });
  const senders = channelSenders();
  const query = (patch: Record<string, string | undefined>) => {
    const q = new URLSearchParams(Object.entries({ channel, status: status === "closed" ? "closed" : undefined, mine: mine ? "1" : undefined, ...patch }).filter(([, v]) => v) as Array<[string, string]>);
    return `/inbox${q.size ? `?${q}` : ""}`;
  };

  return (
    <div className="space-y-5">
      <InboxRefresh />
      <PageHeader
        title={tr("Inbox")}
        description={tr("Messages from Telegram, WhatsApp, VK and your website chat in one place. Replies go back through the same channel.")}
        actions={
          senders.site.configured ? (
            <a href="/api/chat/demo" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-brand hover:underline">
              {tr("Website chat demo")}
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          ) : undefined
        }
      />
      <nav aria-label={tr("Channels")} className="flex flex-wrap items-center gap-1">
        {[undefined, ...CHAT_CHANNELS].map((c) => (
          <Link key={c ?? "all"} href={query({ channel: c, c: undefined })} aria-current={c === channel ? "page" : undefined} className={cn("rounded-md px-3 py-1.5 text-sm text-text-subtle hover:bg-surface-muted", c === channel && "bg-surface-muted font-medium text-foreground")}>
            {c ? tr(CHANNEL_NAMES[c]) : tr("All channels")}
          </Link>
        ))}
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        <Link href={query({ mine: mine ? undefined : "1", c: undefined })} aria-current={mine ? "page" : undefined} className={cn("rounded-md px-3 py-1.5 text-sm text-text-subtle hover:bg-surface-muted", mine && "bg-surface-muted font-medium text-foreground")} data-testid="mine-filter">
          {tr("Mine")}
        </Link>
        <Link href={query({ status: status === "open" ? "closed" : undefined, c: undefined })} className="rounded-md px-3 py-1.5 text-sm text-text-subtle hover:bg-surface-muted">
          {status === "open" ? tr("Show closed") : tr("Show open")}
        </Link>
      </nav>

      {list.rows.length === 0 ? (
        <EmptyState icon={MessagesSquare} title={status === "open" ? tr("No open conversations") : tr("No closed conversations")} description={tr("When customers write to your Telegram bot, WhatsApp, VK community or website chat, their messages appear here.")} />
      ) : (
        <div className="grid min-h-[60vh] gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface" data-testid="conversations">
            {list.rows.map((c) => (
              <li key={c.id}>
                <Link href={query({ c: c.id })} aria-current={view?.conversation.id === c.id ? "true" : undefined} className={cn("block px-3 py-2.5 hover:bg-surface-subtle", view?.conversation.id === c.id && "bg-surface-muted")}>
                  <span className="flex items-center justify-between gap-2">
                    <span className={cn("truncate text-sm", c.unread ? "font-semibold" : "font-medium")}>{c.title}</span>
                    <span className="shrink-0 text-[11px] text-text-muted">{formatRelative(c.last_message_at)}</span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-2">
                    <StatusBadge label={tr(CHANNEL_NAMES[c.channel])} tone={CHANNEL_TONE[c.channel]} />
                    <span className={cn("truncate text-xs", c.unread ? "text-foreground" : "text-text-muted")}>{c.last_message_preview}</span>
                    {c.assignee_name && <span className="ml-auto shrink-0 text-[11px] text-text-muted">{c.assignee_name.split(" ")[0]}</span>}
                    {c.unread && <span className="ml-auto size-2 shrink-0 rounded-full bg-brand" aria-label={tr("Unread")} />}
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          {view ? (
            <section className="flex min-h-[60vh] flex-col overflow-hidden rounded-lg border border-border bg-surface" data-testid="conversation">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                <div className="min-w-0">
                  <h2 className="truncate font-medium">{view.conversation.title}</h2>
                  <p className="truncate text-xs text-text-muted">
                    {tr(CHANNEL_NAMES[view.conversation.channel])}
                    {view.record && ` · ${view.record.detail || view.record.label}`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <AssigneeSelect id={view.conversation.id} assigneeId={view.conversation.assignee_id} users={users} me={me} canAssignOthers={role !== "sales_rep"} />
                  {view.conversation.contact_id && <DealFromChatButton id={view.conversation.id} />}
                  {view.conversation.record_href && (
                    <Link href={view.conversation.record_href} className="text-sm text-brand hover:underline">
                      {view.conversation.contact_id ? tr("Open contact") : tr("Open lead")}
                    </Link>
                  )}
                  <StatusButton id={view.conversation.id} status={view.conversation.status} />
                </div>
              </header>
              <div className="flex-1 space-y-2 overflow-y-auto bg-surface-subtle p-4" data-testid="messages">
                {view.messages.map((m) => (
                  <div key={m.id} className={cn("flex", m.direction === "out" ? "justify-end" : "justify-start")}>
                    <div className={cn("max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap", m.direction === "out" ? "bg-brand text-brand-foreground" : "border border-border bg-surface")}>
                      {m.body}
                      {m.files.map((f) =>
                        f.content_type.startsWith("image/") ? (
                          <a key={f.id} href={`/api/files/${f.id}`} target="_blank" rel="noreferrer" className="mt-2 block">
                            {/* eslint-disable-next-line @next/next/no-img-element -- a private file behind an access check */}
                            <img src={`/api/files/${f.id}`} alt={f.file_name} className="max-h-60 rounded-md" />
                          </a>
                        ) : (
                          <a key={f.id} href={`/api/files/${f.id}`} target="_blank" rel="noreferrer" className="mt-2 flex items-center gap-1 underline">
                            <Paperclip className="size-3.5" aria-hidden />
                            {f.file_name}
                          </a>
                        ),
                      )}
                      <span className={cn("mt-1 block text-[11px]", m.direction === "out" ? "text-brand-foreground/80" : "text-text-muted")}>
                        {m.direction === "out" && m.author_name ? `${m.author_name} · ` : ""}
                        {new Date(m.created_at).toLocaleString(intlLocale(), { dateStyle: "short", timeStyle: "short" })}
                      </span>
                    </div>
                  </div>
                ))}
                <ScrollToEnd count={view.messages.length} />
              </div>
              <ReplyBox
                conversationId={view.conversation.id}
                channelName={tr(CHANNEL_NAMES[view.conversation.channel])}
                quickReplies={quickReplies.length ? quickReplies : DEFAULT_QUICK_REPLIES.map((r) => tr(r))}
                canEditReplies={role !== "sales_rep"}
                canSendFiles={Boolean(senders[view.conversation.channel].sendFile)}
                disabledReason={senders[view.conversation.channel].configured ? null : tr("{p0} is not connected, so replies cannot be sent. An admin can connect it in Integrations.", { p0: tr(CHANNEL_NAMES[view.conversation.channel]) })}
              />
            </section>
          ) : (
            <EmptyState title={tr("Choose a conversation")} description={tr("Pick a conversation on the left to read and reply.")} />
          )}
        </div>
      )}
    </div>
  );
}
