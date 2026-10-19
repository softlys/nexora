import type { z } from "zod";
import type { Activity, Comment, Task } from "@/domain/entities";
import { diffFields } from "@/domain/diff";
import type { activityInput, commentInput, taskInput, taskUpdateInput } from "@/domain/inputs";
import { applyListQuery, type ListQuery } from "@/domain/list";
import { isWithinScope, scopeFor } from "@/domain/permissions";
import { DomainError } from "@/server/repositories/types";
import { emit, emitSecurity, findVisible, newId, nowOf, requireCan, resolveOwner, type ServiceContext } from "./context";
import { assertLinksVisible, byId, getOwned, type OwnedTable } from "./records";
import { PermissionError } from "@/domain/permissions";

export function isOverdue(task: Pick<Task, "status" | "due_at">, now: Date): boolean {
  return (task.status === "todo" || task.status === "in_progress") && task.due_at !== null && task.due_at < now.toISOString();
}

export type TaskFilters = { owner?: string; priority?: Task["priority"]; status?: Task["status"] | "open" | "overdue"; from?: string; to?: string };

export async function listTasks(ctx: ServiceContext, query: ListQuery, filters: TaskFilters) {
  return ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const now = nowOf(ctx);
    const [rows, profiles, companies, deals, orders] = await Promise.all([
      findVisible(tx, ctx, "tasks", "task", (r) => r.assignee_id),
      tx.find("profiles"),
      tx.find("companies"),
      tx.find("deals"),
      tx.find("orders"),
    ]);
    const profileById = byId(profiles);
    const companyById = byId(companies);
    const dealById = byId(deals);
    const orderById = byId(orders);
    const enriched = rows
      .filter((t) => (query.archived === "1" ? t.archived_at !== null : t.archived_at === null))
      .map((t) => ({
        ...t,
        overdue: isOverdue(t, now),
        assignee_name: profileById.get(t.assignee_id)?.full_name ?? "Unknown",
        related: t.deal_id
          ? { kind: "deal" as const, id: t.deal_id, label: dealById.get(t.deal_id)?.name ?? "Deal" }
          : t.order_id
            ? { kind: "order" as const, id: t.order_id, label: orderById.get(t.order_id)?.order_number ?? "Order" }
            : t.company_id
              ? { kind: "company" as const, id: t.company_id, label: companyById.get(t.company_id)?.name ?? "Company" }
              : null,
      }))
      .filter(
        (t) =>
          (!filters.owner || t.assignee_id === filters.owner) &&
          (!filters.priority || t.priority === filters.priority) &&
          (!filters.status ||
            (filters.status === "open" ? t.status === "todo" || t.status === "in_progress" : filters.status === "overdue" ? t.overdue : t.status === filters.status)) &&
          (!filters.from || (t.due_at ?? "") >= filters.from) &&
          (!filters.to || (t.due_at ?? "9999") <= `${filters.to}T23:59:59.999Z`),
      );
    const priorityRank = { urgent: 0, high: 1, medium: 2, low: 3 };
    return applyListQuery(enriched, query, {
      searchText: (t) => `${t.title} ${t.description} ${t.related?.label ?? ""} ${t.assignee_name}`,
      sorters: {
        due: (t) => t.due_at,
        priority: (t) => priorityRank[t.priority],
        title: (t) => t.title.toLowerCase(),
        status: (t) => t.status,
        assignee: (t) => t.assignee_name,
      },
      defaultSort: { key: "due", dir: "asc" },
    });
  });
}

/** Rep: only to themselves. Manager: within the team. Admin: anyone active. */
async function resolveAssignee(ctx: ServiceContext, tx: Parameters<typeof resolveOwner>[0], requested: string, current: string | null, targetId: string | null) {
  if (requested === current) return requested;
  const scope = scopeFor(ctx.actor.role, "update", "task");
  if (!scope || !isWithinScope(ctx.actor, scope, requested)) {
    emitSecurity(ctx, { type: "authz.denied", payload: { action: "assign", resource: "task", target_id: targetId, reason: "forbidden_field" } });
    throw new PermissionError("update", "task");
  }
  return (await resolveOwner(tx, ctx, "task", requested, current, targetId))!;
}

