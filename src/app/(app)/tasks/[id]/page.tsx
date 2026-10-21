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

export async function generateMetadata({ params }: PageProps<"/tasks/[id]">) {
  const { id } = await params;
  return { title: (await recordTitle("tasks", id)) ?? "Task" };
}

export default async function TaskPage({ params }: PageProps<"/tasks/[id]">) {
  const { user } = await requirePermission("view", "task");
  const { id } = await params;
  const { data, people, options } = await loadPage(async (ctx) => ({ data: await getTask(ctx, id), people: await peopleFor(ctx, "task"), options: await taskFormOptions(ctx) }));
  const { task, comments } = data;
  const record = { organization_id: task.organization_id, owner_id: task.assignee_id };
  const canEdit = can(user.actor, "update", "task", record) && !task.archived_at;
  const overdue = isOverdue(task, new Date());
  const label = (list: Array<{ value: string; label: string }>, value: string | null) => (value ? (list.find((o) => o.value === value)?.label ?? "Linked record") : null);

  return (
    <div className="space-y-6">
      <DetailHeader
        back={{ href: "/tasks", label: "Tasks" }}
        path={`/tasks/${task.id}`}
        title={task.title}
        subtitle={`${humanizeStatus(task.type)} · assigned to ${people.names[task.assignee_id] ?? "Former member"}`}
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
            label="Task"
            archived={!!task.archived_at}
            canArchive={can(user.actor, "archive", "task", record)}
            canDelete={can(user.actor, "delete", "task", record)}
            listPath="/tasks"
          >
            {canEdit && (
              <label className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm">
                <TaskCheck id={task.id} title={task.title} done={task.status === "done"} />
                {task.status === "done" ? "Done" : "Mark done"}
              </label>
            )}
            {canEdit && <TaskFormButton task={task} options={options} />}
          </RecordActions>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-6 lg:col-span-2">
          {task.description && (
            <Panel title="Description">
              <p className="text-sm whitespace-pre-wrap">{task.description}</p>
            </Panel>
          )}
          <Panel title="Comments">
            <div className="space-y-4">
              <CommentComposer entityType="task" entityId={task.id} />
              <Timeline entries={buildTimeline({ comments })} names={people.names} emptyText="No comments yet." />
            </div>
          </Panel>
        </div>
        <Panel title="Details">
          <Facts
            className="sm:grid-cols-1"
            items={[
              ["Due", task.due_at ? `${formatDate(task.due_at)}${overdue ? " (overdue)" : ""}` : "No date"],
              ["Completed", task.completed_at ? formatDate(task.completed_at) : null],
              ["Company", task.company_id ? <Link key="c" href={`/companies/${task.company_id}`} className="text-brand hover:underline">{label(options.companies, task.company_id)}</Link> : null],
              ["Deal", task.deal_id ? <Link key="d" href={`/deals/${task.deal_id}`} className="text-brand hover:underline">{label(options.deals, task.deal_id)}</Link> : null],
              ["Order", task.order_id ? <Link key="o" href={`/orders/${task.order_id}`} className="text-brand hover:underline">{label(options.orders, task.order_id)}</Link> : null],
              ["Created by", task.created_by ? people.names[task.created_by] : null],
              ["Created", formatDate(task.created_at)],
            ]}
          />
        </Panel>
      </div>
    </div>
  );
}
