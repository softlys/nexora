import { PageHeader } from "@/components/patterns/page-header";
import { SettingsCard } from "@/components/patterns/form-field";
import { StatusBadge } from "@/components/patterns/status-badge";
import { CUSTOM_FIELD_ENTITIES, CUSTOM_FIELD_TYPE_LABELS as TYPE_LABELS, type CustomFieldEntity } from "@/domain/custom-fields";
import { tr } from "@/lib/i18n";
import { requirePermission } from "@/server/guards";
import { loadPage } from "@/server/page-data";
import { listCustomFields } from "@/server/services/custom-fields";
import { ArchiveFieldButton, FieldButton } from "./field-editor";

export const metadata = { title: tr("Fields") };

const ENTITY_TITLES: Record<CustomFieldEntity, string> = { company: "Companies", contact: "Contacts", lead: "Leads", deal: "Deals" };

/** Admins add their own fields (ИНН, customer type, contract date…) to companies, contacts, leads and deals. */
export default async function FieldSettingsPage() {
  await requirePermission("manage", "organization");
  const fields = await loadPage((ctx) => listCustomFields(ctx));
  return (
    <div className="space-y-6">
      <PageHeader title={tr("Fields")} description={tr("Your own fields on companies, contacts, leads and deals: shown in forms, on record pages and in CSV export and import.")} />
      {CUSTOM_FIELD_ENTITIES.map((entity) => {
        const rows = fields.filter((f) => f.entity === entity);
        return (
          <SettingsCard key={entity} title={ENTITY_TITLES[entity]}>
            <div className="space-y-3" data-testid={`fields-${entity}`}>
              {rows.length === 0 ? (
                <p className="text-sm text-text-muted">{tr("No custom fields yet.")}</p>
              ) : (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {rows.map((f) => (
                    <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="font-medium">{f.label}</span>
                        <StatusBadge label={tr(TYPE_LABELS[f.type])} tone="neutral" />
                        {f.required && <StatusBadge label={tr("Required")} tone="accent" />}
                        <code className="text-xs text-text-muted">{f.key}</code>
                        {f.type === "select" && <span className="truncate text-xs text-text-muted">{f.options.join(", ")}</span>}
                      </span>
                      <span className="flex items-center gap-1">
                        <FieldButton entity={entity} field={f} />
                        <ArchiveFieldButton field={f} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <FieldButton entity={entity} />
            </div>
          </SettingsCard>
        );
      })}
    </div>
  );
}
