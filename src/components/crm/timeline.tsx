import { ArrowRightLeft, CheckCircle2, Circle, Mail, MessageCircle, MessageSquare, NotebookPen, Phone, Repeat, Settings2, Users } from "lucide-react";
import type { TimelineEntry } from "@/domain/timeline";
import { formatDate, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/patterns/status-badge";
import { tr, trNode } from "@/lib/i18n";

const ACTIVITY_ICON = { call: Phone, meeting: Users, email: Mail, note: NotebookPen, follow_up: Repeat, message: MessageCircle, system: Settings2 } as const;

/**
 * Combined record timeline. User text (notes, comments, activity bodies) is rendered as
 * plain text; nothing here uses dangerouslySetInnerHTML.
 */
export function Timeline({ entries, names, emptyText = "No activity yet." }: { entries: TimelineEntry[]; names: Record<string, string>; emptyText?: string }) {
  if (entries.length === 0) return <p className="py-6 text-center text-sm text-text-muted">{trNode(emptyText)}</p>;
  const who = (id: string | null) => (id ? (names[id] ?? tr("Former member")) : tr("System"));
  return (
    <ol className="relative space-y-4 border-l border-border pl-5" aria-label={tr("Timeline")}>
      {entries.map((e) => {
        const Icon =
          e.kind === "activity" ? ACTIVITY_ICON[e.activity_type] : e.kind === "task" ? (e.status === "done" ? CheckCircle2 : Circle) : e.kind === "stage" ? ArrowRightLeft : MessageSquare;
        return (
          <li key={`${e.kind}-${e.id}`} className="relative">
            <span className={cn("absolute top-0.5 -left-[29px] flex size-[18px] items-center justify-center rounded-full border border-border bg-surface", e.kind === "stage" && "text-brand")}>
              <Icon className="size-3" aria-hidden />
            </span>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
              {e.kind === "activity" && <span className="font-medium">{e.title}</span>}
              {e.kind === "task" && (
                <>
                  <span className="font-medium">{e.title}</span>
                  <StatusBadge status={e.status} />
                </>
              )}
              {e.kind === "stage" && (
                <span>
                  {e.from ? (
                    <>{tr("Moved from")} <span className="font-medium">{trNode(e.from)}</span> {tr("to")} <span className="font-medium">{trNode(e.to)}</span>
                    </>
                  ) : (
                    <>{tr("Created in")} <span className="font-medium">{trNode(e.to)}</span>
                    </>
                  )}
                </span>
              )}
              {e.kind === "comment" && <span className="font-medium">{tr("Comment")}</span>}
              <span className="text-xs text-text-muted">
                {who(e.actor_id)} · <time dateTime={e.at} title={formatDate(e.at)}>{formatRelative(e.at)}</time>
              </span>
            </div>
            {e.kind === "activity" && e.body && <p className="mt-1 text-sm whitespace-pre-wrap text-text-subtle">{e.body}</p>}
            {e.kind === "comment" && <p className="mt-1 text-sm whitespace-pre-wrap text-text-subtle">{e.body}</p>}
            {e.kind === "task" && e.due_at && e.status !== "done" && <p className="mt-0.5 text-xs text-text-muted">{tr("Due")} {formatDate(e.due_at)}</p>}
          </li>
        );
      })}
    </ol>
  );
}
