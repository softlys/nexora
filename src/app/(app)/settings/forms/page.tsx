import { ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { StatusBadge } from "@/components/patterns/status-badge";
import { WEB_FORM_FIELDS } from "@/domain/entities";
import { tr } from "@/lib/i18n";
import { requirePermission } from "@/server/guards";
import { currentBaseUrl } from "@/server/integrations/public-url";
import { loadPage } from "@/server/page-data";
import { activeProfiles } from "@/server/services/records";
import { listWebForms } from "@/server/services/web-forms";
import { EmbedCode, WebFormButton, type FormDraft } from "./form-editor";

export const metadata = { title: tr("Website forms") };

/** Admins set up CRM forms for their website; each submission becomes a lead. */
export default async function WebFormsPage() {
  await requirePermission("manage", "organization");
  const { forms, users } = await loadPage(async (ctx) => ({
    forms: await listWebForms(ctx),
    users: (await ctx.db.read(ctx.actor.organization_id, activeProfiles)).map((p) => ({ id: p.id, name: p.full_name })),
  }));
  const base = await currentBaseUrl();
  const names = new Map(users.map((u) => [u.id, u.name]));
  return (
    <div className="space-y-6">
      <PageHeader title={tr("Website forms")} description={tr("Put a form on your website: each submission becomes a lead with the message and UTM tags.")} actions={<WebFormButton users={users} />} />
      {forms.length === 0 && <p className="text-sm text-text-muted">{tr("No forms yet.")}</p>}
      <ul className="space-y-4" data-testid="web-forms">
        {forms.map((f) => {
          const url = `${base}/api/forms/${f.id}`;
          const code = `<iframe id="nx-form-${f.id.slice(0, 8)}" src="${url}" style="width:100%;max-width:480px;height:600px;border:0"></iframe><script>(function(f){f.src+=location.search})(document.getElementById("nx-form-${f.id.slice(0, 8)}"))</script>`;
          const draft: FormDraft = { id: f.id, name: f.name, title: f.title, button_text: f.button_text, success_text: f.success_text, fields: Object.fromEntries(WEB_FORM_FIELDS.map((k) => [k, f.fields[k] ?? "off"])) as FormDraft["fields"], owner_id: f.owner_id, is_active: f.is_active };
          return (
            <li key={f.id} className="space-y-3 rounded-lg border border-border bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium">
                    {f.name}
                    <StatusBadge label={f.is_active ? tr("Active") : tr("Off")} tone={f.is_active ? "success" : "neutral"} />
                  </p>
                  <p className="text-sm text-text-muted">
                    {tr("Submissions: {p0}", { p0: f.submissions })} · {tr("Leads go to")}: {f.owner_id ? (names.get(f.owner_id) ?? "—") : tr("nobody")}
                  </p>
                </div>
                <span className="flex items-center gap-1">
                  <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 text-sm text-brand hover:underline" data-testid={`open-form-${f.id}`}>
                    {tr("Open the form")}
                    <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                  <WebFormButton form={draft} users={users} />
                </span>
              </div>
              <EmbedCode code={code} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
