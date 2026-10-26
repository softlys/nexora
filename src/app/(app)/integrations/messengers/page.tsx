import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { MessengerMark } from "@/components/crm/messenger-links";
import { PageHeader } from "@/components/patterns/page-header";
import type { MessengerChannel } from "@/lib/messengers";
import { requirePermission } from "@/server/guards";
import { tr } from "@/lib/i18n";

export const metadata = { title: tr("Messengers and social") };

type Guide = { channel: MessengerChannel; name: string; outbound: string; inbound: string; api: string };

const GUIDES: Guide[] = [
  {
    channel: "whatsapp",
    name: "WhatsApp",
    outbound: tr("Send template messages through the WhatsApp Business Cloud API from a Make or n8n scenario that receives NEXORA events (for example deal.won → order confirmation)."),
    inbound: tr("Incoming messages arrive at the scenario's Meta webhook; the scenario creates a lead with POST /api/v1/leads (key with leads:write)."),
    api: tr("WhatsApp Business Cloud API (Meta). Needs a Meta Business account, a verified phone number and approved message templates."),
  },
  {
    channel: "instagram",
    name: tr("Instagram Direct"),
    outbound: tr("Reply to people who wrote to your business account first (24-hour window), from Make or n8n."),
    inbound: tr("New Direct messages and comments → the scenario creates a lead with source api and the Instagram handle in the message."),
    api: tr("Instagram Messaging API (Meta). Needs an Instagram professional account linked to a Facebook Page."),
  },
  {
    channel: "facebook",
    name: tr("Facebook Messenger"),
    outbound: tr("Answer Page conversations from a scenario triggered by NEXORA events."),
    inbound: tr("Page messages → lead via the API."),
    api: tr("Messenger Platform (Meta), connected to your Facebook Page."),
  },
  {
    channel: "viber",
    name: "Viber",
    outbound: tr("Send messages to users subscribed to your Viber bot."),
    inbound: tr("Bot webhook → lead via the API."),
    api: tr("Viber REST Bot API (a Viber bot account)."),
  },
  {
    channel: "vk",
    name: "VK",
    outbound: tr("Write from a community to users who allowed messages."),
    inbound: tr("Community Callback API → lead via the API."),
    api: tr("VK API for communities (community token)."),
  },
  {
    channel: "wechat",
    name: "WeChat",
    outbound: tr("Template messages from an Official Account."),
    inbound: tr("Official Account callback → lead via the API."),
    api: tr("WeChat Official Account API (verified account)."),
  },
];

export default async function MessengersPage() {
  await requirePermission("view", "integration");
  return (
    <div className="space-y-6">
      <Link href="/integrations" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />{tr("Integrations")}</Link>
      <PageHeader
        title={tr("Messengers and social")}
        description={tr("How customer messengers work with NEXORA: handles on every contact with one-click chat links, a native Telegram bot for team notifications, and automated customer messaging through Make or n8n with each platform's official API.")}
      />

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <h2 className="font-semibold">{tr("1. On every contact")}</h2>
          <p className="mt-1 text-sm text-text-muted">{tr("Telegram, WhatsApp, Viber, Instagram, Facebook, VK, LinkedIn and WeChat fields. Saved handles become \"Write\" links that open the chat. Works now, no setup.")}</p>
          <Link href="/contacts" className="mt-2 inline-block text-sm text-brand hover:underline">{tr("Open contacts")}</Link>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <h2 className="font-semibold">{tr("2. Telegram bot for the team")}</h2>
          <p className="mt-1 text-sm text-text-muted">{tr("Native: the Send to Telegram workflow step posts to your team chat. Needs a bot token and chat id in the server environment.")}</p>
          <Link href="/integrations/telegram" className="mt-2 inline-block text-sm text-brand hover:underline">{tr("Set up Telegram")}</Link>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <h2 className="font-semibold">{tr("3. Messaging customers automatically")}</h2>
          <p className="mt-1 text-sm text-text-muted">{tr("Through Make or n8n, which have ready-made modules for each platform and hold your platform credentials. NEXORA sends them signed events and accepts new leads through the API.")}</p>
          <div className="mt-2 flex gap-3 text-sm">
            <Link href="/integrations/make" className="text-brand hover:underline">{tr("Make")}</Link>
            <Link href="/integrations/n8n" className="text-brand hover:underline">
              n8n
            </Link>
          </div>
        </div>
      </section>

      <section aria-labelledby="channels" className="space-y-3">
        <h2 id="channels" className="text-md font-semibold">{tr("Channels")}</h2>
        <ul className="grid gap-3 md:grid-cols-2">
          {GUIDES.map((g) => (
            <li key={g.channel} className="rounded-xl border border-border bg-surface p-4 shadow-sm" data-testid={`messenger-guide-${g.channel}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2.5">
                  <MessengerMark channel={g.channel} className="size-8 text-xs" />
                  <span className="font-medium">{g.name}</span>
                </span>
                <span className="rounded-full border border-border px-2 py-0.5 text-xs text-text-muted">{tr("Via Make / n8n")}</span>
              </div>
              <dl className="mt-3 space-y-2 text-sm">
                <div>
                  <dt className="text-xs font-medium text-text-muted">{tr("Send from NEXORA events")}</dt>
                  <dd>{g.outbound}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-text-muted">{tr("Incoming messages")}</dt>
                  <dd>{g.inbound}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-text-muted">{tr("Platform requirement")}</dt>
                  <dd className="text-text-subtle">{g.api}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
        <p className="text-xs text-text-muted">{tr("NEXORA does not store tokens for these platforms: they stay in your Make or n8n account. Nothing is shown as connected here because the connection lives in the external scenario; check its run history there.")}</p>
      </section>
    </div>
  );
}
