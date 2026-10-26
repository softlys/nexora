import "server-only";
import { randomUUID } from "node:crypto";
import type { AuditLog, Dataset, Pipeline, PipelineStage } from "@/domain/entities";
import { visibleOwnerIds, type Resource } from "@/domain/permissions";
import { demoDataPath } from "@/server/env";
import { DemoStore } from "@/server/demo/file-store";
import { DomainError, type RepoContext, type Repositories } from "../types";

const globalStore = globalThis as unknown as { __nexoraDemoStore?: DemoStore };

/** One store per server process, surviving dev hot reloads. */
export function getDemoStore(): DemoStore {
  globalStore.__nexoraDemoStore ??= new DemoStore(demoDataPath());
  return globalStore.__nexoraDemoStore;
}

const nowIso = () => new Date().toISOString();

function inOrg<T extends { organization_id: string }>(ctx: RepoContext, rows: T[]): T[] {
  return rows.filter((r) => r.organization_id === ctx.actor.organization_id);
}

function visible<T extends { organization_id: string; archived_at?: string | null }>(
  ctx: RepoContext,
  rows: T[],
  resource: Resource,
  ownerOf: (row: T) => string | null,
): T[] {
  const owners = visibleOwnerIds(ctx.actor, resource);
  return inOrg(ctx, rows).filter(
    (r) => !r.archived_at && (owners === "all" || (ownerOf(r) !== null && owners.includes(ownerOf(r)!))),
  );
}

function auditRow(ctx: RepoContext, entry: Pick<AuditLog, "action" | "target_type" | "target_id" | "changes">): AuditLog {
  return {
    id: randomUUID(),
    organization_id: ctx.actor.organization_id,
    actor_id: ctx.actor.id,
    actor_role: ctx.actor.role,
    ip: ctx.meta.ip,
    user_agent: ctx.meta.user_agent,
    request_id: ctx.meta.request_id,
    created_at: nowIso(),
    ...entry,
  };
}

function sortedPipelines(data: Dataset, ctx: RepoContext): Pipeline[] {
  return inOrg(ctx, data.pipelines).filter((p) => !p.archived_at).sort((a, b) => a.position - b.position);
}

/** Stages of one pipeline, or of all pipelines (in pipeline order), by position. */
function sortedStages(data: Dataset, ctx: RepoContext, pipelineId?: string): PipelineStage[] {
  const order = new Map(sortedPipelines(data, ctx).map((p, i) => [p.id, i]));
  return inOrg(ctx, data.pipeline_stages)
    .filter((s) => (pipelineId ? s.pipeline_id === pipelineId : order.has(s.pipeline_id)))
    .sort((a, b) => (order.get(a.pipeline_id) ?? 0) - (order.get(b.pipeline_id) ?? 0) || a.position - b.position);
}

/** Only one won and one lost stage are allowed so conversions and metrics stay unambiguous. */
function assertSingleTerminalStages(stages: PipelineStage[]) {
  if (stages.filter((s) => s.is_won).length !== 1) throw new DomainError("The pipeline needs exactly one won stage.", "conflict");
  if (stages.filter((s) => s.is_lost).length !== 1) throw new DomainError("The pipeline needs exactly one lost stage.", "conflict");
}

