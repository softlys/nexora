import { ArrowLeft, Download } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/patterns/page-header";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { can } from "@/domain/permissions";
import { formatRelative } from "@/lib/format";
import { requirePermission } from "@/server/guards";
import { feedToken } from "@/server/integrations/calendar";
import { connectorCatalog } from "@/server/integrations/catalog";
import { jobStatus } from "@/server/integrations/jobs";
import { currentBaseUrl } from "@/server/integrations/public-url";
import { loadPage } from "@/server/page-data";
import { CopyField, ResetCalendarButton, SyncVaultButton } from "./connector-widgets";

const STATE_LABEL = { configured: "Configured", not_configured: "Not configured", error: "Misconfigured", available: "Available" } as const;

export async function generateMetadata({ params }: PageProps<"/integrations/[connector]">) {
  const { connector: id } = await params;
  const c = connectorCatalog().find((x) => x.id === id);
  return { title: c?.name ?? "Integration" };
}

export default async function ConnectorPage({ params }: PageProps<"/integrations/[connector]">) {
  const { user } = await requirePermission("view", "integration");
  const { connector: id } = await params;
  const connector = connectorCatalog().find((c) => c.id === id);
  if (!connector) notFound();
  const isAdmin = can(user.actor, "manage", "integration");
  const base = await currentBaseUrl();
  const { jobs, calendarUrl } = await loadPage(async (ctx) => ({
    jobs: connector.job ? await jobStatus(ctx) : {},
    calendarUrl: connector.id === "calendar" ? `${base}/api/calendar/${await feedToken(ctx)}.ics` : null,
  }));
  const job = connector.job ? jobs[connector.job] : undefined;

  return (
    <div className="space-y-6">
      <Link href="/integrations" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        Integrations
      </Link>
      <PageHeader title={connector.name} description={connector.summary} />

      <section className="space-y-3 rounded-xl border border-border bg-surface p-5 shadow-sm" data-testid="connector-status">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-md font-semibold">Status</h2>
            <p className="text-sm text-text-muted">{connector.detail}</p>
            {job && (
              <p className={`mt-1 text-xs ${job.ok ? "text-text-muted" : "text-danger"}`}>
                Last run {formatRelative(job.ran_at)}: {job.detail}
              </p>
            )}
          </div>
          <StatusBadge status={connector.state === "available" ? "configured" : connector.state} label={STATE_LABEL[connector.state]} dot />
        </div>

        {connector.id === "obsidian" && (
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              {/* A file download from a route handler, not a page: a plain link, not client navigation. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/export/obsidian" data-testid="obsidian-download">
                <Download aria-hidden />
                Download Obsidian vault
              </a>
            </Button>
          </div>
        )}
        {connector.id === "yandex_disk" && connector.state === "configured" && isAdmin && <SyncVaultButton />}
        {calendarUrl && (
          <div className="space-y-2" data-testid="calendar-feed">
            <p className="text-sm font-medium">Your personal calendar link</p>
            <CopyField value={calendarUrl} label="calendar link" />
            <p className="text-xs text-text-muted">Anyone with this link sees your task titles and deal names; keep it private.</p>
            <ResetCalendarButton />
          </div>
        )}
      </section>

      {connector.endpoints && connector.endpoints.length > 0 && (
        <section className="space-y-3 rounded-xl border border-border bg-surface p-5 shadow-sm">
          <h2 className="text-md font-semibold">Addresses to paste into the service</h2>
          {connector.endpoints.map((e) =>
            e.secret && !isAdmin ? (
              <p key={e.label} className="text-sm text-text-muted">
                {e.label}: only admins can see this address, because it contains a secret.
              </p>
            ) : (
              <div key={e.label} className="space-y-1">
                <p className="text-xs text-text-muted">{e.label}</p>
                <CopyField value={`${base}${e.path}`} label={e.label} />
              </div>
            ),
          )}
          {base.startsWith("http://") && <p className="text-xs text-warning">Services need a public https address. Run NEXORA behind HTTPS and set NEXORA_PUBLIC_URL.</p>}
        </section>
      )}

      <section className="space-y-3 rounded-xl border border-border bg-surface p-5 shadow-sm">
        <h2 className="text-md font-semibold">Set up</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          {connector.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </section>

      {connector.env.length > 0 && (
        <section className="space-y-3 rounded-xl border border-border bg-surface p-5 shadow-sm">
          <h2 className="text-md font-semibold">Server settings</h2>
          <p className="text-xs text-text-muted">Environment variables on the server (deploy/.env, Vercel → Environment Variables, or .env.local). Secrets never reach the browser or the database; restart after changing them.</p>
          <div className="relative overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {connector.env.map((v) => (
                  <tr key={v.name} className="border-b border-border last:border-0 align-top">
                    <td className="py-2 pr-3 font-mono text-xs whitespace-nowrap">{v.name}</td>
                    <td className="py-2 pr-3 text-xs whitespace-nowrap">{process.env[v.name]?.trim() ? <span className="text-success">set</span> : v.required ? <span className="text-warning">required</span> : <span className="text-text-muted">optional</span>}</td>
                    <td className="py-2 text-xs text-text-muted">{v.hint}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
