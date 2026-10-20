import { SettingsCard } from "@/components/patterns/form-field";
import { requirePermission } from "@/server/guards";
import { loadPage } from "@/server/page-data";
import { listApiKeys } from "@/server/services/api-keys";
import { ApiKeysManager } from "./api-keys-manager";

export const metadata = { title: "API keys" };

export default async function ApiKeysPage() {
  await requirePermission("view", "api_key");
  const keys = await loadPage((ctx) => listApiKeys(ctx));
  return (
    <SettingsCard
      title="API keys"
      description="Keys for the public API (/api/v1). A key is shown once, stored only as a hash, and acts with your permissions limited to its scopes. Integration keys (Make, n8n, forms) and SIEM keys (VIGIL) are separate kinds."
    >
      <ApiKeysManager keys={keys} />
    </SettingsCard>
  );
}