export async function createTask(ctx: ServiceContext, input: z.output<typeof taskInput>): Promise<Task> {
  requireCan(ctx, "create", "task");
  return ctx.db.write(ctx.actor.organization_id, async (tx) => {
    await assertLinksVisible(tx, ctx, { company_id: input.company_id, contact_id: input.contact_id, deal_id: input.deal_id, order_id: input.order_id });
    // New tasks default to the creator, so assigning to yourself is never a reassignment.
    const assignee = await resolveAssignee(ctx, tx, input.assignee_id, ctx.actor.id, null);
    const at = nowOf(ctx).toISOString();
    const task: Task = {
      id: newId(),
      organization_id: ctx.actor.organization_id,
      ...input,
      assignee_id: assignee,
      created_by: ctx.actor.id,
      completed_at: input.status === "done" ? at : null,
      created_at: at,
      updated_at: at,
      archived_at: null,
    };
    await tx.insert("tasks", task);
    await emit(tx, ctx, { type: "record.created", payload: { entity: "task", id: task.id, after: task } });
    return task;
  });
}

export async function updateTask(ctx: ServiceContext, input: z.output<typeof taskUpdateInput>): Promise<Task> {
  return ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const current = await getOwned(tx, ctx, "tasks", input.id);
    requireCan(ctx, "update", "task", current.assignee_id, current.id);
    const links = { company_id: input.company_id, contact_id: input.contact_id, deal_id: input.deal_id, order_id: input.order_id };
    const changedLinks = Object.fromEntries(Object.entries(links).filter(([k, v]) => v !== current[k as keyof typeof links]));
    await assertLinksVisible(tx, ctx, changedLinks);
    const assignee = await resolveAssignee(ctx, tx, input.assignee_id, current.assignee_id, current.id);
    const { id, ...fields } = input;
    const at = nowOf(ctx).toISOString();
    const patch = {
      ...fields,
      assignee_id: assignee,
      completed_at: fields.status === "done" ? (current.completed_at ?? at) : null,
    };
    const changes = diffFields(current as unknown as Record<string, unknown>, patch);
    if (Object.keys(changes).length === 0) return current;
    const updated = await tx.update("tasks", id, { ...patch, updated_at: at });
    await emit(tx, ctx, { type: "record.updated", payload: { entity: "task", id, changes } });
    if (changes.assignee_id) await emit(tx, ctx, { type: "record.owner_changed", payload: { entity: "task", id, from: current.assignee_id, to: assignee } });
    if (current.status !== "done" && fields.status === "done") await emit(tx, ctx, { type: "task.completed", payload: { task_id: id, assignee_id: assignee } });
    return updated;
  });
}

/** One-click complete (and undo). */
export async function setTaskDone(ctx: ServiceContext, id: string, done: boolean): Promise<Task> {
  return ctx.db.write(ctx.actor.organization_id, async (tx) => {
    const task = await getOwned(tx, ctx, "tasks", id);
    requireCan(ctx, "update", "task", task.assignee_id, task.id);
    if (task.archived_at) throw new DomainError("Restore the task first.");
    const at = nowOf(ctx).toISOString();
    if (done && task.status === "done") return task;
    if (!done && task.status !== "done") return task;
    const status = done ? "done" : "todo";
    const updated = await tx.update("tasks", id, { status, completed_at: done ? at : null, updated_at: at });
    await emit(tx, ctx, { type: "record.updated", payload: { entity: "task", id, changes: { status: { before: task.status, after: status } } } });
    if (done) await emit(tx, ctx, { type: "task.completed", payload: { task_id: id, assignee_id: task.assignee_id } });
    return updated;
  });
}

export async function getTask(ctx: ServiceContext, id: string) {
  return ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const task = await getOwned(tx, ctx, "tasks", id);
    const comments = (await tx.find("comments", { entity_type: "task", entity_id: id })).filter((c) => !c.archived_at).sort((a, b) => a.created_at.localeCompare(b.created_at));
    return { task, comments };
  });
}

