"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { SettingsCard } from "@/components/patterns/form-field";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { tr } from "@/lib/i18n";
import { saveRoleRestrictionsAction } from "@/server/actions/roles";
import type { RoleMatrix, RestrictableRole } from "@/server/services/roles";

type Scope = "own" | "team" | "all";
const RANK: Record<Scope, number> = { own: 0, team: 1, all: 2 };
const SCOPE_LABELS: Record<Scope | "none", string> = { all: "All", team: "Team", own: "Own only", none: "No access" };
const RESOURCE_LABELS: Record<string, string> = { company: "Companies", contact: "Contacts", lead: "Leads", deal: "Deals", order: "Orders", task: "Tasks", product: "Products", analytics: "Analytics", automation: "Automation" };
const ACTION_LABELS: Record<string, string> = { view: "View", create: "Create", update: "Edit", archive: "Archive" };

/** One role's table: record types × actions, each narrowed from the built-in scope. */
export function RoleEditor({ role, title, matrix }: { role: RestrictableRole; title: string; matrix: RoleMatrix[RestrictableRole] }) {
  const router = useRouter();
  const [values, setValues] = useState(() => Object.fromEntries(Object.entries(matrix).map(([r, actions]) => [r, Object.fromEntries(Object.entries(actions).map(([a, c]) => [a, c.value]))])) as Record<string, Record<string, Scope | "none" | null>>);
  const [pending, start] = useTransition();
  const actions = Object.keys(Object.values(matrix)[0] ?? {});
  const dirty = Object.entries(values).some(([r, acts]) => Object.entries(acts).some(([a, v]) => v !== matrix[r]![a]!.value));

  const save = () =>
    start(async () => {
      const grants = Object.fromEntries(Object.entries(values).map(([r, acts]) => [r, Object.fromEntries(Object.entries(acts).filter(([, v]) => v !== null) as Array<[string, string]>)]));
      const res = await saveRoleRestrictionsAction({ role, grants });
      if (!res.ok) return void toast.error(res.error);
      toast.success(tr("Rights of {p0} saved", { p0: title }));
      router.refresh();
    });

  return (
    <SettingsCard
      title={title}
      description={tr("Narrow what this role may do. The built-in rights are the maximum.")}
      footer={
        <Button onClick={save} disabled={pending || !dirty} data-testid={`save-role-${role}`}>
          {pending ? tr("Saving…") : tr("Save changes")}
        </Button>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm" data-testid={`role-${role}`}>
          <thead className="text-xs text-text-muted">
            <tr>
              <th className="py-1 pr-3 text-left font-normal">{tr("Record type")}</th>
              {actions.map((a) => (
                <th key={a} className="px-1 py-1 text-left font-normal">
                  {tr(ACTION_LABELS[a] ?? a)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(matrix).map(([resource, cells]) => (
              <tr key={resource} className="border-t border-border">
                <td className="py-1.5 pr-3 font-medium">{tr(RESOURCE_LABELS[resource] ?? resource)}</td>
                {actions.map((action) => {
                  const cell = cells[action]!;
                  if (!cell.base) return <td key={action} className="px-1 py-1.5 text-xs text-text-muted">—</td>;
                  const options = (["all", "team", "own"] as const).filter((s) => RANK[s] <= RANK[cell.base!]);
                  return (
                    <td key={action} className="px-1 py-1.5">
                      <Select value={values[resource]![action] ?? cell.base} onValueChange={(v) => setValues((cur) => ({ ...cur, [resource]: { ...cur[resource], [action]: v as Scope | "none" } }))}>
                        <SelectTrigger className="h-8 w-36" aria-label={`${tr(RESOURCE_LABELS[resource] ?? resource)}: ${tr(ACTION_LABELS[action] ?? action)}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[...options, "none" as const].map((o) => (
                            <SelectItem key={o} value={o}>
                              {tr(SCOPE_LABELS[o])}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SettingsCard>
  );
}
