import Link from "next/link";
import { EmptyState } from "@/components/patterns/empty-state";
import { PageHeader } from "@/components/patterns/page-header";
import { can } from "@/domain/permissions";
import { first } from "@/domain/list";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { requirePermission } from "@/server/guards";
import { loadPage } from "@/server/page-data";
import { listDuplicateGroups } from "@/server/services/duplicates";
import { MergeGroup } from "./merge-group";

export const metadata = { title: tr("Duplicates") };

/** Possible duplicate companies or contacts, grouped; admins merge them. */
export default async function DuplicatesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const entity = first(params.entity) === "contact" ? "contact" : "company";
  const { user } = await requirePermission("view", entity);
  const groups = await loadPage((ctx) => listDuplicateGroups(ctx, entity));
  const canMerge = can(user.actor, "delete", entity);

  return (
    <div className="space-y-5">
      <PageHeader
        title={tr("Duplicates")}
        description={tr("Records with the same name, website, phone or e-mail. Merging keeps one record, moves everything linked to the others onto it and archives the others.")}
      />
      <nav aria-label={tr("Record type")} className="flex gap-1">
        {(["company", "contact"] as const).map((e) => (
          <Link
            key={e}
            href={`/duplicates?entity=${e}`}
            aria-current={e === entity ? "page" : undefined}
            className={cn("rounded-md px-3 py-1.5 text-sm text-text-subtle hover:bg-surface-muted", e === entity && "bg-surface-muted font-medium text-foreground")}
          >
            {e === "company" ? tr("Companies") : tr("Contacts")}
          </Link>
        ))}
      </nav>
      {!canMerge && groups.length > 0 && <p className="text-sm text-text-muted">{tr("Only an administrator can merge records.")}</p>}
      {groups.length === 0 ? (
        <EmptyState title={tr("No duplicates found")} description={tr("No two records share a name, website, phone or e-mail.")} />
      ) : (
        groups.map((g, i) => <MergeGroup key={g.records.map((r) => r.id).join()} index={i} entity={entity} records={g.records} reasons={g.reasons} canMerge={canMerge} />)
      )}
    </div>
  );
}
