import Link from "next/link";
import { ActivityComposer, CommentComposer } from "@/components/crm/composers";
import { ConvertLeadDialog } from "@/components/crm/convert-lead-dialog";
import { DetailHeader, Facts, Panel, customFacts } from "@/components/crm/detail";
import { LeadFormButton } from "@/components/crm/lead-form";
import { RecordActions } from "@/components/crm/record-actions";
import { Timeline } from "@/components/crm/timeline";
import { humanizeStatus, StatusBadge } from "@/components/patterns/status-badge";
import { can } from "@/domain/permissions";
import { countryName } from "@/lib/countries";
import { formatDate, formatMoney } from "@/lib/format";
import { requirePermission } from "@/server/guards";
import { loadPage, peopleFor, recordTitle } from "@/server/page-data";
import { companyOptions } from "@/server/services/companies";
import { contactOptions } from "@/server/services/contacts";
import { getLead } from "@/server/services/leads";
import { tr } from "@/lib/i18n";

export async function generateMetadata({ params }: PageProps<"/leads/[id]">) {
  const { id } = await params;
  return { title: (await recordTitle("leads", id)) ?? tr("Lead") };
}

export default async function LeadPage({ params }: PageProps<"/leads/[id]">) {
  const { user } = await requirePermission("view", "lead");
  const { id } = await params;
  const { data, people, companies, contacts } = await loadPage(async (ctx) => ({
    data: await getLead(ctx, id),
    people: await peopleFor(ctx, "lead"),
    companies: (await companyOptions(ctx)).map((c) => ({ value: c.id, label: c.name })),
    contacts: (await contactOptions(ctx)).map((c) => ({ value: c.id, label: c.name, company_id: c.company_id })),
  }));
  const { lead, timeline } = data;
  const record = { organization_id: lead.organization_id, owner_id: lead.owner_id };
  const canEdit = can(user.actor, "update", "lead", record) && !lead.archived_at;
  const converted = lead.status === "converted";

  return (
    <div className="space-y-6">
      <DetailHeader
        back={{ href: "/leads", label: tr("Leads") }}
        path={`/leads/${lead.id}`}
        title={lead.title}
        subtitle={`${lead.company_name} · ${lead.contact_name}`}
        badges={
          <>
            <StatusBadge status={lead.status} />
            {lead.archived_at && <StatusBadge status="archived" />}
          </>
        }
        actions={
          <RecordActions
            table="leads"
            id={lead.id}
            label={tr("Lead")}
            archived={!!lead.archived_at}
            canArchive={can(user.actor, "archive", "lead", record)}
            canDelete={can(user.actor, "delete", "lead", record)}
            listPath="/leads"
          >
            {canEdit && !converted && <LeadFormButton fields={people.fields} lead={lead} owners={people.assignable} />}
            {canEdit && !converted && lead.status !== "unqualified" && can(user.actor, "create", "deal") && (
              <ConvertLeadDialog lead={lead} companies={companies} contacts={contacts} />
            )}
          </RecordActions>
        }
      />
      {converted && lead.converted_deal_id && (
        <div className="rounded-lg border border-success-border bg-success-bg px-4 py-3 text-sm text-success">{tr("Converted on")} {formatDate(lead.converted_at)}.{" "}
          <Link href={`/deals/${lead.converted_deal_id}`} className="font-medium underline">{tr("Open the deal")}</Link>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-6 lg:col-span-2">
          {!lead.archived_at && <ActivityComposer links={{ lead_id: lead.id }} />}
          <Panel title={tr("Activity timeline")}>
            <Timeline entries={timeline} names={people.names} />
          </Panel>
          <Panel title={tr("Comments")}>
            <CommentComposer entityType="lead" entityId={lead.id} />
          </Panel>
        </div>
        <Panel title={tr("Details")}>
          <Facts
            className="sm:grid-cols-1"
            items={[
              [tr("Email"), lead.email],
              [tr("Phone"), lead.phone],
              [tr("Country"), lead.country ? countryName(lead.country) : null],
              [tr("Source"), humanizeStatus(lead.source)],
              [tr("Qualification"), humanizeStatus(lead.qualification)],
              [tr("Estimated value"), formatMoney(lead.estimated_value, lead.currency)],
              [tr("Next action"), lead.next_action ? `${lead.next_action}${lead.next_action_at ? ` (${formatDate(lead.next_action_at)})` : ""}` : null],
              [tr("Owner"), lead.owner_id ? people.names[lead.owner_id] : tr("Unassigned")],
              [tr("Created"), formatDate(lead.created_at)],
              ...customFacts(people.fields, lead.custom, tr("Yes"), tr("No")),
            ]}
          />
        </Panel>
      </div>
    </div>
  );
}
