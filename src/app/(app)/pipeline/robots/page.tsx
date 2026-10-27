import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/patterns/page-header";
import { PipelineTabs } from "@/components/crm/pipeline-tabs";
import { first } from "@/domain/list";
import { can } from "@/domain/permissions";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { robotBoard } from "@/server/automation/robots";
import { requirePermission } from "@/server/guards";
import { loadPage } from "@/server/page-data";
import { AddRobotButton, RobotCard } from "./robot-controls";

export const metadata = { title: tr("Robots") };

/** The robots on each stage of a pipeline: what NEXORA does by itself when a deal enters the stage. */
export default async function RobotsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user } = await requirePermission("view", "automation");
  const params = await searchParams;
  const board = await loadPage((ctx) => robotBoard(ctx, first(params.pipeline)));
  const canManage = can(user.actor, "create", "automation");
  const pipelines = board.pipelines.map((p) => ({ ...p, organization_id: "", position: 0, created_at: "", updated_at: "", archived_at: null }));

  return (
    <div className="space-y-5">
      <Link href={`/pipeline?pipeline=${board.pipeline.id}`} className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        {tr("Sales Pipeline")}
      </Link>
      <PageHeader title={tr("Robots")} description={tr("Actions NEXORA takes by itself when a deal enters a stage: tasks, notifications, messages to the customer and the team.")} />
      <PipelineTabs pipelines={pipelines} current={board.pipeline.id} path="/pipeline/robots" params={params} />
      <div className="flex gap-3 overflow-x-auto pb-2" data-testid="robot-board">
        {board.stages.map((s) => (
          <section key={s.id} className="w-64 shrink-0 space-y-2 rounded-lg border border-border bg-surface-subtle p-2" data-testid={`robot-stage-${s.name}`}>
            <h2 className={cn("px-1 text-sm font-medium", s.is_won && "text-success", s.is_lost && "text-text-muted")}>{tr(s.name)}</h2>
            {s.robots.map((r) => (
              <RobotCard key={r.id} robot={r} canManage={canManage} />
            ))}
            {canManage && <AddRobotButton stageId={s.id} stageName={tr(s.name)} />}
          </section>
        ))}
      </div>
    </div>
  );
}
