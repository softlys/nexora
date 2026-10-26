import { Workflow } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/patterns/empty-state";
import { PageHeader } from "@/components/patterns/page-header";
import { StatusBadge } from "@/components/patterns/status-badge";
import { TRIGGER_LABELS, type Trigger } from "@/domain/automation/schema";
import { can } from "@/domain/permissions";
import { formatPercent, formatRelative } from "@/lib/format";
import { listWorkflows } from "@/server/automation/workflows";
import { requirePermission } from "@/server/guards";
import { loadPage } from "@/server/page-data";
import { EnabledToggle, NewWorkflowMenu, RunSchedulerButton } from "./studio-controls";
import { tr } from "@/lib/i18n";

export const metadata = { title: tr("Automation Studio") };

export default async function AutomationPage() {
  const { user } = await requirePermission("view", "automation");
  const workflows = await loadPage((ctx) => listWorkflows(ctx));
  const canManage = can(user.actor, "manage", "automation");
  const canCreate = can(user.actor, "create", "automation");

  return (
    <div className="space-y-5">
      <PageHeader
        title={tr("Automation Studio")}
        description={tr("Workflows that react to CRM events: new records, stage changes and dates. They run on this server; nothing is sent to an external platform.")}
        actions={
          <>
            {canManage && <RunSchedulerButton />}
            {canCreate && <NewWorkflowMenu />}
          </>
        }
      />
      <p className="rounded-md border border-info-border bg-info-bg px-3 py-2 text-xs text-info">{tr("Date-based triggers and delays need the scheduler. Run it here, or call")} <code className="font-mono">{tr("POST /api/cron/scheduler")}</code> {tr("from a cron job with the")}{" "}
        <code className="font-mono">{tr("CRON_SECRET")}</code> {tr("header (see docs/automation-guide.md).")}</p>
      {workflows.length === 0 ? (
        <EmptyState icon={Workflow} title={tr("No workflows yet")} description={tr("Start from a template or a blank workflow.")} action={canCreate ? <NewWorkflowMenu /> : undefined} />
      ) : (
        <div className="relative overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <caption className="sr-only">{tr("Workflows")}</caption>
            <thead className="border-b border-border bg-surface-subtle text-xs text-text-muted">
              <tr>
                <th scope="col" className="h-9 px-3 text-left font-medium">{tr("Workflow")}</th>
                <th scope="col" className="h-9 px-3 text-left font-medium">{tr("Trigger")}</th>
                <th scope="col" className="h-9 px-3 text-left font-medium">{tr("Enabled")}</th>
                <th scope="col" className="hidden h-9 px-3 text-left font-medium md:table-cell">{tr("Last run")}</th>
                <th scope="col" className="hidden h-9 px-3 text-right font-medium sm:table-cell">{tr("Runs")}</th>
                <th scope="col" className="hidden h-9 px-3 text-right font-medium lg:table-cell">{tr("Success rate")}</th>
                <th scope="col" className="hidden h-9 px-3 text-right font-medium lg:table-cell">{tr("Errors")}</th>
              </tr>
            </thead>
            <tbody>
              {workflows.map((w) => {
                const trigger = (w.definition as { trigger?: Trigger }).trigger;
                return (
                  <tr key={w.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2.5">
                      <Link href={`/automation/${w.id}`} className="font-medium hover:underline">
                        {w.name}
                      </Link>
                      <p className="line-clamp-1 max-w-md text-xs text-text-muted">{w.description}</p>
                    </td>
                    <td className="px-3 py-2.5 text-text-subtle">
                      {trigger ? tr(TRIGGER_LABELS[trigger.type]) : w.trigger_type}
                      {trigger && <span className="text-text-muted"> · {trigger.entity}</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <EnabledToggle id={w.id} name={w.name} enabled={w.enabled} disabled={!canManage} />
                    </td>
                    <td className="hidden px-3 py-2.5 md:table-cell">
                      {w.stats.last_run_at ? (
                        <span className="flex items-center gap-2 text-text-subtle">
                          {w.stats.last_status && <StatusBadge status={w.stats.last_status} dot />}
                          {formatRelative(w.stats.last_run_at)}
                        </span>
                      ) : (
                        <span className="text-text-muted">{tr("Never")}</span>
                      )}
                    </td>
                    <td className="hidden px-3 py-2.5 text-right tabular-nums sm:table-cell">{w.stats.runs}</td>
                    <td className="hidden px-3 py-2.5 text-right tabular-nums lg:table-cell">{w.stats.success_rate === null ? "—" : formatPercent(w.stats.success_rate)}</td>
                    <td className="hidden px-3 py-2.5 text-right tabular-nums lg:table-cell">
                      <span className={w.stats.failed > 0 ? "text-danger" : "text-text-muted"}>{w.stats.failed}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
