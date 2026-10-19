import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Notification, Organization, PipelineStage, Profile } from "@/domain/entities";
import { visibleOwnerIds, type Resource } from "@/domain/permissions";
import { createSupabaseServerClient } from "@/server/supabase/server";
import { DomainError, type AuditEntry, type RepoContext, type Repositories } from "../types";

/**
 * Supabase adapter. Queries run with the user's JWT, so RLS policies
 * (supabase/migrations) are the database-level boundary. The adapter still filters
 * by organization explicitly so a misconfigured policy cannot widen results silently.
 * Multi-row invariants (single admin, single won/lost stage) are enforced by
 * SECURITY DEFINER functions in the migrations and re-checked here.
 */

function fail(error: { message: string; code?: string } | null, fallback: string): never {
  if (error?.code === "PGRST116") throw new DomainError(fallback, "not_found");
  if (error?.code === "23505") throw new DomainError("This conflicts with an existing record.", "conflict");
  throw new Error(error?.message ?? fallback);
}

async function client(): Promise<SupabaseClient> {
  return createSupabaseServerClient();
}

async function insertAudit(db: SupabaseClient, ctx: RepoContext, entry: AuditEntry) {
  const { error } = await db.from("audit_logs").insert({
    organization_id: ctx.actor.organization_id,
    actor_id: ctx.actor.id,
    actor_role: ctx.actor.role,
    ip: ctx.meta.ip,
    user_agent: ctx.meta.user_agent,
    request_id: ctx.meta.request_id,
    ...entry,
  });
  if (error) fail(error, "Could not write audit log.");
}

async function countVisible(db: SupabaseClient, ctx: RepoContext, table: string, resource: Resource, ownerColumn: string) {
  let query = db.from(table).select("id", { count: "exact", head: true }).eq("organization_id", ctx.actor.organization_id).is("archived_at", null);
  const owners = visibleOwnerIds(ctx.actor, resource);
  if (owners !== "all") query = query.in(ownerColumn, owners);
  const { count, error } = await query;
  if (error) fail(error, `Could not count ${table}.`);
  return count ?? 0;
}

