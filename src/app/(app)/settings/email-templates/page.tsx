import { PageHeader } from "@/components/patterns/page-header";
import { tr } from "@/lib/i18n";
import { requirePermission } from "@/server/guards";
import { loadPage } from "@/server/page-data";
import { listEmailTemplates } from "@/server/services/email";
import { emailConfigured } from "@/server/services/integrations";
import { ArchiveTemplateButton, TemplateButton } from "./template-editor";

export const metadata = { title: tr("E-mail templates") };

/** Admins keep the templates that "Write e-mail" on record pages offers. */
export default async function EmailTemplatesPage() {
  await requirePermission("manage", "organization");
  const templates = await loadPage((ctx) => listEmailTemplates(ctx));
  return (
    <div className="space-y-6">
      <PageHeader title={tr("E-mail templates")} description={tr("Ready-made e-mails for “Write e-mail” on contacts, companies, deals and leads.")} actions={<TemplateButton />} />
      {!emailConfigured() && <p className="rounded-md border border-border bg-surface-subtle p-3 text-sm text-text-muted">{tr("Sending from NEXORA needs the e-mail provider (Integrations → Email provider). Until then, e-mails open in the user's mail app.")}</p>}
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface" data-testid="email-templates">
        {templates.length === 0 && <li className="p-4 text-sm text-text-muted">{tr("No templates yet.")}</li>}
        {templates.map((t) => (
          <li key={t.id} className="flex items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="font-medium">{t.name}</p>
              <p className="truncate text-sm text-text-muted">{t.subject}</p>
            </div>
            <span className="flex shrink-0 items-center gap-1">
              <TemplateButton template={{ id: t.id, name: t.name, subject: t.subject, body: t.body }} />
              <ArchiveTemplateButton template={{ id: t.id, name: t.name, subject: t.subject, body: t.body }} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
