/**
 * Repository contract shared by the demo and Supabase adapters.
 *
 * Every method receives a RepoContext built on the server from the session.
 * Organization id and user always come from `ctx.actor`, never from client input,
 * and every lookup by id also filters by organization and the actor's visibility.
 */
import type {
  AuditLog,
  Notification,
  Organization,
  PipelineStage,
  Profile,
  Role,
} from "@/domain/entities";
import type { Actor } from "@/domain/permissions";

export type RequestMeta = {
  ip: string | null;
  user_agent: string | null;
  request_id: string;
  /** Set when the request was authenticated with an API key (public API). */
  api_key_id?: string | null;
};

export type RepoContext = {
  actor: Actor;
  meta: RequestMeta;
};

export type AuditEntry = Pick<AuditLog, "action" | "target_type" | "target_id" | "changes">;

export type OrganizationPatch = Partial<Pick<Organization, "name" | "currency" | "locale">> & {
  settings?: Partial<Organization["settings"]>;
};

export type StageInput = Pick<PipelineStage, "name" | "probability" | "is_won" | "is_lost">;

export type DatasetCounts = Record<
  "companies" | "contacts" | "leads" | "deals" | "orders" | "tasks" | "products" | "activities",
  number
>;

export interface Repositories {
  organizations: {
    current(ctx: RepoContext): Promise<Organization>;
    update(ctx: RepoContext, patch: OrganizationPatch): Promise<Organization>;
  };
  profiles: {
    list(ctx: RepoContext): Promise<Profile[]>;
    get(ctx: RepoContext, id: string): Promise<Profile | null>;
    updateOwn(ctx: RepoContext, patch: Pick<Profile, "full_name" | "title">): Promise<Profile>;
    changeRole(ctx: RepoContext, profileId: string, role: Role): Promise<Profile>;
    setActive(ctx: RepoContext, profileId: string, active: boolean): Promise<Profile>;
    invite(ctx: RepoContext, input: { email: string; full_name: string; role: Role }): Promise<Profile>;
  };
  pipelineStages: {
    list(ctx: RepoContext): Promise<PipelineStage[]>;
    create(ctx: RepoContext, input: StageInput): Promise<PipelineStage>;
    update(ctx: RepoContext, id: string, input: StageInput): Promise<PipelineStage>;
    reorder(ctx: RepoContext, orderedIds: string[]): Promise<PipelineStage[]>;
  };
  notifications: {
    listMine(ctx: RepoContext, limit: number): Promise<{ items: Notification[]; unread: number }>;
    markRead(ctx: RepoContext, ids: string[] | "all"): Promise<void>;
  };
  audit: {
    record(ctx: RepoContext, entry: AuditEntry): Promise<void>;
  };
  stats: {
    /** Record counts visible to the actor. Used by phase 1 empty states. */
    counts(ctx: RepoContext): Promise<DatasetCounts>;
  };
}

/** Thrown by repositories for business-rule violations that the user can fix. */
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: "not_found" | "conflict" | "invalid" = "invalid",
  ) {
    super(message);
    this.name = "DomainError";
  }
}
