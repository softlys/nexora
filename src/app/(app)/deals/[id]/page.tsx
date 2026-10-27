import Link from "next/link";
import { ChangeHistory } from "@/components/crm/change-history";
import { ActivityComposer, CommentComposer } from "@/components/crm/composers";
import { DealAssistant, DealMeetingButton } from "@/components/crm/deal-assistant";
import { DealFormButton } from "@/components/crm/deal-form";
import { DetailHeader, Facts, MiniList, Panel, customFacts } from "@/components/crm/detail";
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
import { aiConfig } from "@/server/integrations/ai";
import { yandexConfig } from "@/server/integrations/yandex";
import { plural, tr, trNode } from "@/lib/i18n";
import { EmailComposerButton } from "@/components/crm/email-composer";
import { emailComposer } from "@/server/services/email";
import { emailConfigured } from "@/server/services/integrations";
import { productOptions } from "@/server/services/orders";
import { DealProducts } from "@/components/crm/deal-products";

export async function generateMetadata({ params }: PageProps<"/deals/[id]">) {
  const { id } = await params;
  return { title: (await recordTitle("deals", id)) ?? tr("Deal") };
}

export default async function DealPage({ params }: PageProps<"/deals/[id]">) {
  const { user } = await requirePermission("view", "deal");
  const { id } = await params;
  const { data, people, options, composer, products } = await loadPage(async (ctx) => ({
    data: await getDeal(ctx, id),
    people: await peopleFor(ctx, "deal"),
    options: await dealFormOptions(ctx),
    composer: await emailComposer(ctx, { deal_id: id }, emailConfigured()),
    products: await productOptions(ctx),
  }));
  const { deal, stage, stages, pipelines, company, contact, order, tasks, timeline, changes } = data;
  // With several pipelines, the stage menu also offers moving the deal to another pipeline.
  const pipelineName = new Map(pipelines.map((p) => [p.id, tr(p.name)]));
  const stageChoices = pipelines.length > 1 ? stages.map((s) => ({ ...s, name: `${pipelineName.get(s.pipeline_id) ?? ""} · ${tr(s.name)}` })) : stages;
  const record = { organization_id: deal.organization_id, owner_id: deal.owner_id };
  const canEdit = can(user.actor, "update", "deal", record) && !deal.archived_at;
  const weighted = (deal.amount * deal.probability) / 100;

  return (
    <div className="space-y-6">
      <DetailHeader
        back={{ href: "/deals", label: tr("Deals") }}
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
            label={tr("Deal")}
            archived={!!deal.archived_at}
            canArchive={can(user.actor, "archive", "deal", record)}
            canDelete={can(user.actor, "delete", "deal", record)}
            listPath="/deals"
          >
            {!deal.archived_at && <EmailComposerButton composer={composer} />}
            {canEdit && <StageSelect dealId={deal.id} dealName={deal.name} stageId={deal.stage_id} stages={stageChoices} />}
            {stage?.is_won && (order || can(user.actor, "create", "order", record)) && <CreateOrderButton dealId={deal.id} existing={order ? { id: order.id, order_number: order.order_number } : null} />}
            {canEdit && <DealFormButton deal={deal} options={options} amountFromProducts={data.items.length > 0} />}
          </RecordActions>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-6 lg:col-span-2">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              [tr("Amount"), formatMoney(deal.amount, deal.currency)],
              [tr("Probability"), `${deal.probability}%`],
              [tr("Weighted"), formatMoney(weighted, deal.currency)],
              [tr("In stage"), plural(daysInStage(deal, new Date()), "day")],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-border bg-surface p-3">
                <div className="text-xs text-text-muted">{trNode(label)}</div>
                <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
              </div>
            ))}
          </div>
          <Panel title={tr("Products")}>
            <DealProducts
              dealId={deal.id}
              currency={deal.currency}
              items={data.items.map((i) => ({ product_id: i.product_id, description: i.description, quantity: Number(i.quantity), unit_price: Number(i.unit_price), discount_pct: Number(i.discount_pct), tax_rate: Number(i.tax_rate), line_total: Number(i.line_total) }))}
              products={products}
              canEdit={canEdit && !deal.archived_at}
            />
          </Panel>
          {!deal.archived_at && <ActivityComposer links={{ deal_id: deal.id, company_id: deal.company_id, ...(contact ? { contact_id: contact.id } : {}) }} />}
          <Panel title={tr("Timeline")}>
            <Timeline entries={timeline} names={people.names} />
          </Panel>
          <Panel title={tr("Comments")}>
            <CommentComposer entityType="deal" entityId={deal.id} />
          </Panel>
        </div>
        <div className="space-y-6">
          <Panel title={tr("AI assistant")}>
            <DealAssistant dealId={deal.id} provider={aiConfig().provider ? aiConfig().label : null} />
          </Panel>
          {yandexConfig().telemostConfigured && canEdit && (
            <Panel title={tr("Video meeting")}>
              <DealMeetingButton dealId={deal.id} />
            </Panel>
          )}
          <Panel title={tr("Details")}>
            <Facts
              className="sm:grid-cols-1"
              items={[
                [tr("Primary contact"), contact ? <Link key="c" href={`/contacts/${contact.id}`} className="text-brand hover:underline">{contact.first_name} {contact.last_name}</Link> : null],
                ...(deal.closed_at ? ([[tr("Closed"), formatDate(deal.closed_at)]] as Array<[string, string]>) : []),
                [tr("Expected close"), formatDate(deal.expected_close_date)],
                [tr("Owner"), people.names[deal.owner_id]],
                [tr("Source"), humanizeStatus(deal.source)],
                [tr("Next activity"), deal.next_activity || null],
                ...(deal.lost_reason ? ([[tr("Lost reason"), deal.lost_reason]] as Array<[string, string]>) : []),
                ...(deal.lead_id ? ([[tr("Lead"), <Link key="l" href={`/leads/${deal.lead_id}`} className="text-brand hover:underline">{tr("Converted lead")}</Link>]] as Array<[string, React.ReactNode]>) : []),
                [tr("Created"), formatDate(deal.created_at)],
                ...customFacts(options.customFields, deal.custom, tr("Yes"), tr("No")),
              ]}
            />
            {deal.notes && <p className="mt-4 border-t border-border pt-3 text-sm whitespace-pre-wrap">{deal.notes}</p>}
          </Panel>
          <Panel title={tr("Open tasks")}>
            <MiniList
              rows={tasks.filter((t) => t.status === "todo" || t.status === "in_progress")}
              empty={tr("No open tasks.")}
              render={(t) => (
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{t.title}</span>
                  <span className="text-xs text-text-muted">{t.due_at ? formatDate(t.due_at) : ""}</span>
                </div>
              )}
            />
          </Panel>
          <Panel title={tr("Change history")}>
            <ChangeHistory entries={changes} names={people.names} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
