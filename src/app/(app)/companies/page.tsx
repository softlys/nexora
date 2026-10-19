import { Building2 } from "lucide-react";
import Link from "next/link";
import { CompanyFormButton } from "@/components/crm/company-form";
import { ListTable } from "@/components/list/list-table";
import { ListToolbar } from "@/components/list/list-toolbar";
import { EmptyState } from "@/components/patterns/empty-state";
import { PageHeader } from "@/components/patterns/page-header";
import { humanizeStatus, StatusBadge } from "@/components/patterns/status-badge";
import { COMPANY_SIZES, LIFECYCLE_STAGES } from "@/domain/entities";
import { enumFilter, parseListQuery, stringFilter, first } from "@/domain/list";
import { countryName } from "@/lib/countries";
import { loadPage, peopleFor, permissionsFor } from "@/server/page-data";
import { requirePermission } from "@/server/guards";
import { listCompanies } from "@/server/services/companies";

export const metadata = { title: "Companies" };

export default async function CompaniesPage({ searchParams }: PageProps<"/companies">) {
  await requirePermission("view", "company");
  const params = await searchParams;
  const query = parseListQuery(params);
  const filters = {
    industry: stringFilter(params, "industry", 80),
    size: enumFilter(params, "size", COMPANY_SIZES),
    country: stringFilter(params, "country", 2),
    owner: stringFilter(params, "owner", 36),
    lifecycle: enumFilter(params, "lifecycle", LIFECYCLE_STAGES),
  };
  const { page, people, perms } = await loadPage(async (ctx) => ({
    page: await listCompanies(ctx, query, filters),
    people: await peopleFor(ctx, "company"),
    perms: permissionsFor(ctx, "company"),
  }));
  const filtered = Boolean(query.q || Object.values(filters).some(Boolean) || query.archived === "1");

  return (
    <div className="space-y-5">
      <PageHeader
        title="Companies"
        description="Accounts you sell to, with their contacts, deals, orders and history."
        actions={perms.canCreate && <CompanyFormButton owners={people.assignable} autoOpen={first(params.new) === "1"} />}
      />
      <ListToolbar
        searchPlaceholder="Search companies…"
        filters={[
          { key: "lifecycle", label: "Stages", options: LIFECYCLE_STAGES.map((s) => ({ value: s, label: humanizeStatus(s) })) },
          { key: "industry", label: "Industries", options: page.facets.industries.map((i) => ({ value: i, label: i })) },
          { key: "size", label: "Sizes", options: COMPANY_SIZES.map((s) => ({ value: s, label: `${s} employees` })) },
          { key: "country", label: "Countries", options: page.facets.countries.map((c) => ({ value: c, label: countryName(c) })) },
          ...(people.assignable.length > 1 ? [{ key: "owner", label: "Owners", options: people.assignable }] : []),
        ]}
      />
      <ListTable
        caption="Companies"
        basePath="/companies"
        params={params}
        {...page}
        rowKey={(c) => c.id}
        rowHref={(c) => `/companies/${c.id}`}
        columns={[
          {
            id: "name",
            header: "Company",
            sort: "name",
            cell: (c) => (
              <div className="min-w-0">
                <Link href={`/companies/${c.id}`} className="font-medium hover:underline">
                  {c.name}
                </Link>
                <div className="text-xs text-text-muted">{c.industry}</div>
              </div>
            ),
          },
          { id: "lifecycle", header: "Stage", sort: "lifecycle", cell: (c) => <StatusBadge status={c.lifecycle_stage} /> },
          { id: "country", header: "Location", sort: "country", hideBelow: "md", cell: (c) => <span className="text-text-subtle">{[c.city, countryName(c.country)].filter(Boolean).join(", ")}</span> },
          { id: "size", header: "Size", hideBelow: "lg", cell: (c) => <span className="text-text-subtle">{c.size}</span> },
          { id: "contacts", header: "Contacts", align: "right", hideBelow: "lg", cell: (c) => c.contacts },
          { id: "deals", header: "Open deals", align: "right", hideBelow: "sm", cell: (c) => c.open_deals },
          { id: "owner", header: "Owner", hideBelow: "md", cell: (c) => <span className="text-text-subtle">{people.names[c.owner_id] ?? "—"}</span> },
        ]}
        empty={
          <EmptyState
            icon={Building2}
            title={filtered ? "No companies match these filters" : "No companies yet"}
            description={filtered ? "Try a different search or clear the filters." : "Add the first account you sell to."}
            action={!filtered && perms.canCreate ? <CompanyFormButton owners={people.assignable} /> : undefined}
            className="m-4 border-0 bg-transparent"
          />
        }
      />
    </div>
  );
}
