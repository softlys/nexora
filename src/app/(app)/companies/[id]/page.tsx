import Link from "next/link";
import { ActivityComposer, CommentComposer } from "@/components/crm/composers";
import { CompanyFormButton } from "@/components/crm/company-form";
import { DetailHeader, ExternalLink, Facts, MiniList, Panel, customFacts } from "@/components/crm/detail";
import { RecordActions } from "@/components/crm/record-actions";
import { RecordTabs } from "@/components/crm/record-tabs";
import { Timeline } from "@/components/crm/timeline";
import { StatusBadge } from "@/components/patterns/status-badge";
import { can } from "@/domain/permissions";
import { countryName } from "@/lib/countries";
import { formatDate, formatMoney } from "@/lib/format";
import { loadPage, peopleFor, recordTitle } from "@/server/page-data";
import { requirePermission } from "@/server/guards";
import { getCompany } from "@/server/services/companies";
import { tr } from "@/lib/i18n";
import { EmailComposerButton } from "@/components/crm/email-composer";
import { emailComposer } from "@/server/services/email";
import { emailConfigured } from "@/server/services/integrations";
import { CallButton } from "@/components/crm/call-button";
import { callSetup } from "@/server/services/calls";

export async function generateMetadata({ params }: PageProps<"/companies/[id]">) {
  const { id } = await params;
  return { title: (await recordTitle("companies", id)) ?? tr("Company") };
}

