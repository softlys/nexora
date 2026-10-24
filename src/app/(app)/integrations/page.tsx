import { ArrowRight, BookOpen, KeyRound, Mail, TriangleAlert, Webhook, Workflow } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/patterns/page-header";
import { StatusBadge } from "@/components/patterns/status-badge";
import { can } from "@/domain/permissions";
import { PROVIDER_NAMES, PROVIDER_PATHS, STATUS_LABELS } from "@/domain/integrations/status";
import { formatRelative } from "@/lib/format";
import { requirePermission } from "@/server/guards";
import { loadPage } from "@/server/page-data";
import { listIntegrations } from "@/server/services/integrations";
import { telegramConfig } from "@/server/integrations/telegram";
import { connectorCatalog } from "@/server/integrations/catalog";
import { MessengerMark } from "@/components/crm/messenger-links";

export const metadata = { title: "Integrations" };

const DESCRIPTIONS = {
  make: "Visual scenarios in Make: receive NEXORA events through a custom webhook and call back the API.",
  n8n: "Self-hosted or cloud n8n workflows: receive signed events and call the NEXORA API.",
  generic_webhook: "Any HTTPS endpoint that accepts signed JSON events.",
  email: "Email for the Send email workflow step, through Resend (environment variables).",
} as const;

export default async function IntegrationsPage() {
  const { user } = await requirePermission("view", "integration");
  const data = await loadPage((ctx) => listIntegrations(ctx));
  const isAdmin = can(user.actor, "manage", "integration");
  const telegram = telegramConfig();
  const telegramStatus = { configured: Boolean(telegram.token && telegram.chat && !telegram.problem), chat: telegram.chat, problem: telegram.problem };
  const groups = Object.groupBy(connectorCatalog(), (c) => c.group);
  const overlaps = data.webhooks.flatMap((w) => w.overlaps.map((o) => ({ ...o, provider: w.provider })));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Integrations"
        description="Outbound webhooks signed with HMAC-SHA256, the public API, email, a Telegram bot and customer messengers. Nothing is shown as connected until a real test succeeded."
        actions={
          <>
            <Link href="/integrations/api" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-sm hover:bg-muted">
              <BookOpen className="size-4" aria-hidden />
              API reference
            </Link>
            {isAdmin && (
              <Link href="/settings/api-keys" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-sm hover:bg-muted">
                <KeyRound className="size-4" aria-hidden />
                API keys
              </Link>
            )}
          </>
        }
      />

      <section aria-label="Integrations" className="grid gap-3 md:grid-cols-2">
        {data.webhooks.map((w) => (
          <Link
            key={w.provider}
            href={PROVIDER_PATHS[w.provider]}
            className="group flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-xs transition-colors hover:border-border-strong hover:bg-surface-subtle focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
            data-testid={`integration-card-${w.provider}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="flex size-8 items-center justify-center rounded-md bg-surface-muted">
                  {w.provider === "generic_webhook" ? <Webhook className="size-4" aria-hidden /> : <Workflow className="size-4" aria-hidden />}
                </span>
                <h2 className="font-medium">{PROVIDER_NAMES[w.provider]}</h2>
              </div>
              <StatusBadge status={w.status} label={STATUS_LABELS[w.status]} dot />
            </div>
            <p className="text-sm text-text-muted">{DESCRIPTIONS[w.provider]}</p>
            <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
              {w.url ? <span className="truncate font-mono">{new URL(w.url).host}</span> : <span>No endpoint</span>}
              <span>{w.subscribed_events.length} events</span>
              {w.last_tested_at && <span>Tested {formatRelative(w.last_tested_at)}</span>}
              {(w.recent.success > 0 || w.recent.failed > 0) && (
                <span>
                  24 h: {w.recent.success} delivered, {w.recent.failed} failed
                </span>
              )}
              {!w.enabled && w.url && <span>Disabled</span>}
              <ArrowRight className="ml-auto size-4 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
            </div>
          </Link>
        ))}
        <Link
          href={PROVIDER_PATHS.email}
          className="group flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-xs transition-colors hover:border-border-strong hover:bg-surface-subtle focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
          data-testid="integration-card-email"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-md bg-surface-muted">
                <Mail className="size-4" aria-hidden />
              </span>
              <h2 className="font-medium">{PROVIDER_NAMES.email}</h2>
            </div>
            <StatusBadge status={data.email.status} label={STATUS_LABELS[data.email.status]} dot />
          </div>
          <p className="text-sm text-text-muted">{DESCRIPTIONS.email}</p>
          <p className="mt-auto text-xs text-text-muted">{data.email.provider ? `Resend, from ${data.email.from}` : "Without it, Send email steps are logged as skipped."}</p>
        </Link>
        <Link
          href="/integrations/telegram"
          className="group flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-xs transition-colors hover:border-border-strong hover:bg-surface-subtle focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
          data-testid="integration-card-telegram"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <MessengerMark channel="telegram" className="size-8 text-xs" />
              <h2 className="font-medium">Telegram bot</h2>
            </div>
            <StatusBadge status={telegramStatus.configured ? "configured" : telegramStatus.problem ? "error" : "not_configured"} label={telegramStatus.configured ? "Configured" : telegramStatus.problem ? "Misconfigured" : "Not configured"} dot />
          </div>
          <p className="text-sm text-text-muted">Team notifications in a Telegram chat: new leads, won deals, overdue tasks. Used by the Send to Telegram workflow step.</p>
          <p className="mt-auto text-xs text-text-muted">{telegramStatus.configured ? `Posts to ${telegramStatus.chat}` : "Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID."}</p>
        </Link>
        <Link
          href="/integrations/messengers"
          className="group flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-xs transition-colors hover:border-border-strong hover:bg-surface-subtle focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
          data-testid="integration-card-messengers"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex -space-x-1.5">
                {(["whatsapp", "instagram", "viber", "vk"] as const).map((c) => (
                  <MessengerMark key={c} channel={c} className="size-7 text-[10px] ring-2 ring-surface" />
                ))}
              </span>
              <h2 className="font-medium">Messengers and social</h2>
            </div>
            <span className="rounded-full border border-border px-2 py-0.5 text-xs text-text-muted">Contacts + Make / n8n</span>
          </div>
          <p className="text-sm text-text-muted">WhatsApp, Instagram, Viber, Facebook, VK, WeChat: chat links on every contact, and automated customer messaging through Make or n8n.</p>
          <p className="mt-auto text-xs text-text-muted">Handles are stored on contacts; platform credentials stay in your scenario.</p>
        </Link>
      </section>

      {Object.entries(groups).map(([group, items]) => (
        <section key={group} aria-labelledby={`group-${group}`} className="space-y-3">
          <h2 id={`group-${group}`} className="text-md font-semibold">
            {group}
          </h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {items.map((c) => (
              <Link
                key={c.id}
                href={`/integrations/${c.id}`}
                className="group flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 shadow-xs transition-colors hover:border-border-strong hover:bg-surface-subtle focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
                data-testid={`connector-card-${c.id}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-medium">{c.name}</h3>
                  <StatusBadge status={c.state === "available" ? "configured" : c.state} label={c.state === "available" ? "Available" : c.state === "configured" ? "Configured" : c.state === "error" ? "Misconfigured" : "Not configured"} dot />
                </div>
                <p className="text-sm text-text-muted">{c.summary}</p>
                <div className="mt-auto flex items-center gap-2 text-xs text-text-muted">
                  {c.russia && <span className="rounded-full border border-border px-2 py-0.5">Works in Russia</span>}
                  <ArrowRight className="ml-auto size-4 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}

      <section aria-labelledby="engines-heading" className="rounded-lg border border-border bg-surface p-5 shadow-xs">
        <h2 id="engines-heading" className="text-md font-semibold">
          Which engine runs what
        </h2>
        <div className="mt-3 grid gap-4 text-sm md:grid-cols-3">
          <div>
            <h3 className="font-medium">NEXORA Automation Studio</h3>
            <p className="mt-1 text-text-muted">Anything that changes NEXORA data: owner assignment, follow-up tasks, notifications, deal to order. Runs inside the app, idempotent per event, audited.</p>
          </div>
          <div>
            <h3 className="font-medium">Make</h3>
            <p className="mt-1 text-text-muted">Fan-out to SaaS tools with ready-made apps (Slack, Google Sheets, email). Receives events, may call back POST /api/v1/events.</p>
          </div>
          <div>
            <h3 className="font-medium">n8n</h3>
            <p className="mt-1 text-text-muted">Custom logic you host yourself: validation, branching, calls to internal systems, then the NEXORA API. Receives the same signed events.</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-text-muted">
          Rule of thumb: one action has one owner. If an external scenario creates tasks for an event, do not also create them in a NEXORA workflow. Receivers deduplicate by <code className="font-mono">event_id</code>; retries and redeliveries reuse it.
        </p>
        {overlaps.length > 0 && (
          <div role="status" className="mt-4 space-y-2 rounded-md border border-warning-border bg-warning-bg p-3 text-sm text-warning" data-testid="engine-overlap-warning">
            <p className="flex items-center gap-2 font-medium">
              <TriangleAlert className="size-4" aria-hidden />
              Events routed to an external platform are also handled by NEXORA workflows
            </p>
            <ul className="list-disc space-y-1 pl-6 text-xs">
              {overlaps.map((o) => (
                <li key={`${o.provider}-${o.event}-${o.workflow_id}`}>
                  <span className="font-mono">{o.event}</span> goes to {PROVIDER_NAMES[o.provider]}, and the workflow{" "}
                  <Link className="underline" href={`/automation/${o.workflow_id}`}>
                    {o.workflow_name}
                  </Link>{" "}
                  already runs on it ({o.actions.join(", ")}). Make sure the external scenario does not repeat those actions.
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
