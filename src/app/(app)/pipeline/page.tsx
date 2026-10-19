import { KanbanSquare, Table2 } from "lucide-react";
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
import { getPipelineBoard, listDeals } from "@/server/services/deals";
import { PipelineBoard } from "./pipeline-board";

export const metadata = { title: "Sales Pipeline" };

export default async function PipelinePage({ searchParams }: PageProps<"/pipeline">) {
  const { user } = await requirePermission("view", "deal");
  const params = await searchParams;
  const view = first(params.view) === "table" ? "table" : "board";
  const filters = parseDealFilters(params);
  const query = parseListQuery(params);
  const { board, table, people, perms, options } = await loadPage(async (ctx) => ({
    board: view === "board" ? await getPipelineBoard(ctx, { ...filters, q: query.q }) : null,
    table: view === "table" ? await listDeals(ctx, query, filters) : null,
    people: await peopleFor(ctx, "deal"),
    perms: permissionsFor(ctx, "deal"),
    options: await dealFormOptions(ctx),
  }));
  const stages = board?.stages ?? table!.stages;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Sales Pipeline"
        description="Drag deals between stages. Totals and the weighted forecast update as you go."
        actions={
          <>
            <div className="flex rounded-md border border-border p-0.5" role="group" aria-label="View">
              {(["board", "table"] as const).map((v) => (
                <Link
                  key={v}
                  href={hrefWith("/pipeline", params, { view: v === "board" ? null : v, page: null })}
                  aria-current={view === v ? "page" : undefined}
                  className={cn("flex items-center gap-1.5 rounded px-2 py-1 text-sm", view === v ? "bg-surface-muted font-medium text-foreground" : "text-text-muted hover:text-foreground")}
                >
                  {v === "board" ? <KanbanSquare className="size-4" aria-hidden /> : <Table2 className="size-4" aria-hidden />}
                  {v === "board" ? "Board" : "Table"}
                </Link>
              ))}
            </div>
            {perms.canCreate && <DealFormButton options={options} />}
          </>
        }
      />
      <ListToolbar
        searchPlaceholder="Search deals…"
        showArchivedToggle={false}
        filters={[
          { key: "stage", label: "Stages", options: stages.map((s) => ({ value: s.id, label: s.name })) },
          ...(people.assignable.length > 1 ? [{ key: "owner", label: "Owners", options: people.assignable }] : []),
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
          caption="Deals in the pipeline"
          basePath="/pipeline"
          params={params}
          {...table}
          rowKey={(d) => d.id}
          rowHref={(d) => `/deals/${d.id}`}
          columns={[
            { id: "name", header: "Deal", sort: "name", cell: (d) => <span className="font-medium">{d.name}</span> },
            { id: "company", header: "Company", sort: "company", hideBelow: "md", cell: (d) => <span className="text-text-subtle">{d.company_name}</span> },
            { id: "stage", header: "Stage", sort: "stage", cell: (d) => <StatusBadge label={d.stage_name} tone={d.is_won ? "success" : d.is_lost ? "neutral" : "accent"} /> },
            { id: "amount", header: "Amount", sort: "amount", align: "right", cell: (d) => formatMoney(d.amount, d.currency) },
            { id: "weighted", header: "Weighted", align: "right", hideBelow: "lg", cell: (d) => formatMoney((d.amount * d.probability) / 100, d.currency) },
            { id: "close", header: "Close", sort: "close", hideBelow: "sm", cell: (d) => <span className="text-text-subtle">{formatDate(d.expected_close_date)}</span> },
            { id: "days", header: "Days in stage", align: "right", hideBelow: "lg", cell: (d) => d.days_in_stage },
            { id: "owner", header: "Owner", sort: "owner", hideBelow: "md", cell: (d) => <span className="text-text-subtle">{d.owner_name}</span> },
          ]}
          empty={<EmptyState title="No deals match these filters" description="Try a different search or clear the filters." className="m-4 border-0 bg-transparent" />}
        />
      )}
    </div>
  );
}
