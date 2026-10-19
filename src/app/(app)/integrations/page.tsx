import { Plug } from "lucide-react";
import { SectionPlaceholder } from "@/components/patterns/section-placeholder";
import { requirePermission } from "@/server/guards";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  await requirePermission("view", "integration");
  return (
    <SectionPlaceholder
      title="Integrations"
      description="Webhooks, Make, n8n, email and the public API."
      icon={Plug}
      emptyTitle="Integrations will be configured here"
      emptyDescription="Connect NEXORA to external platforms. Nothing is shown as connected until a real test succeeds."
      planned={["Outbound webhooks with signatures, retries and delivery log", "Make and n8n guides with test events", "API keys and OpenAPI reference"]}
    />
  );
}
