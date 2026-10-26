import { PageHeader } from "@/components/patterns/page-header";
import { tr } from "@/lib/i18n";
import { requirePermission } from "@/server/guards";
import { getRepositories } from "@/server/repositories";
import { DeletePipelineButton, PipelineNameButton } from "./pipeline-actions";
import { PipelineEditor } from "./pipeline-editor";

export const metadata = { title: tr("Pipelines") };

/** Every pipeline with its stages; admins add pipelines, rename them and edit stages. */
export default async function PipelineSettingsPage({ searchParams }: PageProps<"/settings/pipeline">) {
  const { ctx } = await requirePermission("manage", "pipeline_stage");
  const repos = getRepositories();
  const [pipelines, stages, params] = await Promise.all([repos.pipelines.list(ctx), repos.pipelineStages.list(ctx), searchParams]);
  return (
    <div className="space-y-6">
      <PageHeader title={tr("Pipelines")} description={tr("Separate pipelines for different kinds of sales, each with its own stages. Deals can move between pipelines.")} actions={<PipelineNameButton />} />
      {pipelines.map((p, i) => (
        <PipelineEditor
          key={p.id}
          pipeline={{ id: p.id, name: p.name }}
          stages={stages.filter((s) => s.pipeline_id === p.id).map(({ id, name, probability, is_won, is_lost, position }) => ({ id, name, probability, is_won, is_lost, position }))}
          openNew={i === 0 && params.new === "1"}
          actions={
            <>
              <PipelineNameButton pipeline={{ id: p.id, name: p.name }} />
              {pipelines.length > 1 && <DeletePipelineButton pipeline={{ id: p.id, name: p.name }} />}
            </>
          }
        />
      ))}
    </div>
  );
}
