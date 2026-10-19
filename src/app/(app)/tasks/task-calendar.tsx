import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { TaskCheck } from "@/components/crm/task-check";
import { hrefWith, type Params } from "@/lib/url";
import { cn } from "@/lib/utils";

export type CalendarTask = { id: string; title: string; due_at: string; status: string; priority: string; overdue: boolean; can_edit: boolean };

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

function startOfWeek(d: Date): Date {
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
}

/** Range of days shown for a month or week view, anchored on `anchor` (YYYY-MM-DD). */
export function calendarRange(mode: "month" | "week", anchor: string): { days: string[]; prev: string; next: string; title: string } {
  const a = new Date(`${anchor}T00:00:00Z`);
  if (mode === "week") {
    const start = startOfWeek(a);
    const days = Array.from({ length: 7 }, (_, i) => iso(new Date(start.getTime() + i * DAY)));
    const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    return { days, prev: iso(new Date(start.getTime() - 7 * DAY)), next: iso(new Date(start.getTime() + 7 * DAY)), title: `${fmt.format(start)} – ${fmt.format(new Date(start.getTime() + 6 * DAY))}` };
  }
  const first = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1));
  const last = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 1, 0));
  const start = startOfWeek(first);
  const end = new Date(startOfWeek(last).getTime() + 6 * DAY);
  const days: string[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += DAY) days.push(iso(new Date(t)));
  return {
    days,
    prev: iso(new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() - 1, 1))),
    next: iso(new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 1, 1))),
    title: new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(first),
  };
}

export function TaskCalendar({ mode, anchor, tasks, params }: { mode: "month" | "week"; anchor: string; tasks: CalendarTask[]; params: Params }) {
  const { days, prev, next, title } = calendarRange(mode, anchor);
  const month = anchor.slice(0, 7);
  const today = iso(new Date());
  const byDay = new Map<string, CalendarTask[]>();
  for (const t of tasks) {
    const key = t.due_at.slice(0, 10);
    byDay.set(key, [...(byDay.get(key) ?? []), t]);
  }
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-md font-semibold">{title}</h2>
        <div className="flex items-center gap-1">
          <Link href={hrefWith("/tasks", params, { date: prev })} aria-label={`Previous ${mode}`} className="flex size-8 items-center justify-center rounded-md border border-border hover:bg-surface-muted">
            <ChevronLeft className="size-4" aria-hidden />
          </Link>
          <Link href={hrefWith("/tasks", params, { date: null })} className="rounded-md border border-border px-2.5 py-1 text-sm hover:bg-surface-muted">
            Today
          </Link>
          <Link href={hrefWith("/tasks", params, { date: next })} aria-label={`Next ${mode}`} className="flex size-8 items-center justify-center rounded-md border border-border hover:bg-surface-muted">
            <ChevronRight className="size-4" aria-hidden />
          </Link>
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[700px] grid-cols-7 overflow-hidden rounded-lg border border-border bg-border gap-px" role="grid" aria-label={`Tasks, ${title}`}>
          {weekdays.map((d) => (
            <div key={d} role="columnheader" className="bg-surface-subtle px-2 py-1.5 text-xs font-medium text-text-muted">
              {d}
            </div>
          ))}
          {days.map((day) => {
            const items = (byDay.get(day) ?? []).sort((a, b) => a.due_at.localeCompare(b.due_at));
            const outside = mode === "month" && day.slice(0, 7) !== month;
            return (
              <div key={day} role="gridcell" aria-label={day} className={cn("bg-surface p-1.5", mode === "month" ? "min-h-24" : "min-h-64", outside && "bg-surface-subtle")}>
                <div className={cn("mb-1 text-xs tabular-nums", day === today ? "inline-flex size-5 items-center justify-center rounded-full bg-brand font-semibold text-brand-foreground" : outside ? "text-text-muted" : "text-text-subtle")}>
                  {Number(day.slice(8))}
                </div>
                <ul className="space-y-1">
                  {items.slice(0, mode === "month" ? 4 : 20).map((t) => (
                    <li key={t.id} className={cn("flex items-start gap-1.5 rounded px-1 py-0.5 text-xs", t.overdue ? "bg-danger-bg text-danger" : t.status === "done" ? "text-text-muted line-through" : "bg-surface-muted")}>
                      <span className="pt-px">
                        <TaskCheck id={t.id} title={t.title} done={t.status === "done"} disabled={!t.can_edit} />
                      </span>
                      <Link href={`/tasks/${t.id}`} className="line-clamp-2 hover:underline">
                        {t.title}
                      </Link>
                    </li>
                  ))}
                  {mode === "month" && items.length > 4 && <li className="px-1 text-[11px] text-text-muted">+{items.length - 4} more</li>}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
