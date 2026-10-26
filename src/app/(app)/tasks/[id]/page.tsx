import Link from "next/link";
import { CommentComposer } from "@/components/crm/composers";
import { DetailHeader, Facts, Panel } from "@/components/crm/detail";
import { RecordActions } from "@/components/crm/record-actions";
import { TaskCheck } from "@/components/crm/task-check";
import { TaskFormButton } from "@/components/crm/task-form";
import { Timeline } from "@/components/crm/timeline";
import { humanizeStatus, StatusBadge } from "@/components/patterns/status-badge";
import { can } from "@/domain/permissions";
import { buildTimeline } from "@/domain/timeline";
import { formatDate } from "@/lib/format";
import { requirePermission } from "@/server/guards";
import { loadPage, peopleFor, taskFormOptions, recordTitle } from "@/server/page-data";
import { isOverdue, getTask } from "@/server/services/tasks";
import { tr } from "@/lib/i18n";

export async function generateMetadata({ params }: PageProps<"/tasks/[id]">) {
  const { id } = await params;
  return { title: (await recordTitle("tasks", id)) ?? tr("Task") };
}

export default async function TaskPage({ params }: PageProps<"/tasks/[id]">) {
  const { user } = await requirePermission("view", "task");
  const { id } = await params;
  const { data, people, options } = await loadPage(async (ctx) => ({ data: await getTask(ctx, id), people: await peopleFor(ctx, "task"), options: await taskFormOptions(ctx) }));
  const { task, comments } = data;
  const record = { organization_id: task.organization_id, owner_id: task.assignee_id };
  const canEdit = can(user.actor, "update", "task", record) && !task.archived_at;
  const overdue = isOverdue(task, new Date());
  const label = (list: Array<{ value: string; label: string }>, value: string | null) => (value ? (list.find((o) => o.value === value)?.label ?? tr("Linked record")) : null);

  return (
    <div className="space-y-6">
      <DetailHeader
        back={{ href: "/tasks", label: tr("Tasks") }}
        path={`/tasks/${task.id}`}
        title={task.title}
        subtitle={tr("{p0} · assigned to {p1}", { p0: humanizeStatus(task.type), p1: people.names[task.assignee_id] ?? "Former member" })}
        badges={
          <>
            <StatusBadge status={task.status} />
            <StatusBadge status={task.priority} />
            {overdue && <StatusBadge status="overdue" />}
          </>
        }
        actions={
          <RecordActions
            table="tasks"
            id={task.id}
            label={tr("Task")}
            archived={!!task.archived_at}
            canArchive={can(user.actor, "archive", "task", record)}
            canDelete={can(user.actor, "delete", "task", record)}
            listPath="/tasks"
          >
            {canEdit && (
              <label className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm">
                <TaskCheck id={task.id} title={task.title} done={task.status === "done"} />
                {task.status === "done" ? tr("Done") : tr("Mark done")}
              </label>
            )}
            {canEdit && <TaskFormButton task={task} options={options} />}
          </RecordActions>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-6 lg:col-span-2">
          {task.description && (
            <Panel title={tr("Description")}>
              <p className="text-sm whitespace-pre-wrap">{task.description}</p>
            </Panel>
          )}
          <Panel title={tr("Comments")}>
            <div className="space-y-4">
              <CommentComposer entityType="task" entityId={task.id} />
              <Timeline entries={buildTimeline({ comments })} names={people.names} emptyText={tr("No comments yet.")} />
            </div>
          </Panel>
        </div>
        <Panel title={tr("Details")}>
          <Facts
            className="sm:grid-cols-1"
            items={[
              [tr("Due"), task.due_at ? `${formatDate(task.due_at)}${overdue ? " (overdue)" : ""}` : tr("No date")],
              [tr("Completed"), task.completed_at ? formatDate(task.completed_at) : null],
              [tr("Company"), task.company_id ? <Link key="c" href={`/companies/${task.company_id}`} className="text-brand hover:underline">{label(options.companies, task.company_id)}</Link> : null],
              [tr("Deal"), task.deal_id ? <Link key="d" href={`/deals/${task.deal_id}`} className="text-brand hover:underline">{label(options.deals, task.deal_id)}</Link> : null],
              [tr("Order"), task.order_id ? <Link key="o" href={`/orders/${task.order_id}`} className="text-brand hover:underline">{label(options.orders, task.order_id)}</Link> : null],
              [tr("Created by"), task.created_by ? people.names[task.created_by] : null],
              [tr("Created"), formatDate(task.created_at)],
            ]}
          />
        </Panel>
      </div>
    </div>
  );
}
