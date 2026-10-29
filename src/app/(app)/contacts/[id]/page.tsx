import Link from "next/link";
import { EmailThreads } from "@/components/crm/email-threads";
import { Attachments } from "@/components/crm/attachments";
import { ActivityComposer, CommentComposer } from "@/components/crm/composers";
import { ContactFormButton } from "@/components/crm/contact-form";
import { DetailHeader, Facts, MiniList, Panel, customFacts } from "@/components/crm/detail";
import { MessengerLinks } from "@/components/crm/messenger-links";
import { RecordActions } from "@/components/crm/record-actions";
import { Timeline } from "@/components/crm/timeline";
import { StatusBadge } from "@/components/patterns/status-badge";
import { can } from "@/domain/permissions";
import { formatDate, formatMoney, formatRelative } from "@/lib/format";
import { requirePermission } from "@/server/guards";
import { loadPage, peopleFor, recordTitle } from "@/server/page-data";
import { companyOptions } from "@/server/services/companies";
import { getContact } from "@/server/services/contacts";
import { tr } from "@/lib/i18n";
import { EmailComposerButton } from "@/components/crm/email-composer";
import { emailComposer } from "@/server/services/email";
import { emailConfigured } from "@/server/services/integrations";
import { CallButton } from "@/components/crm/call-button";
import { callSetup } from "@/server/services/calls";

export async function generateMetadata({ params }: PageProps<"/contacts/[id]">) {
  const { id } = await params;
  return { title: (await recordTitle("contacts", id)) ?? tr("Contact") };
}

export default async function ContactPage({ params }: PageProps<"/contacts/[id]">) {
  const { user } = await requirePermission("view", "contact");
  const { id } = await params;
  const { data, people, companies, composer, calls } = await loadPage(async (ctx) => ({
    data: await getContact(ctx, id),
    people: await peopleFor(ctx, "contact"),
    composer: await emailComposer(ctx, { contact_id: id }, emailConfigured()),
    calls: await callSetup(ctx),
    companies: (await companyOptions(ctx)).map((c) => ({ value: c.id, label: c.name })),
  }));
  const { contact, company, deals, tasks, timeline, last_interaction } = data;
  const record = { organization_id: contact.organization_id, owner_id: contact.owner_id };
  const name = `${contact.first_name} ${contact.last_name}`;

  return (
    <div className="space-y-6">
      <DetailHeader
        back={{ href: "/contacts", label: tr("Contacts") }}
        path={`/contacts/${contact.id}`}
        title={name}
        subtitle={[contact.job_title, company?.name].filter(Boolean).join(" · ") || undefined}
        badges={contact.archived_at && <StatusBadge status="archived" />}
        actions={
          <RecordActions
            table="contacts"
            id={contact.id}
            label={tr("Contact")}
            archived={!!contact.archived_at}
            canArchive={can(user.actor, "archive", "contact", record)}
            canDelete={can(user.actor, "delete", "contact", record)}
            listPath="/contacts"
          >
            {!contact.archived_at && contact.phone && <CallButton entity="contact" id={contact.id} phone={contact.phone} callback={calls.callback} />}
            {!contact.archived_at && <EmailComposerButton composer={composer} />}
            {can(user.actor, "update", "contact", record) && !contact.archived_at && (
              <ContactFormButton fields={people.fields} contact={contact} owners={people.assignable} companies={companies} />
            )}
          </RecordActions>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-6 lg:col-span-2">
          <ActivityComposer links={{ contact_id: contact.id, ...(contact.company_id && company ? { company_id: contact.company_id } : {}) }} />
          <Panel title={tr("Activity timeline")}>
            <Timeline entries={timeline} names={people.names} />
          </Panel>
          <Panel title={tr("Correspondence")}>
            <EmailThreads target={{ contact_id: contact.id }} composer={composer} canReply={!contact.archived_at} />
          </Panel>
          <Panel title={tr("Files")}>
            <Attachments entity="contact" id={contact.id} canUpload={!contact.archived_at} />
          </Panel>
          <Panel title={tr("Comments")}>
            <CommentComposer entityType="contact" entityId={contact.id} />
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel title={tr("Details")}>
            <Facts
              className="sm:grid-cols-1"
              items={[
                [tr("Email"), contact.email ? <a key="e" href={`mailto:${contact.email}`} className="text-brand hover:underline">{contact.email}</a> : null],
                [tr("Phone"), contact.phone],
                [tr("Company"), company ? <Link key="c" href={`/companies/${company.id}`} className="text-brand hover:underline">{company.name}</Link> : null],
                [tr("Owner"), people.names[contact.owner_id]],
                [tr("Last interaction"), last_interaction ? `${formatRelative(last_interaction)} (${formatDate(last_interaction)})` : tr("None logged")],
                [tr("Tags"), contact.tags.length ? contact.tags.join(", ") : null],
                ...customFacts(people.fields, contact.custom, tr("Yes"), tr("No")),
              ]}
            />
          </Panel>
          <Panel title={tr("Messengers")}>
            <MessengerLinks messengers={contact.messengers} emptyText={tr("No messengers saved. Add Telegram, WhatsApp or Instagram with Edit.")} />
          </Panel>
          <Panel title={tr("Deals")}>
            <MiniList
              rows={deals}
              empty={tr("Not the primary contact on any deal you can see.")}
              render={(d) => (
                <div className="flex items-center justify-between gap-2 text-sm">
                  <Link href={`/deals/${d.id}`} className="truncate font-medium hover:underline">
                    {d.name}
                  </Link>
                  <span className="tabular-nums">{formatMoney(d.amount, d.currency)}</span>
                </div>
              )}
            />
          </Panel>
          <Panel title={tr("Open tasks")}>
            <MiniList
              rows={tasks.filter((t) => t.status === "todo" || t.status === "in_progress")}
              empty={tr("No open tasks.")}
              render={(t) => (
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{t.title}</span>
                  <StatusBadge status={t.priority} />
                </div>
              )}
            />
          </Panel>
        </div>
      </div>
    </div>
  );
}
