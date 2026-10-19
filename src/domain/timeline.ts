/**
 * Record timelines: activities, tasks, stage changes and comments merged in time order
 * (newest first). Pure so every record page builds it the same way.
 */
import type { Activity, Comment, DealStageHistory, PipelineStage, Task } from "./entities";

export type TimelineEntry =
  | { kind: "activity"; id: string; at: string; actor_id: string | null; activity_type: Activity["type"]; title: string; body: string }
  | { kind: "task"; id: string; at: string; actor_id: string | null; title: string; status: Task["status"]; due_at: string | null; priority: Task["priority"] }
  | { kind: "stage"; id: string; at: string; actor_id: string | null; deal_id: string; from: string | null; to: string }
  | { kind: "comment"; id: string; at: string; actor_id: string | null; body: string };

export function buildTimeline(input: {
  activities?: Activity[];
  tasks?: Task[];
  stageHistory?: DealStageHistory[];
  comments?: Comment[];
  stages?: PipelineStage[];
}): TimelineEntry[] {
  const stageName = new Map((input.stages ?? []).map((s) => [s.id, s.name]));
  const entries: TimelineEntry[] = [
    ...(input.activities ?? []).map(
      (a): TimelineEntry => ({ kind: "activity", id: a.id, at: a.occurred_at, actor_id: a.actor_id, activity_type: a.type, title: a.subject, body: a.body }),
    ),
    ...(input.tasks ?? []).map(
      (t): TimelineEntry => ({
        kind: "task",
        id: t.id,
        at: t.completed_at ?? t.created_at,
        actor_id: t.assignee_id,
        title: t.title,
        status: t.status,
        due_at: t.due_at,
        priority: t.priority,
      }),
    ),
    ...(input.stageHistory ?? []).map(
      (h): TimelineEntry => ({
        kind: "stage",
        id: h.id,
        at: h.changed_at,
        actor_id: h.changed_by,
        deal_id: h.deal_id,
        from: h.from_stage_id ? (stageName.get(h.from_stage_id) ?? "Removed stage") : null,
        to: stageName.get(h.to_stage_id) ?? "Removed stage",
      }),
    ),
    ...(input.comments ?? []).filter((c) => !c.archived_at).map((c): TimelineEntry => ({ kind: "comment", id: c.id, at: c.created_at, actor_id: c.author_id, body: c.body })),
  ];
  return entries.sort((a, b) => (a.at === b.at ? a.id.localeCompare(b.id) : b.at.localeCompare(a.at)));
}

/** Most recent interaction (activity) for a contact, or null. */
export function lastInteraction(activities: Array<Pick<Activity, "contact_id" | "occurred_at" | "type">>, contactId: string): string | null {
  let latest: string | null = null;
  for (const a of activities) {
    if (a.contact_id !== contactId || a.type === "system") continue;
    if (!latest || a.occurred_at > latest) latest = a.occurred_at;
  }
  return latest;
}
