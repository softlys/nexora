"use client";

import { ArrowRightLeft, SearchCheck } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FormField, SettingsCard } from "@/components/patterns/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { runCrmImportAction } from "@/server/actions/crm-import";
import type { ImportReport } from "@/server/services/crm-import";

type Source = "bitrix24" | "amocrm";

/** Connect to Bitrix24 or amoCRM, see what would be moved, then move it. */
export function ImportForm() {
  const [source, setSource] = useState<Source>("bitrix24");
  const [webhook, setWebhook] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [token, setToken] = useState("");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (dryRun: boolean) =>
    start(async () => {
      setError(null);
      const r = await runCrmImportAction({ source, dry_run: dryRun, ...(source === "bitrix24" ? { webhook } : { subdomain, token }) });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setReport(r.data);
      if (!dryRun) toast.success(tr("Moved: {p0} companies, {p1} contacts, {p2} deals", { p0: r.data.companies.created, p1: r.data.contacts.created, p2: r.data.deals.created }));
    });
  const ready = source === "bitrix24" ? webhook.trim().length > 10 : subdomain.trim().length > 1 && token.trim().length > 10;

  return (
    <div className="space-y-6">
      <SettingsCard title={tr("Where from")}>
        <div className="space-y-4">
          <div className="flex gap-2" role="radiogroup" aria-label={tr("Source CRM")}>
            {(["bitrix24", "amocrm"] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={source === s}
                onClick={() => {
                  setSource(s);
                  setReport(null);
                  setError(null);
                }}
                className={cn("rounded-md border px-4 py-2 text-sm font-medium", source === s ? "border-brand bg-brand/5" : "border-border hover:bg-surface-subtle")}
              >
                {s === "bitrix24" ? "Битрикс24" : "amoCRM"}
              </button>
            ))}
          </div>
          {source === "bitrix24" ? (
            <FormField id="import-webhook" label={tr("Incoming webhook URL")} hint={tr("Bitrix24 → Developer resources → Other → Incoming webhook, with the CRM permission. It looks like https://your-portal.bitrix24.ru/rest/1/xxxxxxxx/")}>
              <Input id="import-webhook" value={webhook} onChange={(e) => setWebhook(e.target.value)} placeholder="https://…/rest/1/…/" autoComplete="off" />
            </FormField>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField id="import-subdomain" label={tr("Account address")} hint={tr("The first part of your-account.amocrm.ru")}>
                <Input id="import-subdomain" value={subdomain} onChange={(e) => setSubdomain(e.target.value)} placeholder="mycompany" autoComplete="off" />
              </FormField>
              <FormField id="import-token" label={tr("Long-lived token")} hint={tr("amoCRM → Settings → Integrations → Create integration → Keys and access.")}>
                <Input id="import-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
              </FormField>
            </div>
          )}
          <p className="text-xs text-text-muted">{tr("The address and token are used only for this move and are not saved.")}</p>
          {error && (
            <p role="alert" className="rounded-md border border-danger-border bg-danger-bg p-3 text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={!ready || pending} onClick={() => run(true)} data-testid="import-check">
              <SearchCheck aria-hidden />
              {pending ? tr("Reading…") : tr("Check what will be moved")}
            </Button>
            <Button disabled={!ready || pending || !report?.dry_run} onClick={() => run(false)} data-testid="import-run">
              <ArrowRightLeft aria-hidden />
              {tr("Move to NEXORA")}
            </Button>
          </div>
        </div>
      </SettingsCard>

      {report && (
        <SettingsCard title={report.dry_run ? tr("Found") : tr("Moved")}>
          <div className="space-y-3 text-sm" data-testid="import-report">
            <dl className="grid gap-3 sm:grid-cols-4">
              {(
                [
                  [tr("Pipelines"), report.pipelines.total, report.pipelines.created, 0],
                  [tr("Companies"), report.companies.total, report.companies.created, report.companies.skipped],
                  [tr("Contacts"), report.contacts.total, report.contacts.created, report.contacts.skipped],
                  [tr("Deals"), report.deals.total, report.deals.created, report.deals.skipped],
                ] as const
              ).map(([label, total, created, skipped]) => (
                <div key={label} className="rounded-md border border-border p-3">
                  <dt className="text-xs text-text-muted">{label}</dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums">{total}</dd>
                  <dd className="text-xs text-text-muted">
                    {report.dry_run ? tr("new: {p0}", { p0: created }) : tr("added: {p0}", { p0: created })}
                    {skipped > 0 && ` · ${tr("already moved: {p0}", { p0: skipped })}`}
                  </dd>
                </div>
              ))}
            </dl>
            {report.pipelines.matched.length > 0 && <p className="text-text-muted">{tr("Existing pipelines are reused: {p0}.", { p0: report.pipelines.matched.join(", ") })}</p>}
            {report.dry_run && <p className="text-text-muted">{tr("Nothing has been changed yet. Running the move again later only adds what is new.")}</p>}
            {report.errors.length > 0 && (
              <div>
                <p className="font-medium text-danger">{tr("Not moved ({p0}):", { p0: report.errors.length })}</p>
                <ul className="mt-1 max-h-48 list-disc overflow-y-auto pl-5 text-xs text-text-muted">
                  {report.errors.map((e, i) => (
                    <li key={i}>
                      {e.kind} {e.key}: {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </SettingsCard>
      )}
    </div>
  );
}
