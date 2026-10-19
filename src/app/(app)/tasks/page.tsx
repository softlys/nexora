import { CalendarDays, CalendarRange, List, ListChecks, MessagesSquare } from "lucide-react";
import Link from "next/link";
import { TaskCheck } from "@/components/crm/task-check";
import { TaskFormButton } from "@/components/crm/task-form";
import { ListTable } from "@/components/list/list-table";
import { ListToolbar } from "@/components/list/list-toolbar";
import { EmptyState } from "@/components/patterns/empty-state";
import { PageHeader } from "@/components/patterns/page-header";
import { humanizeStatus, StatusBadge } from "@/components/patterns/status-badge";
import { TASK_PRIORITIES } from "@/domain/entities";
import { can } from "@/domain/permissions";
import { enumFilter, first, parseListQuery, stringFilter } from "@/domain/list";
import { formatDate, formatRelative } from "@/lib/format";
import { hrefWith } from "@/lib/url";
import { cn } from "@/lib/utils";
import { requirePermission } from "@/server/guards";
import { loadPage, peopleFor, permissionsFor, taskFormOptions } from "@/server/page-data";
import { listTasks, recentActivities } from "@/server/services/tasks";
import { calendarRange, TaskCalendar } from "./task-calendar";

export const metadata = { title: "Tasks & Activities" };

const VIEWS = [
  ["list", "List", List],
  ["month", "Month", CalendarDays],
  ["week", "Week", CalendarRange],
  ["activity", "Activity feed", MessagesSquare],
] as const;

