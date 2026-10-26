import type { ChangeEntry } from "@/server/services/deals";
import { formatDate, formatRelative } from "@/lib/format";
import { tr, trNode } from "@/lib/i18n";

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  amount: tr("Amount"),
  currency: "Currency",
  probability: tr("Probability"),
  expected_close_date: tr("Expected close"),
  owner_id: tr("Owner"),
  company_id: tr("Company"),
  primary_contact_id: tr("Primary contact"),
  source: tr("Source"),
  next_activity: tr("Next activity"),
  notes: tr("Notes"),
};

function show(value: unknown, field: string, names: Record<string, string>): string {
  if (value === null || value === undefined || value === "") return "empty";
  if (field === "owner_id" && typeof value === "string") return names[value] ?? tr("Former member");
  if (field === "notes" && typeof value === "string") return value.length > 40 ? `${value.slice(0, 40)}…` : value;
  return String(value);
}

/** Every stage move and field change on a deal, newest first. Values render as text. */
export function ChangeHistory({ entries, names }: { entries: ChangeEntry[]; names: Record<string, string> }) {
  if (entries.length === 0) return <p className="text-sm text-text-muted">{tr("No changes recorded.")}</p>;
  return (
    <ol className="space-y-3 text-sm">
      {entries.map((e) => (
        <li key={e.id} className="flex flex-col gap-0.5">
          <span>
            {e.kind === "stage" ? (
              <>{tr("Stage")} {e.before ? <>{trNode(show(e.before, "stage", names))} → </> : tr("set to ")}
                <span className="font-medium">{trNode(show(e.after, "stage", names))}</span>
              </>
            ) : e.kind === "field" ? (
              <>
                {FIELD_LABELS[e.label] ?? e.label}: <span className="text-text-muted">{show(e.before, e.label, names)}</span> → <span className="font-medium">{show(e.after, e.label, names)}</span>
              </>
            ) : (
              <span className="font-medium">{e.label}</span>
            )}
          </span>
          <span className="text-xs text-text-muted">
            {e.actor_id ? (names[e.actor_id] ?? tr("Former member")) : tr("System")} · <time dateTime={e.at} title={formatDate(e.at)}>{formatRelative(e.at)}</time>
          </span>
        </li>
      ))}
    </ol>
  );
}
