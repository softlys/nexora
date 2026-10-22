import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/patterns/page-header";
import { StatusBadge } from "@/components/patterns/status-badge";
import { can } from "@/domain/permissions";
import { requirePermission } from "@/server/guards";
import { telegramConfig } from "@/server/integrations/telegram";
import { TelegramTest } from "./telegram-test";

export const metadata = { title: "Telegram" };

export default async function TelegramPage() {
  const { user } = await requirePermission("view", "integration");
  const canManage = can(user.actor, "manage", "integration");
  const { token, chat, problem } = telegramConfig();
  const configured = Boolean(token && chat && !problem);
  return (
    <div className="space-y-6">
      <Link href="/integrations" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        Integrations
      </Link>
      <PageHeader
        title="Telegram"
        description="A Telegram bot posts team notifications to a chat: new leads, won deals, overdue tasks. Used by the Send to Telegram step in Automation Studio. Configured with environment variables, so the bot token never reaches the browser or the database."
      />
      <section className="space-y-4 rounded-xl border border-border bg-surface p-5 shadow-sm" data-testid="telegram-status">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-md font-semibold">Status</h2>
            <p className="text-sm text-text-muted">
              {configured ? <>Bot configured; messages go to chat <span className="font-mono text-xs">{chat}</span>. Send a test to confirm.</> : problem ?? "TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are not set."}
            </p>
          </div>
          <StatusBadge status={configured ? "configured" : problem ? "error" : "not_configured"} label={configured ? "Configured" : problem ? "Misconfigured" : "Not configured"} dot />
        </div>
        {configured && (canManage ? <TelegramTest /> : <p className="text-xs text-text-muted">Only admins can send a test message.</p>)}
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-surface p-5 shadow-sm">
        <h2 className="text-md font-semibold">Connect a bot (about 5 minutes)</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>
            In Telegram, open <span className="font-medium">@BotFather</span>, send <code className="font-mono text-xs">/newbot</code>, choose a name and copy the token it gives you.
          </li>
          <li>Create a group for your team (or use a channel) and add the bot to it. In a channel, make the bot an admin so it can post.</li>
          <li>
            Get the chat id: write any message in the group, then open <code className="font-mono text-xs">https://api.telegram.org/bot&lt;token&gt;/getUpdates</code> and copy <code className="font-mono text-xs">chat.id</code> (groups start with <code className="font-mono text-xs">-100</code>). For a public channel you can use <code className="font-mono text-xs">@channelname</code>.
          </li>
          <li>
            Set <code className="font-mono text-xs">TELEGRAM_BOT_TOKEN</code> and <code className="font-mono text-xs">TELEGRAM_CHAT_ID</code> in the server environment (Vercel → Settings → Environment Variables, or <code className="font-mono text-xs">.env.local</code>) and restart.
          </li>
          <li>Come back here and send a test message, then add a Send to Telegram step to a workflow.</li>
        </ol>
        <p className="text-xs text-text-muted">
          Messages are plain text with record data filled into placeholders such as {"{{lead.title}}"}. Without a configured bot the step is recorded as skipped, never as sent. Writing to individual customers in Telegram requires them to start your bot first; use the contact&apos;s
          Telegram link for one-to-one chats.
        </p>
      </section>
    </div>
  );
}
