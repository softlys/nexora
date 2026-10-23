import { Target } from "lucide-react";
import Link from "next/link";
import { LeadFormButton } from "@/components/crm/lead-form";
import { ListTable } from "@/components/list/list-table";
import { ListToolbar } from "@/components/list/list-toolbar";
import { EmptyState } from "@/components/patterns/empty-state";
import { PageHeader } from "@/components/patterns/page-header";
import { humanizeStatus, StatusBadge } from "@/components/patterns/status-badge";
import { LEAD_QUALIFICATIONS, LEAD_SOURCES, LEAD_STATUSES } from "@/domain/entities";
import { enumFilter, parseListQuery, stringFilter, first } from "@/domain/list";
import { formatDate, formatMoney } from "@/lib/format";
import { requirePermission } from "@/server/guards";
import { loadPage, peopleFor, permissionsFor } from "@/server/page-data";
import { listLeads } from "@/server/services/leads";
import { ExportButton } from "@/components/list/export-import";

export const metadata = { title: "Leads" };

export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  await requirePermission("view", "lead");
  const params = await searchParams;
  const query = parseListQuery(params);
  const filters = {
    status: enumFilter(params, "status", LEAD_STATUSES),
    source: enumFilter(params, "source", LEAD_SOURCES),
    qualification: enumFilter(params, "qualification", LEAD_QUALIFICATIONS),
    owner: stringFilter(params, "owner", 36),
  };
const exportQuery = new URLSearchParams(Object.entries(params).flatMap(([k, v]) => (typeof v === "string" && k !== "page" && k !== "new" ? [[k, v]] : []))).toString();
  const { page, people, perms } = await loadPage(async (ctx) => ({
    page: await listLeads(ctx, query, filters),
    people: await peopleFor(ctx, "lead"),
    perms: permissionsFor(ctx, "lead"),
  }));
  const filtered = Boolean(query.q || Object.values(filters).some(Boolean) || query.archived === "1");

  return (
    <div className="space-y-5">
      <PageHeader title="Leads" description="Interest that is not a deal yet. Qualify it, then convert it into a deal." actions={
          <>
            <ExportButton entity="leads" query={exportQuery} />
            {perms.canCreate && <LeadFormButton owners={people.assignable} autoOpen={first(params.new) === "1"} />}
          </>
        }
      />
      <ListToolbar
        searchPlaceholder="Search leads…"
        filters={[
          { key: "status", label: "Statuses", options: LEAD_STATUSES.map((s) => ({ value: s, label: humanizeStatus(s) })) },
          { key: "source", label: "Sources", options: LEAD_SOURCES.map((s) => ({ value: s, label: humanizeStatus(s) })) },
          { key: "qualification", label: "Qualification", options: LEAD_QUALIFICATIONS.map((s) => ({ value: s, label: humanizeStatus(s) })) },
          ...(people.assignable.length > 1 ? [{ key: "owner", label: "Owners", options: people.assignable }] : []),
        ]}
      />
      <ListTable
        caption="Leads"
        basePath="/leads"
        params={params}
        {...page}
        rowKey={(l) => l.id}
        rowHref={(l) => `/leads/${l.id}`}
        columns={[
          {
            id: "title",
            header: "Lead",
            sort: "title",
            cell: (l) => (
              <div className="min-w-0">
                <Link href={`/leads/${l.id}`} className="font-medium hover:underline">
                  {l.title}
                </Link>
                <div className="truncate text-xs text-text-muted">
                  {l.company_name} · {l.contact_name}
                </div>
              </div>
            ),
          },
          { id: "status", header: "Status", sort: "status", cell: (l) => <StatusBadge status={l.status} /> },
          { id: "qualification", header: "Qualification", hideBelow: "lg", cell: (l) => <StatusBadge label={humanizeStatus(l.qualification)} tone={l.qualification === "hot" ? "danger" : l.qualification === "warm" ? "warning" : "neutral"} /> },
          { id: "source", header: "Source", hideBelow: "lg", cell: (l) => <span className="text-text-subtle">{humanizeStatus(l.source)}</span> },
          { id: "value", header: "Est. value", sort: "value", align: "right", hideBelow: "sm", cell: (l) => formatMoney(l.estimated_value, l.currency) },
          { id: "next", header: "Next action", sort: "next", hideBelow: "md", cell: (l) => <span className="text-text-subtle">{l.next_action ? `${l.next_action}${l.next_action_at ? ` · ${formatDate(l.next_action_at)}` : ""}` : "—"}</span> },
          { id: "owner", header: "Owner", hideBelow: "md", cell: (l) => <span className="text-text-subtle">{l.owner_name ?? "Unassigned"}</span> },
        ]}
        empty={
          <EmptyState
            icon={Target}
            title={filtered ? "No leads match these filters" : "No leads yet"}
            description={filtered ? "Try a different search or clear the filters." : "Add a lead when someone shows interest."}
            action={!filtered && perms.canCreate ? <LeadFormButton owners={people.assignable} /> : undefined}
            className="m-4 border-0 bg-transparent"
          />
        }
      />
    </div>
  );
}
