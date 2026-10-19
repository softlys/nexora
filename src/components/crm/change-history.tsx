import type { ChangeEntry } from "@/server/services/deals";
import { formatDate, formatRelative } from "@/lib/format";

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  amount: "Amount",
  currency: "Currency",
  probability: "Probability",
  expected_close_date: "Expected close",
  owner_id: "Owner",
  company_id: "Company",
  primary_contact_id: "Primary contact",
  source: "Source",
  next_activity: "Next activity",
  notes: "Notes",
};

function show(value: unknown, field: string, names: Record<string, string>): string {
  if (value === null || value === undefined || value === "") return "empty";
  if (field === "owner_id" && typeof value === "string") return names[value] ?? "Former member";
  if (field === "notes" && typeof value === "string") return value.length > 40 ? `${value.slice(0, 40)}…` : value;
  return String(value);
}

/** Every stage move and field change on a deal, newest first. Values render as text. */
export function ChangeHistory({ entries, names }: { entries: ChangeEntry[]; names: Record<string, string> }) {
  if (entries.length === 0) return <p className="text-sm text-text-muted">No changes recorded.</p>;
  return (
    <ol className="space-y-3 text-sm">
      {entries.map((e) => (
        <li key={e.id} className="flex flex-col gap-0.5">
          <span>
            {e.kind === "stage" ? (
              <>
                Stage {e.before ? <>{show(e.before, "stage", names)} → </> : "set to "}
                <span className="font-medium">{show(e.after, "stage", names)}</span>
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
            {e.actor_id ? (names[e.actor_id] ?? "Former member") : "System"} · <time dateTime={e.at} title={formatDate(e.at)}>{formatRelative(e.at)}</time>
          </span>
        </li>
      ))}
    </ol>
  );
}
