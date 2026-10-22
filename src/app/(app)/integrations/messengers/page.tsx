import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { MessengerMark } from "@/components/crm/messenger-links";
import { PageHeader } from "@/components/patterns/page-header";
import type { MessengerChannel } from "@/lib/messengers";
import { requirePermission } from "@/server/guards";

export const metadata = { title: "Messengers and social" };

type Guide = { channel: MessengerChannel; name: string; outbound: string; inbound: string; api: string };

const GUIDES: Guide[] = [
  {
    channel: "whatsapp",
    name: "WhatsApp",
    outbound: "Send template messages through the WhatsApp Business Cloud API from a Make or n8n scenario that receives NEXORA events (for example deal.won → order confirmation).",
    inbound: "Incoming messages arrive at the scenario's Meta webhook; the scenario creates a lead with POST /api/v1/leads (key with leads:write).",
    api: "WhatsApp Business Cloud API (Meta). Needs a Meta Business account, a verified phone number and approved message templates.",
  },
  {
    channel: "instagram",
    name: "Instagram Direct",
    outbound: "Reply to people who wrote to your business account first (24-hour window), from Make or n8n.",
    inbound: "New Direct messages and comments → the scenario creates a lead with source api and the Instagram handle in the message.",
    api: "Instagram Messaging API (Meta). Needs an Instagram professional account linked to a Facebook Page.",
  },
  {
    channel: "facebook",
    name: "Facebook Messenger",
    outbound: "Answer Page conversations from a scenario triggered by NEXORA events.",
    inbound: "Page messages → lead via the API.",
    api: "Messenger Platform (Meta), connected to your Facebook Page.",
  },
  {
    channel: "viber",
    name: "Viber",
    outbound: "Send messages to users subscribed to your Viber bot.",
    inbound: "Bot webhook → lead via the API.",
    api: "Viber REST Bot API (a Viber bot account).",
  },
  {
    channel: "vk",
    name: "VK",
    outbound: "Write from a community to users who allowed messages.",
    inbound: "Community Callback API → lead via the API.",
    api: "VK API for communities (community token).",
  },
  {
    channel: "wechat",
    name: "WeChat",
    outbound: "Template messages from an Official Account.",
    inbound: "Official Account callback → lead via the API.",
    api: "WeChat Official Account API (verified account).",
  },
];

export default async function MessengersPage() {
  await requirePermission("view", "integration");
  return (
    <div className="space-y-6">
      <Link href="/integrations" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        Integrations
      </Link>
      <PageHeader
        title="Messengers and social"
        description="How customer messengers work with NEXORA: handles on every contact with one-click chat links, a native Telegram bot for team notifications, and automated customer messaging through Make or n8n with each platform's official API."
      />

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <h2 className="font-semibold">1. On every contact</h2>
          <p className="mt-1 text-sm text-text-muted">
            Telegram, WhatsApp, Viber, Instagram, Facebook, VK, LinkedIn and WeChat fields. Saved handles become &quot;Write&quot; links that open the chat. Works now, no setup.
          </p>
          <Link href="/contacts" className="mt-2 inline-block text-sm text-brand hover:underline">
            Open contacts
          </Link>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <h2 className="font-semibold">2. Telegram bot for the team</h2>
          <p className="mt-1 text-sm text-text-muted">Native: the Send to Telegram workflow step posts to your team chat. Needs a bot token and chat id in the server environment.</p>
          <Link href="/integrations/telegram" className="mt-2 inline-block text-sm text-brand hover:underline">
            Set up Telegram
          </Link>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <h2 className="font-semibold">3. Messaging customers automatically</h2>
          <p className="mt-1 text-sm text-text-muted">
            Through Make or n8n, which have ready-made modules for each platform and hold your platform credentials. NEXORA sends them signed events and accepts new leads through the API.
          </p>
          <div className="mt-2 flex gap-3 text-sm">
            <Link href="/integrations/make" className="text-brand hover:underline">
              Make
            </Link>
            <Link href="/integrations/n8n" className="text-brand hover:underline">
              n8n
            </Link>
          </div>
        </div>
      </section>

      <section aria-labelledby="channels" className="space-y-3">
        <h2 id="channels" className="text-md font-semibold">
          Channels
        </h2>
        <ul className="grid gap-3 md:grid-cols-2">
          {GUIDES.map((g) => (
            <li key={g.channel} className="rounded-xl border border-border bg-surface p-4 shadow-sm" data-testid={`messenger-guide-${g.channel}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2.5">
                  <MessengerMark channel={g.channel} className="size-8 text-xs" />
                  <span className="font-medium">{g.name}</span>
                </span>
                <span className="rounded-full border border-border px-2 py-0.5 text-xs text-text-muted">Via Make / n8n</span>
              </div>
              <dl className="mt-3 space-y-2 text-sm">
                <div>
                  <dt className="text-xs font-medium text-text-muted">Send from NEXORA events</dt>
                  <dd>{g.outbound}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-text-muted">Incoming messages</dt>
                  <dd>{g.inbound}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-text-muted">Platform requirement</dt>
                  <dd className="text-text-subtle">{g.api}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
        <p className="text-xs text-text-muted">
          NEXORA does not store tokens for these platforms: they stay in your Make or n8n account. Nothing is shown as connected here because the connection lives in the external scenario; check its run history there.
        </p>
      </section>
    </div>
  );
}
