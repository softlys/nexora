import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/patterns/page-header";
import { StatusBadge } from "@/components/patterns/status-badge";
import { can } from "@/domain/permissions";
import { STATUS_HINTS, STATUS_LABELS } from "@/domain/integrations/status";
import { formatDate } from "@/lib/format";
import { requirePermission } from "@/server/guards";
import { loadPage } from "@/server/page-data";
import { listIntegrations } from "@/server/services/integrations";
import { EmailTest } from "./email-test";
import { tr } from "@/lib/i18n";

export const metadata = { title: tr("Email provider") };

export default async function EmailProviderPage() {
  const { user } = await requirePermission("view", "integration");
  const { email } = await loadPage((ctx) => listIntegrations(ctx));
  const canManage = can(user.actor, "manage", "integration");
  return (
    <div className="space-y-6">
      <Link href="/integrations" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />{tr("Integrations")}</Link>
      <PageHeader title={tr("Email provider")} description={tr("Delivers the Send email step of Automation Studio workflows. Configured with environment variables, never in the browser.")} />
      <section className="space-y-4 rounded-lg border border-border bg-surface p-5 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-md font-semibold">{tr("Status")}</h2>
            <p className="text-sm text-text-muted">{email.status === "not_configured" ? tr("RESEND_API_KEY and NEXORA_EMAIL_FROM are not set.") : STATUS_HINTS[email.status]}</p>
          </div>
          <StatusBadge status={email.status} label={STATUS_LABELS[email.status]} dot />
        </div>
        {email.last_tested_at && <p className="text-xs text-text-muted">{tr("Last test")} {formatDate(email.last_tested_at)}</p>}
        {email.status === "error" && email.last_error && (
          <p role="alert" className="rounded-md border border-danger-border bg-danger-bg p-3 text-sm text-danger">
            {email.last_error}
          </p>
        )}
        {email.status === "not_configured" ? (
          <div className="space-y-2 text-sm">
            <p>{tr("To enable email:")}</p>
            <ol className="list-decimal space-y-1 pl-5 text-text-muted">
              <li>{tr("Create an API key at Resend and verify a sending domain.")}</li>
              <li>{tr("Set")} <code className="font-mono text-xs">{tr("RESEND_API_KEY")}</code> {tr("and")} <code className="font-mono text-xs">{tr("NEXORA_EMAIL_FROM")}</code> {tr("(for example")} <code className="font-mono text-xs">{tr("NEXORA <crm@your-domain>")}</code>{tr(") in the server environment and restart.")}</li>
              <li>{tr("Come back here and send a test email.")}</li>
            </ol>
            <p className="text-text-muted">{tr("Until then, Send email steps are recorded as skipped (email not configured), never as sent. SMTP is not supported in this release.")}</p>
          </div>
        ) : (
          <>
            <p className="text-sm">{tr("Provider: Resend · From:")} <span className="font-mono text-xs">{email.from}</span>
            </p>
            {canManage ? <EmailTest defaultTo={user.profile.email} /> : <p className="text-xs text-text-muted">{tr("Only admins can send a test email.")}</p>}
          </>
        )}
      </section>
    </div>
  );
}
