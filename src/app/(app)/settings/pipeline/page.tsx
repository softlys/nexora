import { requirePermission } from "@/server/guards";
import { getRepositories } from "@/server/repositories";
import { PipelineEditor } from "./pipeline-editor";
import { tr } from "@/lib/i18n";

export const metadata = { title: tr("Pipeline stages") };

export default async function PipelineSettingsPage({ searchParams }: PageProps<"/settings/pipeline">) {
  const { ctx } = await requirePermission("manage", "pipeline_stage");
  const [stages, params] = await Promise.all([getRepositories().pipelineStages.list(ctx), searchParams]);
  return (
    <PipelineEditor
      stages={stages.map(({ id, name, probability, is_won, is_lost, position }) => ({ id, name, probability, is_won, is_lost, position }))}
      openNew={params.new === "1"}
    />
  );
}
