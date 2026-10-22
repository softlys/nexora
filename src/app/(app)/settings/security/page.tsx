import { SettingsCard } from "@/components/patterns/form-field";
import { ListToolbar } from "@/components/list/list-toolbar";
import { enumFilter, first, stringFilter } from "@/domain/list";
import { SECURITY_CATEGORIES, SECURITY_OUTCOMES, SECURITY_SEVERITIES } from "@/domain/security/events";
import { requirePermission } from "@/server/guards";
import { loadPage } from "@/server/page-data";
import { listSecurityEvents, verifySecurityLog } from "@/server/services/security-log";
import { ChainStatus, SecurityEventsTable } from "./security-log-view";

export const metadata = { title: "Security log" };

export default async function SecurityLogPage({ searchParams }: PageProps<"/settings/security">) {
  await requirePermission("view", "audit_log");
  const params = await searchParams;
  const filters = {
    category: enumFilter(params, "category", SECURITY_CATEGORIES),
    severity: enumFilter(params, "severity", SECURITY_SEVERITIES),
    outcome: enumFilter(params, "outcome", SECURITY_OUTCOMES),
    action: stringFilter(params, "action", 64),
    q: first(params.q)?.slice(0, 100),
  };
  const { log, chain } = await loadPage(async (ctx) => ({ log: await listSecurityEvents(ctx, filters), chain: await verifySecurityLog(ctx) }));

  return (
    <SettingsCard
      title="Security log"
      description="Append-only and hash-chained: each event includes the hash of the previous one, so a modified or deleted event breaks verification. Secrets, passwords and full request bodies are never logged. The companion SIEM reads it through GET /api/v1/security-events with a SIEM key."
    >
      <div className="space-y-4">
        <ChainStatus initial={chain} recent={log.events.slice(0, 3).map((e) => ({ sequence: e.sequence, hash: e.hash, prev_hash: e.prev_hash }))} />
        <ListToolbar
          searchPlaceholder="Search action, target, IP…"
          showArchivedToggle={false}
          filters={[
            { key: "category", label: "Categories", options: SECURITY_CATEGORIES.map((c) => ({ value: c, label: c.replace("_", " ") })) },
            { key: "severity", label: "Severities", options: SECURITY_SEVERITIES.map((s) => ({ value: s, label: s })) },
            { key: "outcome", label: "Outcomes", options: SECURITY_OUTCOMES.map((o) => ({ value: o, label: o })) },
            { key: "action", label: "Actions", options: log.actions.map((a) => ({ value: a, label: a })) },
          ]}
        />
        <p className="text-xs text-text-muted">
          Showing {Math.min(log.total, log.events.length)} of {log.total} events.
        </p>
        <SecurityEventsTable events={log.events} />
      </div>
    </SettingsCard>
  );
}
