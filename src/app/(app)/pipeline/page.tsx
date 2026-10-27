import { Bot, KanbanSquare, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { DealFormButton } from "@/components/crm/deal-form";
import { ListTable } from "@/components/list/list-table";
import { ListToolbar } from "@/components/list/list-toolbar";
import { RangeFilters } from "@/components/list/range-filters";
import { EmptyState } from "@/components/patterns/empty-state";
import { PageHeader } from "@/components/patterns/page-header";
import { StatusBadge } from "@/components/patterns/status-badge";
import { can } from "@/domain/permissions";
import { first, parseListQuery } from "@/domain/list";
import { formatDate, formatMoney } from "@/lib/format";
import { hrefWith } from "@/lib/url";
import { cn } from "@/lib/utils";
import { parseDealFilters } from "@/server/deal-filters";
import { requirePermission } from "@/server/guards";
import { dealFormOptions, loadPage, peopleFor, permissionsFor } from "@/server/page-data";
import { getPipelineBoard, listDeals, pipelineOptions } from "@/server/services/deals";
import { PipelineTabs } from "@/components/crm/pipeline-tabs";
import { PipelineBoard } from "./pipeline-board";
import { tr } from "@/lib/i18n";

export const metadata = { title: tr("Sales Pipeline") };

export default async function PipelinePage({ searchParams }: PageProps<"/pipeline">) {
  const { user } = await requirePermission("view", "deal");
  const params = await searchParams;
  const view = first(params.view) === "table" ? "table" : "board";
  const filters = parseDealFilters(params);
  const query = parseListQuery(params);
  const { board, table, people, perms, options } = await loadPage(async (ctx) => ({
    board: view === "board" ? await getPipelineBoard(ctx, { ...filters, q: query.q }) : null,
    table: view === "table" ? await listDeals(ctx, query, { ...filters, pipeline: filters.pipeline ?? (await pipelineOptions(ctx))[0]?.id }) : null,
    people: await peopleFor(ctx, "deal"),
    perms: permissionsFor(ctx, "deal"),
    options: await dealFormOptions(ctx),
  }));
  const stages = board?.stages ?? table!.stages;
  const pipelines = board?.pipelines ?? table!.pipelines;
  const canAutomate = can(user.actor, "view", "automation");
  const currentPipeline = board?.pipeline.id ?? filters.pipeline ?? pipelines[0]?.id ?? null;

  return (
    <div className="space-y-5">
      <PageHeader
        title={tr("Sales Pipeline")}
        description={tr("Drag deals between stages. Totals and the weighted forecast update as you go.")}
        actions={
          <>
            <div className="flex rounded-md border border-border p-0.5" role="group" aria-label={tr("View")}>
              {(["board", "table"] as const).map((v) => (
                <Link
                  key={v}
                  href={hrefWith("/pipeline", params, { view: v === "board" ? null : v, page: null })}
                  aria-current={view === v ? "page" : undefined}
                  className={cn("flex items-center gap-1.5 rounded px-2 py-1 text-sm", view === v ? "bg-surface-muted font-medium text-foreground" : "text-text-muted hover:text-foreground")}
                >
                  {v === "board" ? <KanbanSquare className="size-4" aria-hidden /> : <Table2 className="size-4" aria-hidden />}
                  {v === "board" ? tr("Board") : tr("Table")}
                </Link>
              ))}
            </div>
            {canAutomate && (
              <Button variant="outline" asChild>
                <Link href={`/pipeline/robots${currentPipeline ? `?pipeline=${currentPipeline}` : ""}`} data-testid="robots-link">
                  <Bot aria-hidden />
                  {tr("Robots")}
                </Link>
              </Button>
            )}
            {perms.canCreate && <DealFormButton options={options} defaultPipelineId={currentPipeline ?? undefined} />}
          </>
        }
      />
      <PipelineTabs pipelines={pipelines} current={currentPipeline} path="/pipeline" params={params} />
      <ListToolbar
        searchPlaceholder={tr("Search deals…")}
        showArchivedToggle={false}
        filters={[
          { key: "stage", label: tr("Stages"), options: stages.map((s) => ({ value: s.id, label: tr(s.name) })) },
          ...(people.assignable.length > 1 ? [{ key: "owner", label: tr("Owners"), options: people.assignable }] : []),
        ]}
      >
        <RangeFilters />
      </ListToolbar>

      {board && (
        <PipelineBoard
          stages={board.stages}
          deals={board.deals.map((d) => ({ ...d, can_edit: can(user.actor, "update", "deal", { organization_id: d.organization_id, owner_id: d.owner_id }) }))}
          options={options}
          currency={options.currency}
          durations={board.durations}
        />
      )}
      {table && (
        <ListTable
          caption={tr("Deals in the pipeline")}
          basePath="/pipeline"
          params={params}
          {...table}
          rowKey={(d) => d.id}
          rowHref={(d) => `/deals/${d.id}`}
          columns={[
            { id: "name", header: tr("Deal"), sort: "name", cell: (d) => <span className="font-medium">{d.name}</span> },
            { id: "company", header: tr("Company"), sort: "company", hideBelow: "md", cell: (d) => <span className="text-text-subtle">{d.company_name}</span> },
            { id: "stage", header: tr("Stage"), sort: "stage", cell: (d) => <StatusBadge label={d.stage_name} tone={d.is_won ? "success" : d.is_lost ? "neutral" : "accent"} /> },
            { id: "amount", header: tr("Amount"), sort: "amount", align: "right", cell: (d) => formatMoney(d.amount, d.currency) },
            { id: "weighted", header: tr("Weighted"), align: "right", hideBelow: "lg", cell: (d) => formatMoney((d.amount * d.probability) / 100, d.currency) },
            { id: "close", header: tr("Close"), sort: "close", hideBelow: "sm", cell: (d) => <span className="text-text-subtle">{formatDate(d.expected_close_date)}</span> },
            { id: "days", header: tr("Days in stage"), align: "right", hideBelow: "lg", cell: (d) => d.days_in_stage },
            { id: "owner", header: tr("Owner"), sort: "owner", hideBelow: "md", cell: (d) => <span className="text-text-subtle">{d.owner_name}</span> },
          ]}
          empty={<EmptyState title={tr("No deals match these filters")} description={tr("Try a different search or clear the filters.")} className="m-4 border-0 bg-transparent" />}
        />
      )}
    </div>
  );
}
