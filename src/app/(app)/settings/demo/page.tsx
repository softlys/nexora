import { SettingsCard } from "@/components/patterns/form-field";
import { requirePermission } from "@/server/guards";
import { ResetDemoButton } from "./reset-demo-button";
import { tr } from "@/lib/i18n";

export const metadata = { title: tr("Demo data") };

export default async function DemoSettingsPage() {
  const { user } = await requirePermission("manage", "demo");
  return (
    <SettingsCard
      title={tr("Demo data")}
      description={tr("The demo dataset is fictional and stored on this server. Dates move forward automatically so it never looks stale.")}
    >
      {user.mode === "demo" ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-lg text-sm text-text-muted">{tr("Resetting replaces every record with the original seed: companies, deals, orders, tasks, settings and pipeline stages. Changes made in the demo are lost. Other users acting in this demo are affected too.")}</p>
          <ResetDemoButton />
        </div>
      ) : (
        <p className="text-sm text-text-muted">{tr("This instance uses Supabase. Seed or reset its data with")} <code className="font-mono text-xs">{tr("npm run supabase:seed")}</code> {tr("(see README).")}</p>
      )}
    </SettingsCard>
  );
}
