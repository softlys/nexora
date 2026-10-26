import { Handshake } from "lucide-react";
import Link from "next/link";
import { DealPreviewButton } from "@/components/crm/deal-drawer";
import { DealFormButton } from "@/components/crm/deal-form";
import { ListTable } from "@/components/list/list-table";
import { ListToolbar } from "@/components/list/list-toolbar";
import { RangeFilters } from "@/components/list/range-filters";
import { EmptyState } from "@/components/patterns/empty-state";
import { PageHeader } from "@/components/patterns/page-header";
import { StatusBadge } from "@/components/patterns/status-badge";
import { can } from "@/domain/permissions";
import { parseListQuery, first } from "@/domain/list";
import { formatDate, formatMoney } from "@/lib/format";
import { parseDealFilters } from "@/server/deal-filters";
import { requirePermission } from "@/server/guards";
import { dealFormOptions, loadPage, peopleFor, permissionsFor } from "@/server/page-data";
import { listDeals } from "@/server/services/deals";
import { ExportButton } from "@/components/list/export-import";
import { tr } from "@/lib/i18n";
import { PipelineTabs } from "@/components/crm/pipeline-tabs";

export const metadata = { title: tr("Deals") };

export default async function DealsPage({ searchParams }: PageProps<"/deals">) {
  const { user } = await requirePermission("view", "deal");
  const params = await searchParams;
  const query = parseListQuery(params);
  const filters = parseDealFilters(params);
const exportQuery = new URLSearchParams(Object.entries(params).flatMap(([k, v]) => (typeof v === "string" && k !== "page" && k !== "new" ? [[k, v]] : []))).toString();
  const { page, people, perms, options } = await loadPage(async (ctx) => ({
    page: await listDeals(ctx, query, filters),
    people: await peopleFor(ctx, "deal"),
    perms: permissionsFor(ctx, "deal"),
    options: await dealFormOptions(ctx),
  }));
  const filtered = Boolean(query.q || Object.values(filters).some((v) => v !== undefined) || query.archived === "1");
  const pipelineName = new Map(page.pipelines.map((p) => [p.id, tr(p.name)]));
  // With every pipeline shown, stage names say which pipeline they belong to.
  const stageLabel = (s: { name: string; pipeline_id: string }) => (page.pipelines.length > 1 && !filters.pipeline ? `${pipelineName.get(s.pipeline_id) ?? ""} · ${tr(s.name)}` : tr(s.name));
  const stageOptions = page.stages.map((s) => ({ id: s.id, name: stageLabel(s), is_won: s.is_won, is_lost: s.is_lost }));

  return (
    <div className="space-y-5">
      <PageHeader
        title={tr("Deals")}
        description={tr("Every opportunity, from qualification to won or lost.")}
        actions={
          <>
            <Link href="/pipeline" className="text-sm text-brand hover:underline">{tr("Open pipeline board")}</Link>
            <ExportButton entity="deals" query={exportQuery} />
            {perms.canCreate && <DealFormButton options={options} defaultPipelineId={filters.pipeline} autoOpen={first(params.new) === "1"} />}
          </>
        }
      />
      <PipelineTabs pipelines={page.pipelines} current={filters.pipeline ?? null} path="/deals" params={params} all />
      <ListToolbar
        searchPlaceholder={tr("Search deals…")}
        filters={[
          { key: "status", label: tr("Statuses"), options: [{ value: "open", label: tr("Open") }, { value: "won", label: tr("Won") }, { value: "lost", label: tr("Lost") }] },
          { key: "stage", label: tr("Stages"), options: page.stages.map((s) => ({ value: s.id, label: stageLabel(s) })) },
          ...(people.assignable.length > 1 ? [{ key: "owner", label: tr("Owners"), options: people.assignable }] : []),
        ]}
      >
        <RangeFilters />
      </ListToolbar>
      <ListTable
        caption={tr("Deals")}
        basePath="/deals"
        params={params}
        {...page}
        rowKey={(d) => d.id}
        rowHref={(d) => `/deals/${d.id}`}
        columns={[
          {
            id: "name",
            header: tr("Deal"),
            sort: "name",
            cell: (d) => (
              <div className="min-w-0">
                <Link href={`/deals/${d.id}`} className="font-medium hover:underline">
                  {d.name}
                </Link>
                <div className="truncate text-xs text-text-muted">{d.company_name}</div>
              </div>
            ),
          },
          { id: "stage", header: tr("Stage"), sort: "stage", cell: (d) => <StatusBadge label={d.stage_name} tone={d.is_won ? "success" : d.is_lost ? "neutral" : "accent"} /> },
          { id: "amount", header: tr("Amount"), sort: "amount", align: "right", cell: (d) => formatMoney(d.amount, d.currency) },
          { id: "probability", header: tr("Prob."), align: "right", hideBelow: "lg", cell: (d) => `${d.probability}%` },
          {
            id: "close",
            header: tr("Close date"),
            sort: "close",
            hideBelow: "md",
            // Closed deals show when they actually closed; open deals their expected date.
            cell: (d) =>
              d.closed_at ? (
                <span className="text-text-subtle" title={tr("Closed")}>
                  {formatDate(d.closed_at)}
                </span>
              ) : (
                <span className="text-text-subtle" title={tr("Expected")}>
                  {formatDate(d.expected_close_date)}
                  {d.expected_close_date && <span className="ml-1 text-xs text-text-muted">exp.</span>}
                </span>
              ),
          },
          { id: "owner", header: tr("Owner"), sort: "owner", hideBelow: "md", cell: (d) => <span className="text-text-subtle">{d.owner_name}</span> },
          {
            id: "preview",
            header: "",
            align: "right",
            cell: (d) => (
              <DealPreviewButton
                deal={d}
                stages={stageOptions}
                options={options}
                canEdit={can(user.actor, "update", "deal", { organization_id: d.organization_id, owner_id: d.owner_id }) && !d.archived_at}
              />
            ),
          },
        ]}
        empty={
          <EmptyState
            icon={Handshake}
            title={filtered ? tr("No deals match these filters") : tr("No deals yet")}
            description={filtered ? tr("Try a different search or clear the filters.") : tr("Create a deal or convert a qualified lead.")}
            action={!filtered && perms.canCreate ? <DealFormButton options={options} /> : undefined}
            className="m-4 border-0 bg-transparent"
          />
        }
      />
    </div>
  );
}