export function createDemoRepositories(): Repositories {
  const store = getDemoStore();

  return {
    organizations: {
      async current(ctx) {
        const data = await store.read();
        const org = data.organizations.find((o) => o.id === ctx.actor.organization_id);
        if (!org) throw new DomainError("Organization not found.", "not_found");
        return org;
      },
      async update(ctx, patch) {
        return store.mutate((data) => {
          const org = data.organizations.find((o) => o.id === ctx.actor.organization_id);
          if (!org) throw new DomainError("Organization not found.", "not_found");
          const before = { name: org.name, currency: org.currency, locale: org.locale, settings: { ...org.settings } };
          Object.assign(org, {
            ...(patch.name !== undefined && { name: patch.name }),
            ...(patch.currency !== undefined && { currency: patch.currency }),
            ...(patch.locale !== undefined && { locale: patch.locale }),
            settings: { ...org.settings, ...patch.settings },
            updated_at: nowIso(),
          });
          data.audit_logs.push(
            auditRow(ctx, {
              action: "organization.updated",
              target_type: "organization",
              target_id: org.id,
              changes: { before, after: { name: org.name, currency: org.currency, locale: org.locale, settings: org.settings } },
            }),
          );
          return org;
        });
      },
    },

    profiles: {
      async list(ctx) {
        const data = await store.read();
        return inOrg(ctx, data.profiles)
          .filter((p) => !p.archived_at)
          .sort((a, b) => a.full_name.localeCompare(b.full_name));
      },
      async get(ctx, id) {
        const data = await store.read();
        return inOrg(ctx, data.profiles).find((p) => p.id === id) ?? null;
      },
      async updateOwn(ctx, patch) {
        return store.mutate((data) => {
          const me = inOrg(ctx, data.profiles).find((p) => p.id === ctx.actor.id);
          if (!me) throw new DomainError("Profile not found.", "not_found");
          me.full_name = patch.full_name;
          me.title = patch.title;
          me.updated_at = nowIso();
          return me;
        });
      },
      async changeRole(ctx, profileId, role) {
        return store.mutate((data) => {
          const profiles = inOrg(ctx, data.profiles);
          const target = profiles.find((p) => p.id === profileId && !p.archived_at);
          if (!target) throw new DomainError("Team member not found.", "not_found");
          if (target.role === role) return target;
          const activeAdmins = profiles.filter((p) => p.role === "admin" && p.is_active && !p.archived_at);
          if (target.role === "admin" && activeAdmins.length <= 1) {
            throw new DomainError("The organization needs at least one active admin.", "conflict");
          }
          const before = target.role;
          target.role = role;
          target.updated_at = nowIso();
          data.audit_logs.push(
            auditRow(ctx, { action: "profile.role_changed", target_type: "profile", target_id: target.id, changes: { role: { before, after: role } } }),
          );
          return target;
        });
      },
      async setActive(ctx, profileId, active) {
        return store.mutate((data) => {
          const profiles = inOrg(ctx, data.profiles);
          const target = profiles.find((p) => p.id === profileId && !p.archived_at);
          if (!target) throw new DomainError("Team member not found.", "not_found");
          const activeAdmins = profiles.filter((p) => p.role === "admin" && p.is_active && !p.archived_at);
          if (!active && target.role === "admin" && activeAdmins.length <= 1) throw new DomainError("The organization needs at least one active admin.", "conflict");
          if (target.is_active === active) return target;
          target.is_active = active;
          target.updated_at = nowIso();
          data.audit_logs.push(
            auditRow(ctx, { action: active ? "profile.enabled" : "profile.disabled", target_type: "profile", target_id: target.id, changes: { is_active: { before: !active, after: active } } }),
          );
          return target;
        });
      },
      async invite() {
        throw new DomainError("Invitations are available only in Supabase mode.");
      },
    },

    pipelines: {
      async list(ctx) {
        return sortedPipelines(await store.read(), ctx);
      },
      async create(ctx, input) {
        return store.mutate((data) => {
          const existing = sortedPipelines(data, ctx);
          if (existing.some((p) => p.name.toLowerCase() === input.name.toLowerCase())) throw new DomainError("A pipeline with this name already exists.", "conflict");
          assertSingleTerminalStages(input.stages as PipelineStage[]);
          const at = nowIso();
          const pipeline: Pipeline = { id: randomUUID(), organization_id: ctx.actor.organization_id, name: input.name, position: existing.length, created_at: at, updated_at: at, archived_at: null };
          data.pipelines.push(pipeline);
          // Open stages first, then won and lost.
          const ordered = [...input.stages.filter((s) => !s.is_won && !s.is_lost), ...input.stages.filter((s) => s.is_won), ...input.stages.filter((s) => s.is_lost)];
          ordered.forEach((s, position) => data.pipeline_stages.push({ id: randomUUID(), organization_id: ctx.actor.organization_id, pipeline_id: pipeline.id, ...s, position, created_at: at, updated_at: at }));
          data.audit_logs.push(auditRow(ctx, { action: "pipeline.created", target_type: "pipeline", target_id: pipeline.id, changes: { after: { name: input.name, stages: ordered.map((s) => s.name) } } }));
          return pipeline;
        });
      },
      async rename(ctx, id, name) {
        return store.mutate((data) => {
          const pipelines = sortedPipelines(data, ctx);
          const pipeline = pipelines.find((p) => p.id === id);
          if (!pipeline) throw new DomainError("Pipeline not found.", "not_found");
          if (pipelines.some((p) => p.id !== id && p.name.toLowerCase() === name.toLowerCase())) throw new DomainError("A pipeline with this name already exists.", "conflict");
          const before = pipeline.name;
          Object.assign(pipeline, { name, updated_at: nowIso() });
          data.audit_logs.push(auditRow(ctx, { action: "pipeline.renamed", target_type: "pipeline", target_id: id, changes: { before: { name: before }, after: { name } } }));
          return pipeline;
        });
      },
      async remove(ctx, id) {
        await store.mutate((data) => {
          const pipelines = sortedPipelines(data, ctx);
          const pipeline = pipelines.find((p) => p.id === id);
          if (!pipeline) throw new DomainError("Pipeline not found.", "not_found");
          if (pipelines.length === 1) throw new DomainError("The last pipeline cannot be deleted.", "conflict");
          const stageIds = new Set(sortedStages(data, ctx, id).map((s) => s.id));
          if (inOrg(ctx, data.deals).some((d) => stageIds.has(d.stage_id))) throw new DomainError("Move or delete the pipeline's deals first.", "conflict");
          data.pipeline_stages = data.pipeline_stages.filter((s) => !stageIds.has(s.id));
          data.pipelines = data.pipelines.filter((p) => p.id !== id);
          data.audit_logs.push(auditRow(ctx, { action: "pipeline.deleted", target_type: "pipeline", target_id: id, changes: { before: { name: pipeline.name } } }));
        });
      },
    },

    pipelineStages: {
      async list(ctx) {
        return sortedStages(await store.read(), ctx);
      },
      async create(ctx, pipelineId, input) {
        return store.mutate((data) => {
          if (!sortedPipelines(data, ctx).some((p) => p.id === pipelineId)) throw new DomainError("Pipeline not found.", "not_found");
          const stages = sortedStages(data, ctx, pipelineId);
          if (stages.some((s) => s.name.toLowerCase() === input.name.toLowerCase())) {
            throw new DomainError("A stage with this name already exists.", "conflict");
          }
          // New open stages go before the won/lost stages.
          const firstTerminal = stages.findIndex((s) => s.is_won || s.is_lost);
          const insertAt = input.is_won || input.is_lost || firstTerminal === -1 ? stages.length : firstTerminal;
          const at = nowIso();
          const stage: PipelineStage = {
            id: randomUUID(),
            organization_id: ctx.actor.organization_id,
            pipeline_id: pipelineId,
            ...input,
            position: insertAt,
            created_at: at,
            updated_at: at,
          };
          const next = [...stages.slice(0, insertAt), stage, ...stages.slice(insertAt)];
          assertSingleTerminalStages(next);
          next.forEach((s, i) => (s.position = i));
          data.pipeline_stages.push(stage);
          data.audit_logs.push(auditRow(ctx, { action: "pipeline.stage_created", target_type: "pipeline_stage", target_id: stage.id, changes: { after: input } }));
          return stage;
        });
      },
      async update(ctx, id, input) {
        return store.mutate((data) => {
          const pipelineId = inOrg(ctx, data.pipeline_stages).find((s) => s.id === id)?.pipeline_id;
          const stages = sortedStages(data, ctx, pipelineId);
          const stage = stages.find((s) => s.id === id);
          if (!stage) throw new DomainError("Stage not found.", "not_found");
          if (stages.some((s) => s.id !== id && s.name.toLowerCase() === input.name.toLowerCase())) {
            throw new DomainError("A stage with this name already exists.", "conflict");
          }
          const before = { name: stage.name, probability: stage.probability, is_won: stage.is_won, is_lost: stage.is_lost };
          const candidate = stages.map((s) => (s.id === id ? { ...s, ...input } : s));
          assertSingleTerminalStages(candidate);
          Object.assign(stage, input, { updated_at: nowIso() });
          data.audit_logs.push(auditRow(ctx, { action: "pipeline.stage_updated", target_type: "pipeline_stage", target_id: id, changes: { before, after: input } }));
          return stage;
        });
      },
      async reorder(ctx, pipelineId, orderedIds) {
        return store.mutate((data) => {
          const stages = sortedStages(data, ctx, pipelineId);
          const known = new Set(stages.map((s) => s.id));
          if (orderedIds.length !== stages.length || new Set(orderedIds).size !== orderedIds.length || orderedIds.some((i) => !known.has(i))) {
            throw new DomainError("The new order must contain every stage exactly once.", "invalid");
          }
          const before = stages.map((s) => s.name);
          const at = nowIso();
          orderedIds.forEach((stageId, position) => {
            const s = stages.find((x) => x.id === stageId)!;
            s.position = position;
            s.updated_at = at;
          });
          const after = sortedStages(data, ctx, pipelineId);
          data.audit_logs.push(
            auditRow(ctx, { action: "pipeline.stages_reordered", target_type: "pipeline_stage", target_id: null, changes: { before, after: after.map((s) => s.name) } }),
          );
          return after;
        });
      },
    },

    notifications: {
      async listMine(ctx, limit) {
        const data = await store.read();
        const mine = inOrg(ctx, data.notifications)
          .filter((n) => n.recipient_id === ctx.actor.id)
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
        return { items: mine.slice(0, Math.min(limit, 50)), unread: mine.filter((n) => !n.read_at).length };
      },
      async markRead(ctx, ids) {
        await store.mutate((data) => {
          const at = nowIso();
          for (const n of data.notifications) {
            if (n.organization_id !== ctx.actor.organization_id || n.recipient_id !== ctx.actor.id || n.read_at) continue;
            if (ids === "all" || ids.includes(n.id)) n.read_at = at;
          }
        });
      },
    },

    audit: {
      async record(ctx, entry) {
        await store.mutate((data) => {
          data.audit_logs.push(auditRow(ctx, entry));
        });
      },
    },

    stats: {
      async counts(ctx) {
        const data = await store.read();
        return {
          companies: visible(ctx, data.companies, "company", (r) => r.owner_id).length,
          contacts: visible(ctx, data.contacts, "contact", (r) => r.owner_id).length,
          leads: visible(ctx, data.leads, "lead", (r) => r.owner_id).length,
          deals: visible(ctx, data.deals, "deal", (r) => r.owner_id).length,
          orders: visible(ctx, data.orders, "order", (r) => r.owner_id).length,
          tasks: visible(ctx, data.tasks, "task", (r) => r.assignee_id).length,
          products: inOrg(ctx, data.products).filter((p) => !p.archived_at).length,
          activities: inOrg(ctx, data.activities).filter((a) => {
            const owners = visibleOwnerIds(ctx.actor, "activity");
            return owners === "all" || (a.actor_id !== null && owners.includes(a.actor_id));
          }).length,
        };
      },
    },
  };
}
