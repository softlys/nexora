import type { Dataset, Profile } from "@/domain/entities";
import { DEMO_ORG_ID, DEMO_USER_IDS, generateSeed } from "@/domain/seed/generate";
import { createMemoryTx } from "@/server/db/memory-tx";
import type { Db } from "@/server/db/types";
import type { ServiceContext } from "@/server/services/context";

export const NOW = new Date("2026-10-19T12:00:00Z");

/** In-memory Db with the same commit-or-rollback semantics as the demo store. */
export function createTestDb(data: Dataset = generateSeed(NOW)): { db: Db; data: () => Dataset } {
  let state = data;
  let queue: Promise<unknown> = Promise.resolve();
  const db: Db = {
    async read(orgId, fn) {
      await queue;
      return fn(createMemoryTx(state, orgId, false));
    },
    write(orgId, fn) {
      const run = queue.then(async () => {
        const draft = structuredClone(state);
        const result = await fn(createMemoryTx(draft, orgId, true));
        state = draft;
        return result;
      });
      queue = run.catch(() => undefined);
      return run;
    },
  };
  return { db, data: () => state };
}

export function ctxFor(db: Db, data: Dataset, userId: string): ServiceContext {
  const profile = data.profiles.find((p) => p.id === userId) as Profile;
  return {
    actor: {
      id: profile.id,
      role: profile.role,
      organization_id: profile.organization_id,
      team_member_ids: data.profiles.filter((p) => p.manager_id === profile.id).map((p) => p.id),
    },
    meta: { ip: "127.0.0.1", user_agent: "vitest", request_id: "test-request" },
    db,
    now: () => NOW,
    deferred: [],
  };
}

export { DEMO_ORG_ID, DEMO_USER_IDS };