export default async function TasksPage({ searchParams }: PageProps<"/tasks">) {
  const { user } = await requirePermission("view", "task");
  const params = await searchParams;
  const viewParam = first(params.view);
  const view = (VIEWS.find(([v]) => v === viewParam)?.[0] ?? "list") as (typeof VIEWS)[number][0];
  const query = parseListQuery(params);
  const status = first(params.status);
  const filters = {
    owner: stringFilter(params, "owner", 36),
    priority: enumFilter(params, "priority", TASK_PRIORITIES),
    status: (["open", "overdue", "todo", "in_progress", "done", "cancelled"] as const).find((s) => s === status) ?? (view === "list" && status === undefined ? ("open" as const) : undefined),
  };
  const dateParam = first(params.date);
  const anchor = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : new Date().toISOString().slice(0, 10);
  const range = view === "month" || view === "week" ? calendarRange(view, anchor) : null;

  const { page, people, perms, options, activities } = await loadPage(async (ctx) => ({
    page:
      view === "activity"
        ? null
        : await listTasks(ctx, range ? { ...query, page: 1, size: 100 } : query, range ? { ...filters, from: range.days[0], to: range.days.at(-1) } : filters),
    people: await peopleFor(ctx, "task"),
    perms: permissionsFor(ctx, "task"),
    options: await taskFormOptions(ctx),
    activities: view === "activity" ? await recentActivities(ctx, 100) : null,
  }));
  const canEdit = (assignee: string) => can(user.actor, "update", "task", { organization_id: user.actor.organization_id, owner_id: assignee });
  const autoOpen = first(params.new) === "1";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Tasks & Activities"
        description="Your follow-ups and the history of customer interactions."
        actions={perms.canCreate && <TaskFormButton options={options} autoOpen={autoOpen} />}
      />
      <nav aria-label="Views" className="flex flex-wrap gap-1 border-b border-border">
        {VIEWS.map(([v, label, Icon]) => (
          <Link
            key={v}
            href={hrefWith("/tasks", {}, { view: v === "list" ? null : v })}
            aria-current={view === v ? "page" : undefined}
            className={cn("-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm", view === v ? "border-brand font-medium text-foreground" : "border-transparent text-text-muted hover:text-foreground")}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </Link>
        ))}
      </nav>

      {view !== "activity" && (
        <ListToolbar
          searchPlaceholder="Search tasks…"
          showArchivedToggle={view === "list"}
          filters={[
            {
              key: "status",
              label: "Statuses",
              options: [
                { value: "open", label: "Open" },
                { value: "overdue", label: "Overdue" },
                { value: "todo", label: "To do" },
                { value: "in_progress", label: "In progress" },
                { value: "done", label: "Done" },
                { value: "cancelled", label: "Cancelled" },
              ],
            },
            { key: "priority", label: "Priorities", options: TASK_PRIORITIES.map((p) => ({ value: p, label: humanizeStatus(p) })) },
            ...(people.assignable.length > 1 ? [{ key: "owner", label: "Assignees", options: people.assignable }] : []),
          ]}
        />
      )}

      {view === "list" && page && (
        <ListTable
          caption="Tasks"
          basePath="/tasks"
          params={params}
          {...page}
          rowKey={(t) => t.id}
          columns={[
            { id: "done", header: "Done", className: "w-12", cell: (t) => <TaskCheck id={t.id} title={t.title} done={t.status === "done"} disabled={!canEdit(t.assignee_id) || !!t.archived_at} /> },
            {
              id: "title",
              header: "Task",
              sort: "title",
              cell: (t) => (
                <div className="min-w-0">
                  <Link href={`/tasks/${t.id}`} className={cn("font-medium hover:underline", t.status === "done" && "text-text-muted line-through")}>
                    {t.title}
                  </Link>
                  {t.related && (
                    <div className="truncate text-xs text-text-muted">
                      <Link href={`/${t.related.kind === "company" ? "companies" : `${t.related.kind}s`}/${t.related.id}`} className="hover:underline">
                        {t.related.label}
                      </Link>
                    </div>
                  )}
                </div>
              ),
            },
            {
              id: "due",
              header: "Due",
              sort: "due",
              cell: (t) =>
                t.due_at ? (
                  <span className={cn("whitespace-nowrap", t.overdue ? "font-medium text-danger" : "text-text-subtle")}>
                    {t.overdue && <span className="sr-only">Overdue: </span>}
                    {formatDate(t.due_at)}
                    {t.overdue && <span className="ml-1 text-xs">overdue</span>}
                  </span>
                ) : (
                  <span className="text-text-muted">No date</span>
                ),
            },
            { id: "priority", header: "Priority", sort: "priority", hideBelow: "sm", cell: (t) => <StatusBadge status={t.priority} /> },
            { id: "status", header: "Status", sort: "status", hideBelow: "md", cell: (t) => <StatusBadge status={t.status} /> },
            { id: "assignee", header: "Assignee", sort: "assignee", hideBelow: "lg", cell: (t) => <span className="text-text-subtle">{t.assignee_name}</span> },
          ]}
          empty={
            <EmptyState
              icon={ListChecks}
              title="No tasks here"
              description={filters.status === "open" ? "Nothing open. Change the status filter to see completed tasks." : "Try a different filter."}
              className="m-4 border-0 bg-transparent"
            />
          }
        />
      )}

      {range && page && (
        <TaskCalendar
          mode={view as "month" | "week"}
          anchor={anchor}
          params={params}
          tasks={page.rows.filter((t) => t.due_at).map((t) => ({ id: t.id, title: t.title, due_at: t.due_at!, status: t.status, priority: t.priority, overdue: t.overdue, can_edit: canEdit(t.assignee_id) }))}
        />
      )}

      {activities && (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {activities.length === 0 && <li className="p-6 text-center text-sm text-text-muted">No activities yet.</li>}
          {activities.map((a) => (
            <li key={a.id} className="flex flex-col gap-0.5 px-4 py-3 text-sm sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge label={humanizeStatus(a.type)} tone={a.type === "system" ? "neutral" : "info"} />
                  <span className="font-medium">{a.subject}</span>
                </div>
                {a.body && <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-text-subtle">{a.body}</p>}
                {a.related && (
                  <Link href={a.related.href} className="mt-0.5 inline-block text-xs text-brand hover:underline">
                    {a.related.label}
                  </Link>
                )}
              </div>
              <span className="shrink-0 text-xs text-text-muted">
                {a.actor_name} · <time dateTime={a.occurred_at}>{formatRelative(a.occurred_at)}</time>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
