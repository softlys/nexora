import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/patterns/page-header";
import { StatusBadge } from "@/components/patterns/status-badge";
import { can } from "@/domain/permissions";
import { requirePermission } from "@/server/guards";
import { telegramConfig } from "@/server/integrations/telegram";
import { TelegramTest } from "./telegram-test";
import { tr } from "@/lib/i18n";

export const metadata = { title: tr("Telegram") };

export default async function TelegramPage() {
  const { user } = await requirePermission("view", "integration");
  const canManage = can(user.actor, "manage", "integration");
  const { token, chat, problem } = telegramConfig();
  const configured = Boolean(token && chat && !problem);
  return (
    <div className="space-y-6">
      <Link href="/integrations" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />{tr("Integrations")}</Link>
      <PageHeader
        title={tr("Telegram")}
        description={tr("A Telegram bot posts team notifications to a chat: new leads, won deals, overdue tasks. Used by the Send to Telegram step in Automation Studio. Configured with environment variables, so the bot token never reaches the browser or the database.")}
      />
      <section className="space-y-4 rounded-xl border border-border bg-surface p-5 shadow-sm" data-testid="telegram-status">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-md font-semibold">{tr("Status")}</h2>
            <p className="text-sm text-text-muted">
              {configured ? <>{tr("Bot configured; messages go to chat")} <span className="font-mono text-xs">{chat}</span>{tr(". Send a test to confirm.")}</> : problem ?? tr("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are not set.")}
            </p>
          </div>
          <StatusBadge status={configured ? "configured" : problem ? "error" : "not_configured"} label={configured ? tr("Configured") : problem ? tr("Misconfigured") : tr("Not configured")} dot />
        </div>
        {configured && (canManage ? <TelegramTest /> : <p className="text-xs text-text-muted">{tr("Only admins can send a test message.")}</p>)}
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-surface p-5 shadow-sm">
        <h2 className="text-md font-semibold">{tr("Connect a bot (about 5 minutes)")}</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>{tr("In Telegram, open")} <span className="font-medium">{tr("@BotFather")}</span>{tr(", send")} <code className="font-mono text-xs">/newbot</code>{tr(", choose a name and copy the token it gives you.")}</li>
          <li>{tr("Create a group for your team (or use a channel) and add the bot to it. In a channel, make the bot an admin so it can post.")}</li>
          <li>{tr("Get the chat id: write any message in the group, then open")} <code className="font-mono text-xs">https://api.telegram.org/bot&lt;token&gt;/getUpdates</code> {tr("and copy")} <code className="font-mono text-xs">chat.id</code> {tr("(groups start with")} <code className="font-mono text-xs">-100</code>{tr("). For a public channel you can use")} <code className="font-mono text-xs">{tr("@channelname")}</code>.
          </li>
          <li>{tr("Set")} <code className="font-mono text-xs">{tr("TELEGRAM_BOT_TOKEN")}</code> {tr("and")} <code className="font-mono text-xs">{tr("TELEGRAM_CHAT_ID")}</code> {tr("in the server environment (Vercel → Settings → Environment Variables, or")} <code className="font-mono text-xs">.env.local</code>{tr(") and restart.")}</li>
          <li>{tr("Come back here and send a test message, then add a Send to Telegram step to a workflow.")}</li>
        </ol>
        <p className="text-xs text-text-muted">{tr("Messages are plain text with record data filled into placeholders such as")} {"{{lead.title}}"}{tr(". Without a configured bot the step is recorded as skipped, never as sent. Writing to individual customers in Telegram requires them to start your bot first; use the contact's Telegram link for one-to-one chats.")}</p>
      </section>
    </div>
  );
}