/** Logs an activity on records the actor can see. The actor is always the current user. */
export async function logActivity(ctx: ServiceContext, input: z.output<typeof activityInput>): Promise<Activity> {
  requireCan(ctx, "create", "activity");
  return ctx.db.write(ctx.actor.organization_id, async (tx) => {
    await assertLinksVisible(tx, ctx, { company_id: input.company_id, contact_id: input.contact_id, deal_id: input.deal_id, order_id: input.order_id, lead_id: input.lead_id });
    const at = nowOf(ctx).toISOString();
    // Fill the company from the linked deal, contact or order so company timelines include it.
    let companyId = input.company_id;
    if (!companyId && input.deal_id) companyId = (await tx.get("deals", input.deal_id))?.company_id ?? null;
    if (!companyId && input.order_id) companyId = (await tx.get("orders", input.order_id))?.company_id ?? null;
    if (!companyId && input.contact_id) companyId = (await tx.get("contacts", input.contact_id))?.company_id ?? null;
    const activity: Activity = {
      id: newId(),
      organization_id: ctx.actor.organization_id,
      type: input.type,
      subject: input.subject,
      body: input.body,
      occurred_at: input.occurred_at ?? at,
      actor_id: ctx.actor.id,
      company_id: companyId,
      contact_id: input.contact_id,
      lead_id: input.lead_id,
      deal_id: input.deal_id,
      order_id: input.order_id,
      created_at: at,
      updated_at: at,
    };
    await tx.insert("activities", activity);
    await emit(tx, ctx, { type: "record.created", payload: { entity: "activity", id: activity.id, after: activity } });
    return activity;
  });
}

const ENTITY_TABLE: Record<Comment["entity_type"], OwnedTable> = {
  company: "companies",
  contact: "contacts",
  lead: "leads",
  deal: "deals",
  order: "orders",
  task: "tasks",
};

/** Comments are plain text. They are rendered as text, never as HTML. */
export async function addComment(ctx: ServiceContext, input: z.output<typeof commentInput>): Promise<Comment> {
  requireCan(ctx, "create", "comment");
  return ctx.db.write(ctx.actor.organization_id, async (tx) => {
    await getOwned(tx, ctx, ENTITY_TABLE[input.entity_type], input.entity_id);
    const at = nowOf(ctx).toISOString();
    const comment: Comment = {
      id: newId(),
      organization_id: ctx.actor.organization_id,
      entity_type: input.entity_type,
      entity_id: input.entity_id,
      author_id: ctx.actor.id,
      body: input.body,
      created_at: at,
      updated_at: at,
      archived_at: null,
    };
    await tx.insert("comments", comment);
    await emit(tx, ctx, { type: "record.created", payload: { entity: "comment", id: comment.id, after: { entity_type: comment.entity_type, entity_id: comment.entity_id } } });
    return comment;
  });
}

/**
 * Recent activities the actor may see: their own (or their team's) plus activities on
 * records they can see, matching the RLS rule for activities.
 */
export async function recentActivities(ctx: ServiceContext, limit = 50) {
  return ctx.db.read(ctx.actor.organization_id, async (tx) => {
    const [activities, deals, companies, orders, leads, profiles] = await Promise.all([
      tx.find("activities"),
      findVisible(tx, ctx, "deals", "deal", (r) => r.owner_id),
      findVisible(tx, ctx, "companies", "company", (r) => r.owner_id),
      findVisible(tx, ctx, "orders", "order", (r) => r.owner_id),
      findVisible(tx, ctx, "leads", "lead", (r) => r.owner_id),
      tx.find("profiles"),
    ]);
    const scope = scopeFor(ctx.actor.role, "view", "activity");
    const ids = { deal: new Set(deals.map((d) => d.id)), company: new Set(companies.map((c) => c.id)), order: new Set(orders.map((o) => o.id)), lead: new Set(leads.map((l) => l.id)) };
    const dealName = byId(deals);
    const companyName = byId(companies);
    const orderNumber = byId(orders);
    const names = byId(profiles);
    return activities
      .filter(
        (a) =>
          (scope !== null && isWithinScope(ctx.actor, scope, a.actor_id)) ||
          (a.deal_id && ids.deal.has(a.deal_id)) ||
          (a.company_id && ids.company.has(a.company_id)) ||
          (a.order_id && ids.order.has(a.order_id)) ||
          (a.lead_id && ids.lead.has(a.lead_id)),
      )
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
      .slice(0, Math.min(limit, 200))
      .map((a) => ({
        ...a,
        actor_name: a.actor_id ? (names.get(a.actor_id)?.full_name ?? "Former member") : "System",
        related: a.deal_id && dealName.get(a.deal_id)
          ? { href: `/deals/${a.deal_id}`, label: dealName.get(a.deal_id)!.name }
          : a.order_id && orderNumber.get(a.order_id)
            ? { href: `/orders/${a.order_id}`, label: orderNumber.get(a.order_id)!.order_number }
            : a.company_id && companyName.get(a.company_id)
              ? { href: `/companies/${a.company_id}`, label: companyName.get(a.company_id)!.name }
              : a.lead_id
                ? { href: `/leads/${a.lead_id}`, label: "Lead" }
                : null,
      }));
  });
}
