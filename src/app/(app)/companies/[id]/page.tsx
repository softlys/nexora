import Link from "next/link";
import { ActivityComposer, CommentComposer } from "@/components/crm/composers";
import { CompanyFormButton } from "@/components/crm/company-form";
import { DetailHeader, ExternalLink, Facts, MiniList, Panel } from "@/components/crm/detail";
import { RecordActions } from "@/components/crm/record-actions";
import { RecordTabs } from "@/components/crm/record-tabs";
import { Timeline } from "@/components/crm/timeline";
import { StatusBadge } from "@/components/patterns/status-badge";
import { can } from "@/domain/permissions";
import { countryName } from "@/lib/countries";
import { formatDate, formatMoney } from "@/lib/format";
import { loadPage, peopleFor } from "@/server/page-data";
import { requirePermission } from "@/server/guards";
import { getCompany } from "@/server/services/companies";

export default async function CompanyPage({ params }: PageProps<"/companies/[id]">) {
  const { user } = await requirePermission("view", "company");
  const { id } = await params;
  const { data, people } = await loadPage(async (ctx) => ({ data: await getCompany(ctx, id), people: await peopleFor(ctx, "company") }));
  const { company, contacts, deals, orders, tasks, timeline, stages } = data;
  const record = { organization_id: company.organization_id, owner_id: company.owner_id };
  const canEdit = can(user.actor, "update", "company", record);
  const stageName = new Map(stages.map((s) => [s.id, s]));
  const comments = timeline.filter((e) => e.kind === "comment");

  return (
    <div className="space-y-6">
      <DetailHeader
        back={{ href: "/companies", label: "Companies" }}
        path={`/companies/${company.id}`}
        title={company.name}
        subtitle={`${company.industry} · ${[company.city, countryName(company.country)].filter(Boolean).join(", ")}`}
        badges={
          <>
            <StatusBadge status={company.lifecycle_stage} />
            {company.archived_at && <StatusBadge status="archived" label="Archived" />}
          </>
        }
        actions={
          <RecordActions
            table="companies"
            id={company.id}
            label="Company"
            archived={!!company.archived_at}
            canArchive={can(user.actor, "archive", "company", record)}
            canDelete={can(user.actor, "delete", "company", record)}
            listPath="/companies"
          >
            {canEdit && !company.archived_at && <CompanyFormButton company={company} owners={people.assignable} />}
          </RecordActions>
        }
      />

      <RecordTabs
        defaultTab="overview"
        tabs={[
          {
            id: "overview",
            label: "Overview",
            content: (
              <div className="grid gap-6 lg:grid-cols-3">
                <Panel title="Details" className="lg:col-span-2">
                  <Facts
                    items={[
                      ["Industry", company.industry],
                      ["Employees", company.size],
                      ["Website", <ExternalLink key="w" href={company.website} />],
                      ["Phone", company.phone],
                      ["Address", [company.address, company.city, countryName(company.country)].filter(Boolean).join(", ")],
                      ["Owner", people.names[company.owner_id]],
                      ["Lifecycle stage", <StatusBadge key="l" status={company.lifecycle_stage} />],
                      ["Created", formatDate(company.created_at)],
                    ]}
                  />
                </Panel>
                <Panel title="At a glance">
                  <Facts
                    className="sm:grid-cols-1"
                    items={[
                      ["Contacts", contacts.length],
                      ["Open deals", deals.filter((d) => !d.closed_at).length],
                      ["Open pipeline", formatMoney(deals.filter((d) => !d.closed_at).reduce((s, d) => s + d.amount, 0))],
                      ["Orders", orders.length],
                    ]}
                  />
                </Panel>
              </div>
            ),
          },
          {
            id: "contacts",
            label: "Contacts",
            count: contacts.length,
            content: (
              <Panel title="Contacts">
                <MiniList
                  rows={contacts}
                  empty="No contacts at this company you can see."
                  render={(c) => (
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <Link href={`/contacts/${c.id}`} className="font-medium hover:underline">
                        {c.first_name} {c.last_name}
                      </Link>
                      <span className="truncate text-text-muted">{c.job_title}</span>
                    </div>
                  )}
                />
              </Panel>
            ),
          },
          {
            id: "deals",
            label: "Deals",
            count: deals.length,
            content: (
              <Panel title="Deals">
                <MiniList
                  rows={deals}
                  empty="No deals with this company you can see."
                  render={(d) => (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <Link href={`/deals/${d.id}`} className="font-medium hover:underline">
                        {d.name}
                      </Link>
                      <span className="flex items-center gap-3">
                        <StatusBadge label={stageName.get(d.stage_id)?.name ?? "Unknown"} tone={stageName.get(d.stage_id)?.is_won ? "success" : stageName.get(d.stage_id)?.is_lost ? "neutral" : "accent"} />
                        <span className="tabular-nums">{formatMoney(d.amount, d.currency)}</span>
                      </span>
                    </div>
                  )}
                />
              </Panel>
            ),
          },
          {
            id: "orders",
            label: "Orders",
            count: orders.length,
            content: (
              <Panel title="Orders">
                <MiniList
                  rows={orders}
                  empty="No orders from this company you can see."
                  render={(o) => (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <Link href={`/orders/${o.id}`} className="font-medium tabular-nums hover:underline">
                        {o.order_number}
                      </Link>
                      <span className="flex items-center gap-3">
                        <StatusBadge status={o.status} />
                        <span className="tabular-nums">{formatMoney(o.total, o.currency)}</span>
                      </span>
                    </div>
                  )}
                />
              </Panel>
            ),
          },
          {
            id: "tasks",
            label: "Tasks",
            count: tasks.filter((t) => t.status === "todo" || t.status === "in_progress").length,
            content: (
              <Panel title="Tasks" actions={<Link href={`/tasks?company=${company.id}`} className="text-xs text-brand hover:underline">Open in Tasks</Link>}>
                <MiniList
                  rows={tasks}
                  empty="No tasks for this company."
                  render={(t) => (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span>{t.title}</span>
                      <span className="flex items-center gap-2 text-text-muted">
                        {t.due_at && formatDate(t.due_at)}
                        <StatusBadge status={t.status} />
                      </span>
                    </div>
                  )}
                />
              </Panel>
            ),
          },
          {
            id: "notes",
            label: "Notes",
            count: comments.length,
            content: (
              <div className="space-y-4">
                <Panel title="Notes">
                  {company.notes ? <p className="text-sm whitespace-pre-wrap">{company.notes}</p> : <p className="text-sm text-text-muted">No notes. Edit the company to add some.</p>}
                </Panel>
                <Panel title="Comments">
                  <div className="space-y-4">
                    <CommentComposer entityType="company" entityId={company.id} />
                    <Timeline entries={comments} names={people.names} emptyText="No comments yet." />
                  </div>
                </Panel>
              </div>
            ),
          },
          {
            id: "activity",
            label: "Activity",
            content: (
              <div className="space-y-4">
                <ActivityComposer links={{ company_id: company.id }} />
                <Timeline entries={timeline} names={people.names} />
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