export default async function CompanyPage({ params }: PageProps<"/companies/[id]">) {
  const { user } = await requirePermission("view", "company");
  const { id } = await params;
  const { data, people, composer, calls } = await loadPage(async (ctx) => ({ data: await getCompany(ctx, id), people: await peopleFor(ctx, "company"), composer: await emailComposer(ctx, { company_id: id }, emailConfigured()), calls: await callSetup(ctx) }));
  const { company, contacts, deals, orders, tasks, timeline, stages } = data;
  // Open tasks first, soonest due first (no date last); then done and cancelled, newest first.
  const nowIso = new Date().toISOString();
  const isOpen = (t: (typeof tasks)[number]) => t.status === "todo" || t.status === "in_progress";
  const openTasks = tasks.filter(isOpen).sort((a, b) => (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999"));
  const closedTasks = tasks.filter((t) => !isOpen(t)).sort((a, b) => (b.due_at ?? "").localeCompare(a.due_at ?? ""));
  const record = { organization_id: company.organization_id, owner_id: company.owner_id };
  const canEdit = can(user.actor, "update", "company", record);
  const stageName = new Map(stages.map((s) => [s.id, s]));
  const comments = timeline.filter((e) => e.kind === "comment");

  return (
    <div className="space-y-6">
      <DetailHeader
        back={{ href: "/companies", label: tr("Companies") }}
        path={`/companies/${company.id}`}
        title={company.name}
        subtitle={`${company.industry} · ${[company.city, countryName(company.country)].filter(Boolean).join(", ")}`}
        badges={
          <>
            <StatusBadge status={company.lifecycle_stage} />
            {company.archived_at && <StatusBadge status="archived" label={tr("Archived")} />}
          </>
        }
        actions={
          <RecordActions
            table="companies"
            id={company.id}
            label={tr("Company")}
            archived={!!company.archived_at}
            canArchive={can(user.actor, "archive", "company", record)}
            canDelete={can(user.actor, "delete", "company", record)}
            listPath="/companies"
          >
            {!company.archived_at && company.phone && <CallButton entity="company" id={company.id} phone={company.phone} callback={calls.callback} />}
            {!company.archived_at && composer.recipients.length > 0 && <EmailComposerButton composer={composer} />}
            {canEdit && !company.archived_at && <CompanyFormButton fields={people.fields} company={company} owners={people.assignable} />}
          </RecordActions>
        }
      />

      <RecordTabs
        defaultTab="overview"
        tabs={[
          {
            id: "overview",
            label: tr("Overview"),
            content: (
              <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
                <Panel title={tr("Details")} className="lg:col-span-2">
                  <Facts
                    items={[
                      [tr("Industry"), company.industry],
                      [tr("Employees"), company.size],
                      [tr("Website"), <ExternalLink key="w" href={company.website} />],
                      [tr("Phone"), company.phone],
                      [tr("Address"), [company.address, company.city, countryName(company.country)].filter(Boolean).join(", ")],
                      [tr("Owner"), people.names[company.owner_id]],
                      [tr("Lifecycle stage"), <StatusBadge key="l" status={company.lifecycle_stage} />],
                      [tr("Created"), formatDate(company.created_at)],
                      ...customFacts(people.fields, company.custom, tr("Yes"), tr("No")),
                    ]}
                  />
                </Panel>
                <Panel title={tr("At a glance")}>
                  <Facts
                    className="sm:grid-cols-1"
                    items={[
                      [tr("Contacts"), contacts.length],
                      [tr("Open deals"), deals.filter((d) => !d.closed_at).length],
                      [tr("Open pipeline"), formatMoney(deals.filter((d) => !d.closed_at).reduce((s, d) => s + d.amount, 0))],
                      [tr("Orders"), orders.length],
                    ]}
                  />
                </Panel>
              </div>
            ),
          },
          {
            id: "contacts",
            label: tr("Contacts"),
            count: contacts.length,
            content: (
              <Panel title={tr("Contacts")}>
                <MiniList
                  rows={contacts}
                  empty={tr("No contacts at this company you can see.")}
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
            label: tr("Deals"),
            count: deals.length,
            content: (
              <Panel title={tr("Deals")}>
                <MiniList
                  rows={deals}
                  empty={tr("No deals with this company you can see.")}
                  render={(d) => (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <Link href={`/deals/${d.id}`} className="font-medium hover:underline">
                        {d.name}
                      </Link>
                      <span className="flex items-center gap-3">
                        <StatusBadge label={stageName.get(d.stage_id)?.name ?? tr("Unknown")} tone={stageName.get(d.stage_id)?.is_won ? "success" : stageName.get(d.stage_id)?.is_lost ? "neutral" : "accent"} />
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
            label: tr("Orders"),
            count: orders.length,
            content: (
              <Panel title={tr("Orders")}>
                <MiniList
                  rows={orders}
                  empty={tr("No orders from this company you can see.")}
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
            label: tr("Tasks"),
            count: openTasks.length,
            content: (
              <Panel
                title={tr("Tasks · {p0} open{p1}", { p0: openTasks.length, p1: closedTasks.length ? `, ${closedTasks.length} done or cancelled` : "" })}
                actions={<Link href={`/tasks?company=${company.id}`} className="text-xs text-brand hover:underline">{tr("Open in Tasks")}</Link>}
              >
                <MiniList
                  rows={[...openTasks, ...closedTasks]}
                  empty={tr("No tasks for this company.")}
                  render={(t) => {
                    const overdue = isOpen(t) && t.due_at !== null && t.due_at < nowIso;
                    return (
                      <div className={`flex flex-wrap items-center justify-between gap-2 text-sm ${isOpen(t) ? "" : "text-text-muted"}`}>
                        <Link href={`/tasks/${t.id}`} className="hover:underline">
                          {t.title}
                        </Link>
                        <span className="flex items-center gap-2 text-text-muted">
                          {t.due_at && <span className={overdue ? "font-medium text-danger" : undefined}>{overdue ? tr("Overdue · {p0}", { p0: formatDate(t.due_at) }) : formatDate(t.due_at)}</span>}
                          <StatusBadge status={t.status} />
                        </span>
                      </div>
                    );
                  }}
                />
              </Panel>
            ),
          },
          {
            id: "notes",
            label: tr("Notes"),
            count: comments.length,
            content: (
              <div className="space-y-4">
                <Panel title={tr("Notes")}>
                  {company.notes ? <p className="text-sm whitespace-pre-wrap">{company.notes}</p> : <p className="text-sm text-text-muted">{tr("No notes. Edit the company to add some.")}</p>}
                </Panel>
                <Panel title={tr("Comments")}>
                  <div className="space-y-4">
                    <CommentComposer entityType="company" entityId={company.id} />
                    <Timeline entries={comments} names={people.names} emptyText={tr("No comments yet.")} />
                  </div>
                </Panel>
              </div>
            ),
          },
          {
            id: "activity",
            label: tr("Activity"),
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
