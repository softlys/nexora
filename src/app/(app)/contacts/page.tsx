import { Users } from "lucide-react";
import Link from "next/link";
import { ContactFormButton } from "@/components/crm/contact-form";
import { ListTable } from "@/components/list/list-table";
import { ListToolbar } from "@/components/list/list-toolbar";
import { EmptyState } from "@/components/patterns/empty-state";
import { PageHeader } from "@/components/patterns/page-header";
import { parseListQuery, stringFilter, first } from "@/domain/list";
import { formatRelative } from "@/lib/format";
import { requirePermission } from "@/server/guards";
import { loadPage, peopleFor, permissionsFor } from "@/server/page-data";
import { companyOptions } from "@/server/services/companies";
import { listContacts } from "@/server/services/contacts";
import { MessengerMarks } from "@/components/crm/messenger-links";
import { ExportButton, ImportButton } from "@/components/list/export-import";

export const metadata = { title: "Contacts" };

export default async function ContactsPage({ searchParams }: PageProps<"/contacts">) {
  await requirePermission("view", "contact");
  const params = await searchParams;
  const query = parseListQuery(params);
  const filters = { owner: stringFilter(params, "owner", 36), company: stringFilter(params, "company", 36) };
const exportQuery = new URLSearchParams(Object.entries(params).flatMap(([k, v]) => (typeof v === "string" && k !== "page" && k !== "new" ? [[k, v]] : []))).toString();
  const { page, people, perms, companies } = await loadPage(async (ctx) => ({
    page: await listContacts(ctx, query, filters),
    people: await peopleFor(ctx, "contact"),
    perms: permissionsFor(ctx, "contact"),
    companies: (await companyOptions(ctx)).map((c) => ({ value: c.id, label: c.name })),
  }));
  const filtered = Boolean(query.q || filters.owner || filters.company || query.archived === "1");

  return (
    <div className="space-y-5">
      <PageHeader
        title="Contacts"
        description="People at your customer and prospect companies."
        actions={
          <>
            <ExportButton entity="contacts" query={exportQuery} />
            {perms.canCreate && <ImportButton entity="contacts" />}
            {perms.canCreate && <ContactFormButton owners={people.assignable} companies={companies} autoOpen={first(params.new) === "1"} />}
          </>
        }
      />
      <ListToolbar
        searchPlaceholder="Search name, email, company, tag…"
        filters={[
          { key: "company", label: "Companies", options: companies },
          ...(people.assignable.length > 1 ? [{ key: "owner", label: "Owners", options: people.assignable }] : []),
        ]}
      />
      <ListTable
        caption="Contacts"
        basePath="/contacts"
        params={params}
        {...page}
        rowKey={(c) => c.id}
        rowHref={(c) => `/contacts/${c.id}`}
        columns={[
          {
            id: "name",
            header: "Name",
            sort: "name",
            cell: (c) => (
              <div className="min-w-0">
                <Link href={`/contacts/${c.id}`} className="font-medium hover:underline">
                  {c.first_name} {c.last_name}
                </Link>
                <div className="truncate text-xs text-text-muted">{c.job_title}</div>
              </div>
            ),
          },
          { id: "company", header: "Company", sort: "company", cell: (c) => <span className="text-text-subtle">{c.company_name ?? "—"}</span> },
          { id: "email", header: "Email", hideBelow: "md", cell: (c) => <span className="text-text-subtle">{c.email ?? "—"}</span> },
          { id: "messengers", header: "Messengers", hideBelow: "lg", cell: (c) => <MessengerMarks messengers={c.messengers} /> },
          {
            id: "tags",
            header: "Tags",
            hideBelow: "xl",
            cell: (c) => (
              <span className="flex flex-wrap gap-1">
                {c.tags.map((t) => (
                  <span key={t} className="rounded bg-surface-muted px-1.5 text-xs text-text-subtle">
                    {t}
                  </span>
                ))}
              </span>
            ),
          },
          { id: "last", header: "Last interaction", sort: "last_interaction", hideBelow: "lg", cell: (c) => <span className="text-text-subtle">{c.last_interaction ? formatRelative(c.last_interaction) : "None"}</span> },
          { id: "owner", header: "Owner", hideBelow: "md", cell: (c) => <span className="text-text-subtle">{people.names[c.owner_id] ?? "—"}</span> },
        ]}
        empty={
          <EmptyState
            icon={Users}
            title={filtered ? "No contacts match these filters" : "No contacts yet"}
            description={filtered ? "Try a different search or clear the filters." : "Add the people you work with at your customers."}
            action={!filtered && perms.canCreate ? <ContactFormButton owners={people.assignable} companies={companies} /> : undefined}
            className="m-4 border-0 bg-transparent"
          />
        }
      />
    </div>
  );
}
