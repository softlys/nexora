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

export const metadata = { title: "Deals" };

export default async function DealsPage({ searchParams }: PageProps<"/deals">) {
  const { user } = await requirePermission("view", "deal");
  const params = await searchParams;
  const query = parseListQuery(params);
  const filters = parseDealFilters(params);
  const { page, people, perms, options } = await loadPage(async (ctx) => ({
    page: await listDeals(ctx, query, filters),
    people: await peopleFor(ctx, "deal"),
    perms: permissionsFor(ctx, "deal"),
    options: await dealFormOptions(ctx),
  }));
  const filtered = Boolean(query.q || Object.values(filters).some((v) => v !== undefined) || query.archived === "1");
  const stageOptions = page.stages.map((s) => ({ id: s.id, name: s.name, is_won: s.is_won, is_lost: s.is_lost }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Deals"
        description="Every opportunity, from qualification to won or lost."
        actions={
          <>
            <Link href="/pipeline" className="text-sm text-brand hover:underline">
              Open pipeline board
            </Link>
            {perms.canCreate && <DealFormButton options={options} autoOpen={first(params.new) === "1"} />}
          </>
        }
      />
      <ListToolbar
        searchPlaceholder="Search deals…"
        filters={[
          { key: "status", label: "Statuses", options: [{ value: "open", label: "Open" }, { value: "won", label: "Won" }, { value: "lost", label: "Lost" }] },
          { key: "stage", label: "Stages", options: page.stages.map((s) => ({ value: s.id, label: s.name })) },
          ...(people.assignable.length > 1 ? [{ key: "owner", label: "Owners", options: people.assignable }] : []),
        ]}
      >
        <RangeFilters />
      </ListToolbar>
      <ListTable
        caption="Deals"
        basePath="/deals"
        params={params}
        {...page}
        rowKey={(d) => d.id}
        rowHref={(d) => `/deals/${d.id}`}
        columns={[
          {
            id: "name",
            header: "Deal",
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
          { id: "stage", header: "Stage", sort: "stage", cell: (d) => <StatusBadge label={d.stage_name} tone={d.is_won ? "success" : d.is_lost ? "neutral" : "accent"} /> },
          { id: "amount", header: "Amount", sort: "amount", align: "right", cell: (d) => formatMoney(d.amount, d.currency) },
          { id: "probability", header: "Prob.", align: "right", hideBelow: "lg", cell: (d) => `${d.probability}%` },
          { id: "close", header: "Close date", sort: "close", hideBelow: "md", cell: (d) => <span className="text-text-subtle">{formatDate(d.expected_close_date)}</span> },
          { id: "owner", header: "Owner", sort: "owner", hideBelow: "md", cell: (d) => <span className="text-text-subtle">{d.owner_name}</span> },
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
            title={filtered ? "No deals match these filters" : "No deals yet"}
            description={filtered ? "Try a different search or clear the filters." : "Create a deal or convert a qualified lead."}
            action={!filtered && perms.canCreate ? <DealFormButton options={options} /> : undefined}
            className="m-4 border-0 bg-transparent"
          />
        }
      />
    </div>
  );
}
