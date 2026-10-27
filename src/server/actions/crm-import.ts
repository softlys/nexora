"use server";

import { revalidatePath } from "next/cache";
import { getRepoContext } from "@/server/auth";
import { readAmo, readBitrix, SourceError } from "@/server/integrations/crm-sources";
import { createTransport, SsrfBlockedError, transportOptionsFromEnv } from "@/server/integrations/transport";
import { getRepositories } from "@/server/repositories";
import { DomainError } from "@/server/repositories/types";
import { serviceAction } from "@/server/service-action";
import { importCrm, importRunInput } from "@/server/services/crm-import";

/**
 * Admin: check (dry run) or run a move from Bitrix24 or amoCRM. The webhook URL or token is used
 * for this request only and is not stored.
 */
export async function runCrmImportAction(input: unknown) {
  return serviceAction({ name: "runCrmImport", schema: importRunInput, bucket: "create" }, input, async (ctx, data) => {
    const transport = createTransport({ ...transportOptionsFromEnv(), timeoutMs: 30_000, maxResponseBytes: 8 * 1024 * 1024 });
    let source;
    try {
      source = data.source === "bitrix24" ? await readBitrix(transport, data.webhook ?? "") : await readAmo(transport, data.subdomain ?? "", data.token ?? "");
    } catch (error) {
      if (error instanceof SourceError || error instanceof SsrfBlockedError) throw new DomainError(error.message);
      throw new DomainError(`Could not read the CRM: ${error instanceof Error ? error.message : String(error)}`);
    }
    const { ctx: repoCtx } = await getRepoContext();
    const report = await importCrm(ctx, data.source, source, {
      dryRun: data.dry_run,
      createPipeline: async (name, stages) => (await getRepositories().pipelines.create(repoCtx, { name, stages })).id,
    });
    if (!data.dry_run) {
      for (const path of ["/companies", "/contacts", "/deals", "/pipeline", "/settings/pipeline"]) revalidatePath(path);
    }
    return report;
  });
}
