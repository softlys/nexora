import Link from "next/link";
import { ActivityComposer, CommentComposer } from "@/components/crm/composers";
import { ConvertLeadDialog } from "@/components/crm/convert-lead-dialog";
import { DetailHeader, Facts, Panel } from "@/components/crm/detail";
import { LeadFormButton } from "@/components/crm/lead-form";
import { RecordActions } from "@/components/crm/record-actions";
import { Timeline } from "@/components/crm/timeline";
import { humanizeStatus, StatusBadge } from "@/components/patterns/status-badge";
import { can } from "@/domain/permissions";
import { countryName } from "@/lib/countries";
import { formatDate, formatMoney } from "@/lib/format";
import { requirePermission } from "@/server/guards";
import { loadPage, peopleFor } from "@/server/page-data";
import { companyOptions } from "@/server/services/companies";
import { contactOptions } from "@/server/services/contacts";
import { getLead } from "@/server/services/leads";

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
        back={{ href: "/leads", label: "Leads" }}
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
            label="Lead"
            archived={!!lead.archived_at}
            canArchive={can(user.actor, "archive", "lead", record)}
            canDelete={can(user.actor, "delete", "lead", record)}
            listPath="/leads"
          >
            {canEdit && !converted && <LeadFormButton lead={lead} owners={people.assignable} />}
            {canEdit && !converted && lead.status !== "unqualified" && can(user.actor, "create", "deal") && (
              <ConvertLeadDialog lead={lead} companies={companies} contacts={contacts} />
            )}
          </RecordActions>
        }
      />
      {converted && lead.converted_deal_id && (
        <div className="rounded-lg border border-success-border bg-success-bg px-4 py-3 text-sm text-success">
          Converted on {formatDate(lead.converted_at)}.{" "}
          <Link href={`/deals/${lead.converted_deal_id}`} className="font-medium underline">
            Open the deal
          </Link>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {!lead.archived_at && <ActivityComposer links={{ lead_id: lead.id }} />}
          <Panel title="Activity timeline">
            <Timeline entries={timeline} names={people.names} />
          </Panel>
          <Panel title="Comments">
            <CommentComposer entityType="lead" entityId={lead.id} />
          </Panel>
        </div>
        <Panel title="Details">
          <Facts
            className="sm:grid-cols-1"
            items={[
              ["Email", lead.email],
              ["Phone", lead.phone],
              ["Country", lead.country ? countryName(lead.country) : null],
              ["Source", humanizeStatus(lead.source)],
              ["Qualification", humanizeStatus(lead.qualification)],
              ["Estimated value", formatMoney(lead.estimated_value, lead.currency)],
              ["Next action", lead.next_action ? `${lead.next_action}${lead.next_action_at ? ` (${formatDate(lead.next_action_at)})` : ""}` : null],
              ["Owner", lead.owner_id ? people.names[lead.owner_id] : "Unassigned"],
              ["Created", formatDate(lead.created_at)],
            ]}
          />
        </Panel>
      </div>
    </div>
  );
}