export function createSupabaseRepositories(): Repositories {
  return {
    organizations: {
      async current(ctx) {
        const db = await client();
        const { data, error } = await db.from("organizations").select("*").eq("id", ctx.actor.organization_id).single();
        if (error) fail(error, "Organization not found.");
        return data as Organization;
      },
      async update(ctx, patch) {
        const db = await client();
        const current = await this.current(ctx);
        const { data, error } = await db
          .from("organizations")
          .update({
            ...(patch.name !== undefined && { name: patch.name }),
            ...(patch.currency !== undefined && { currency: patch.currency }),
            ...(patch.locale !== undefined && { locale: patch.locale }),
            settings: { ...current.settings, ...patch.settings },
          })
          .eq("id", ctx.actor.organization_id)
          .select("*")
          .single();
        if (error) fail(error, "Could not update organization.");
        await insertAudit(db, ctx, {
          action: "organization.updated",
          target_type: "organization",
          target_id: current.id,
          changes: { before: { name: current.name, currency: current.currency, locale: current.locale, settings: current.settings }, after: patch },
        });
        return data as Organization;
      },
    },

    profiles: {
      async list(ctx) {
        const db = await client();
        const { data, error } = await db
          .from("profiles")
          .select("*")
          .eq("organization_id", ctx.actor.organization_id)
          .is("archived_at", null)
          .order("full_name");
        if (error) fail(error, "Could not load team.");
        return data as Profile[];
      },
      async get(ctx, id) {
        const db = await client();
        const { data, error } = await db.from("profiles").select("*").eq("organization_id", ctx.actor.organization_id).eq("id", id).maybeSingle();
        if (error) fail(error, "Could not load profile.");
        return (data as Profile | null) ?? null;
      },
      async updateOwn(ctx, patch) {
        const db = await client();
        const { data, error } = await db
          .from("profiles")
          .update({ full_name: patch.full_name, title: patch.title })
          .eq("organization_id", ctx.actor.organization_id)
          .eq("id", ctx.actor.id)
          .select("*")
          .single();
        if (error) fail(error, "Profile not found.");
        return data as Profile;
      },
      async changeRole(ctx, profileId, role) {
        const db = await client();
        // change_profile_role() checks admin rights, organization and the last-admin rule in one transaction.
        const { data, error } = await db.rpc("change_profile_role", { target_profile_id: profileId, new_role: role });
        if (error) {
          if (error.message.includes("last_admin")) throw new DomainError("The organization needs at least one active admin.", "conflict");
          fail(error, "Team member not found.");
        }
        await insertAudit(db, ctx, { action: "profile.role_changed", target_type: "profile", target_id: profileId, changes: { role: { after: role } } });
        return data as Profile;
      },
    },

    pipelineStages: {
      async list(ctx) {
        const db = await client();
        const { data, error } = await db.from("pipeline_stages").select("*").eq("organization_id", ctx.actor.organization_id).order("position");
        if (error) fail(error, "Could not load pipeline stages.");
        return data as PipelineStage[];
      },
      async create(ctx, input) {
        const db = await client();
        const { data, error } = await db.rpc("create_pipeline_stage", {
          stage_name: input.name,
          stage_probability: input.probability,
          stage_is_won: input.is_won,
          stage_is_lost: input.is_lost,
        });
        if (error) {
          if (error.message.includes("terminal_stage")) throw new DomainError("The pipeline needs exactly one won and one lost stage.", "conflict");
          fail(error, "Could not create stage.");
        }
        await insertAudit(db, ctx, { action: "pipeline.stage_created", target_type: "pipeline_stage", target_id: (data as PipelineStage).id, changes: { after: input } });
        return data as PipelineStage;
      },
      async update(ctx, id, input) {
        const db = await client();
        const { data, error } = await db.rpc("update_pipeline_stage", {
          stage_id: id,
          stage_name: input.name,
          stage_probability: input.probability,
          stage_is_won: input.is_won,
          stage_is_lost: input.is_lost,
        });
        if (error) {
          if (error.message.includes("terminal_stage")) throw new DomainError("The pipeline needs exactly one won and one lost stage.", "conflict");
          fail(error, "Stage not found.");
        }
        await insertAudit(db, ctx, { action: "pipeline.stage_updated", target_type: "pipeline_stage", target_id: id, changes: { after: input } });
        return data as PipelineStage;
      },
      async reorder(ctx, orderedIds) {
        const db = await client();
        const { error } = await db.rpc("reorder_pipeline_stages", { ordered_ids: orderedIds });
        if (error) fail(error, "Could not reorder stages.");
        await insertAudit(db, ctx, { action: "pipeline.stages_reordered", target_type: "pipeline_stage", target_id: null, changes: { after: orderedIds } });
        return this.list(ctx);
      },
    },

    notifications: {
      async listMine(ctx, limit) {
        const db = await client();
        const base = () => db.from("notifications").select("*", { count: "exact" }).eq("organization_id", ctx.actor.organization_id).eq("recipient_id", ctx.actor.id);
        const [{ data, error }, unread] = await Promise.all([
          base().order("created_at", { ascending: false }).limit(Math.min(limit, 50)),
          base().is("read_at", null).limit(1),
        ]);
        if (error) fail(error, "Could not load notifications.");
        if (unread.error) fail(unread.error, "Could not load notifications.");
        return { items: data as Notification[], unread: unread.count ?? 0 };
      },
      async markRead(ctx, ids) {
        const db = await client();
        let query = db
          .from("notifications")
          .update({ read_at: new Date().toISOString() })
          .eq("organization_id", ctx.actor.organization_id)
          .eq("recipient_id", ctx.actor.id)
          .is("read_at", null);
        if (ids !== "all") query = query.in("id", ids);
        const { error } = await query;
        if (error) fail(error, "Could not update notifications.");
      },
    },

    audit: {
      async record(ctx, entry) {
        await insertAudit(await client(), ctx, entry);
      },
    },

    stats: {
      async counts(ctx) {
        const db = await client();
        const [companies, contacts, leads, deals, orders, tasks, products, activities] = await Promise.all([
          countVisible(db, ctx, "companies", "company", "owner_id"),
          countVisible(db, ctx, "contacts", "contact", "owner_id"),
          countVisible(db, ctx, "leads", "lead", "owner_id"),
          countVisible(db, ctx, "deals", "deal", "owner_id"),
          countVisible(db, ctx, "orders", "order", "owner_id"),
          countVisible(db, ctx, "tasks", "task", "assignee_id"),
          countVisible(db, ctx, "products", "product", "id"),
          (async () => {
            let q = db.from("activities").select("id", { count: "exact", head: true }).eq("organization_id", ctx.actor.organization_id);
            const owners = visibleOwnerIds(ctx.actor, "activity");
            if (owners !== "all") q = q.in("actor_id", owners);
            const { count, error } = await q;
            if (error) fail(error, "Could not count activities.");
            return count ?? 0;
          })(),
        ]);
        return { companies, contacts, leads, deals, orders, tasks, products, activities };
      },
    },
  };
}
