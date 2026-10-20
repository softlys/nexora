import { ArrowLeft, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/patterns/page-header";
import { can } from "@/domain/permissions";
import { enumFilter, stringFilter } from "@/domain/list";
import { PROVIDER_NAMES } from "@/domain/integrations/status";
import { requirePermission } from "@/server/guards";
import { loadPage } from "@/server/page-data";
import { getIntegration } from "@/server/services/integrations";
import type { WebhookProvider } from "@/server/integrations/webhooks";
import { DeliveryLog } from "./delivery-log";
import { IntegrationForm } from "./integration-form";

type Params = Record<string, string | string[] | undefined>;

/** Shared page for Make, n8n and the generic webhook: connection, guide, delivery log. */
export async function IntegrationPage({ provider, description, urlHint, guide, params }: { provider: WebhookProvider; description: string; urlHint: string; guide: ReactNode; params: Params }) {
  const { user } = await requirePermission("view", "integration");
  const filters = { status: enumFilter(params, "status", ["pending", "success", "failed"] as const), event_type: stringFilter(params, "event", 64) };
  const data = await loadPage((ctx) => getIntegration(ctx, provider, filters));
  const canManage = can(user.actor, "manage", "integration");

  return (
    <div className="space-y-6">
      <Link href="/integrations" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        Integrations
      </Link>
      <PageHeader title={PROVIDER_NAMES[provider]} description={description} />
      {data.overlaps.length > 0 && (
        <div role="status" className="rounded-md border border-warning-border bg-warning-bg p-3 text-sm text-warning" data-testid="engine-overlap-warning">
          <p className="flex items-center gap-2 font-medium">
            <TriangleAlert className="size-4" aria-hidden />
            NEXORA workflows already act on some of these events
          </p>
          <ul className="mt-1 list-disc pl-6 text-xs">
            {data.overlaps.map((o) => (
              <li key={`${o.event}-${o.workflow_id}`}>
                <span className="font-mono">{o.event}</span>: <Link className="underline" href={`/automation/${o.workflow_id}`}>{o.workflow_name}</Link> ({o.actions.join(", ")}). Do not repeat these actions in {PROVIDER_NAMES[provider]}.
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <IntegrationForm key={`${data.integration.url}-${data.integration.secret_preview}`} value={data.integration} canManage={canManage} urlHint={urlHint} />
        <section aria-labelledby="guide-heading" className="space-y-4 rounded-lg border border-border bg-surface p-5 text-sm shadow-xs [&_code]:font-mono [&_code]:text-xs [&_h3]:font-medium [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-surface-muted [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-[11px] [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
          <h2 id="guide-heading" className="text-md font-semibold">
            Setup guide
          </h2>
          {guide}
        </section>
      </div>
      <DeliveryLog deliveries={data.deliveries} eventTypes={data.eventTypes} canManage={canManage} />
    </div>
  );
}

/** Signature verification snippet shared by the guides. */
export const VERIFY_SNIPPET = `// Node.js: verify X-Nexora-Signature on the raw request body
const crypto = require("crypto");
function verify(rawBody, header, secret) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  const age = Math.abs(Date.now() / 1000 - Number(parts.t));
  if (!parts.v1 || age > 300) return false; // reject replays older than 5 minutes
  const expected = crypto.createHmac("sha256", secret).update(parts.t + "." + rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(parts.v1, "hex"));
}`;
