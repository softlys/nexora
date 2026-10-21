import Link from "next/link";
import { ChangeHistory } from "@/components/crm/change-history";
import { ActivityComposer, CommentComposer } from "@/components/crm/composers";
import { DealFormButton } from "@/components/crm/deal-form";
import { DetailHeader, Facts, MiniList, Panel } from "@/components/crm/detail";
import { RecordActions } from "@/components/crm/record-actions";
import { CreateOrderButton, StageSelect } from "@/components/crm/stage-controls";
import { Timeline } from "@/components/crm/timeline";
import { humanizeStatus, StatusBadge } from "@/components/patterns/status-badge";
import { can } from "@/domain/permissions";
import { daysInStage } from "@/domain/rules/pipeline";
import { formatDate, formatMoney } from "@/lib/format";
import { requirePermission } from "@/server/guards";
import { dealFormOptions, loadPage, peopleFor, recordTitle } from "@/server/page-data";
import { getDeal } from "@/server/services/deals";

export async function generateMetadata({ params }: PageProps<"/deals/[id]">) {
  const { id } = await params;
  return { title: (await recordTitle("deals", id)) ?? "Deal" };
}

export default async function DealPage({ params }: PageProps<"/deals/[id]">) {
  const { user } = await requirePermission("view", "deal");
  const { id } = await params;
  const { data, people, options } = await loadPage(async (ctx) => ({
    data: await getDeal(ctx, id),
    people: await peopleFor(ctx, "deal"),
    options: await dealFormOptions(ctx),
  }));
  const { deal, stage, stages, company, contact, order, tasks, timeline, changes } = data;
  const record = { organization_id: deal.organization_id, owner_id: deal.owner_id };
  const canEdit = can(user.actor, "update", "deal", record) && !deal.archived_at;
  const weighted = (deal.amount * deal.probability) / 100;

  return (
    <div className="space-y-6">
      <DetailHeader
        back={{ href: "/deals", label: "Deals" }}
        path={`/deals/${deal.id}`}
        title={deal.name}
        subtitle={
          company ? (
            <Link href={`/companies/${company.id}`} className="hover:text-foreground hover:underline">
              {company.name}
            </Link>
          ) : undefined
        }
        badges={
          <>
            {stage && <StatusBadge label={stage.name} tone={stage.is_won ? "success" : stage.is_lost ? "neutral" : "accent"} />}
            {deal.archived_at && <StatusBadge status="archived" />}
          </>
        }
        actions={
          <RecordActions
            table="deals"
            id={deal.id}
            label="Deal"
            archived={!!deal.archived_at}
            canArchive={can(user.actor, "archive", "deal", record)}
            canDelete={can(user.actor, "delete", "deal", record)}
            listPath="/deals"
          >
            {canEdit && <StageSelect dealId={deal.id} dealName={deal.name} stageId={deal.stage_id} stages={stages} />}
            {stage?.is_won && (order || can(user.actor, "create", "order", record)) && <CreateOrderButton dealId={deal.id} existing={order ? { id: order.id, order_number: order.order_number } : null} />}
            {canEdit && <DealFormButton deal={deal} options={options} />}
          </RecordActions>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-6 lg:col-span-2">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Amount", formatMoney(deal.amount, deal.currency)],
              ["Probability", `${deal.probability}%`],
              ["Weighted", formatMoney(weighted, deal.currency)],
              ["In stage", `${daysInStage(deal, new Date())} days`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-border bg-surface p-3">
                <div className="text-xs text-text-muted">{label}</div>
                <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
              </div>
            ))}
          </div>
          {!deal.archived_at && <ActivityComposer links={{ deal_id: deal.id, company_id: deal.company_id, ...(contact ? { contact_id: contact.id } : {}) }} />}
          <Panel title="Timeline">
            <Timeline entries={timeline} names={people.names} />
          </Panel>
          <Panel title="Comments">
            <CommentComposer entityType="deal" entityId={deal.id} />
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel title="Details">
            <Facts
              className="sm:grid-cols-1"
              items={[
                ["Primary contact", contact ? <Link key="c" href={`/contacts/${contact.id}`} className="text-brand hover:underline">{contact.first_name} {contact.last_name}</Link> : null],
                ...(deal.closed_at ? ([["Closed", formatDate(deal.closed_at)]] as Array<[string, string]>) : []),
                ["Expected close", formatDate(deal.expected_close_date)],
                ["Owner", people.names[deal.owner_id]],
                ["Source", humanizeStatus(deal.source)],
                ["Next activity", deal.next_activity || null],
                ...(deal.lost_reason ? ([["Lost reason", deal.lost_reason]] as Array<[string, string]>) : []),
                ...(deal.lead_id ? ([["Lead", <Link key="l" href={`/leads/${deal.lead_id}`} className="text-brand hover:underline">Converted lead</Link>]] as Array<[string, React.ReactNode]>) : []),
                ["Created", formatDate(deal.created_at)],
              ]}
            />
            {deal.notes && <p className="mt-4 border-t border-border pt-3 text-sm whitespace-pre-wrap">{deal.notes}</p>}
          </Panel>
          <Panel title="Open tasks">
            <MiniList
              rows={tasks.filter((t) => t.status === "todo" || t.status === "in_progress")}
              empty="No open tasks."
              render={(t) => (
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{t.title}</span>
                  <span className="text-xs text-text-muted">{t.due_at ? formatDate(t.due_at) : ""}</span>
                </div>
              )}
            />
          </Panel>
          <Panel title="Change history">
            <ChangeHistory entries={changes} names={people.names} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
