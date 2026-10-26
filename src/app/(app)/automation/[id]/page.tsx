import { DetailHeader } from "@/components/crm/detail";
import { validateDefinition } from "@/domain/automation/logic";
import type { TriggerEntity } from "@/domain/automation/schema";
import { EXECUTION_STATUSES } from "@/domain/entities";
import { enumFilter, first } from "@/domain/list";
import { can } from "@/domain/permissions";
import { formatPercent } from "@/lib/format";
import { getWorkflow } from "@/server/automation/workflows";
import { requirePermission } from "@/server/guards";
import { loadPage } from "@/server/page-data";
import { findVisible, type ServiceContext } from "@/server/services/context";
import { WorkflowCanvas } from "@/components/crm/workflow-canvas";
import { RunHistory } from "./run-history";
import { WorkflowEditor } from "./workflow-editor";
import { tr, trNode } from "@/lib/i18n";

async function testRecordOptions(ctx: ServiceContext, entity: TriggerEntity) {
  return ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const label = (r: Record<string, unknown>) => String(r.name ?? r.title ?? r.order_number ?? r.id);
    const pick = async () => {
      switch (entity) {
        case "lead":
          return findVisible(tx, ctx, "leads", "lead", (r) => r.owner_id, { archived_at: null });
        case "deal":
          return findVisible(tx, ctx, "deals", "deal", (r) => r.owner_id, { archived_at: null });
        case "task":
          return findVisible(tx, ctx, "tasks", "task", (r) => r.assignee_id, { archived_at: null });
        case "company":
          return findVisible(tx, ctx, "companies", "company", (r) => r.owner_id, { archived_at: null });
        case "order":
          return findVisible(tx, ctx, "orders", "order", (r) => r.owner_id, { archived_at: null });
      }
    };
    const rows = (await pick()) as unknown as Array<Record<string, unknown> & { id: string; created_at: string }>;
    return rows
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 50)
      .map((r) => ({ value: r.id, label: label(r) }));
  });
}

export default async function WorkflowPage({ params, searchParams }: PageProps<"/automation/[id]">) {
  const { user } = await requirePermission("view", "automation");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const filters = { status: enumFilter(sp, "status", EXECUTION_STATUSES), mode: enumFilter(sp, "mode", ["live", "test"] as const) };
  const { data, reps, testRecords, definition } = await loadPage(async (ctx) => {
    const data = await getWorkflow(ctx, id, filters);
    const parsed = validateDefinition(data.workflow.definition);
    const entity = parsed.ok ? parsed.definition.trigger.entity : "lead";
    const reps = await ctx.db.read(ctx.actor.organization_id, async (tx) =>
      (await tx.find("profiles")).filter((p) => p.role === "sales_rep" && p.is_active && !p.archived_at).map((p) => ({ value: p.id, label: p.full_name })),
    );
    return { data, reps, testRecords: await testRecordOptions(ctx, entity), definition: parsed.ok ? parsed.definition : null };
  });
  const { workflow, stats, executions } = data;

  return (
    <div className="space-y-6">
      <DetailHeader
        back={{ href: "/automation", label: tr("Automation Studio") }}
        path={`/automation/${workflow.id}`}
        title={workflow.name}
        subtitle={workflow.description || undefined}
      />
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          [tr("Runs"), String(stats.runs)],
          [tr("Success rate"), stats.success_rate === null ? "—" : formatPercent(stats.success_rate)],
          [tr("Failed"), String(stats.failed)],
          [tr("Skipped"), String(stats.skipped)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-border bg-surface p-3">
            <dt className="text-xs text-text-muted">{trNode(label)}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {definition && <WorkflowCanvas definition={definition} />}
      <WorkflowEditor
        key={`${workflow.id}-${workflow.version}`}
        workflow={{ id: workflow.id, name: workflow.name, description: workflow.description, enabled: workflow.enabled, version: workflow.version, definition: workflow.definition }}
        canEdit={can(user.actor, "update", "automation")}
        canManage={can(user.actor, "manage", "automation")}
        reps={reps}
        testRecords={testRecords}
        startEditing={first(sp.edit) === "1"}
      />
      <RunHistory executions={executions} canRetry={can(user.actor, "update", "automation")} />
    </div>
  );
}
