"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { DataTable, type DataTableColumn } from "@/components/patterns/data-table";
import { SettingsCard } from "@/components/patterns/form-field";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ROLES, type Role } from "@/domain/entities";
import { ROLE_LABELS } from "@/lib/format";
import { changeRoleAction } from "@/server/actions/settings";
import { tr, trNode } from "@/lib/i18n";

type Member = {
  id: string;
  full_name: string;
  email: string;
  title: string;
  role: Role;
  is_active: boolean;
  manager: string | null;
};

export function TeamTable({ members, canManage, currentUserId }: { members: Member[]; canManage: boolean; currentUserId: string }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const changeRole = (member: Member, role: Role) => {
    setPendingId(member.id);
    startTransition(async () => {
      const result = await changeRoleAction({ profile_id: member.id, role });
      setPendingId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(tr("{p0} is now {p1}", { p0: member.full_name, p1: ROLE_LABELS[role] }));
      router.refresh();
    });
  };

  const columns: DataTableColumn<Member>[] = [
    {
      id: "name",
      header: tr("Name"),
      sortValue: (m) => m.full_name,
      searchValue: (m) => `${m.full_name} ${m.email}`,
      cell: (m) => (
        <div className="min-w-0">
          <div className="font-medium">
            {m.full_name}
            {m.id === currentUserId && <span className="ml-1.5 text-xs font-normal text-text-muted">{tr("(you)")}</span>}
          </div>
          <div className="truncate text-xs text-text-muted">{m.email}</div>
        </div>
      ),
    },
    { id: "title", header: tr("Title"), sortValue: (m) => m.title, cell: (m) => <span className="text-text-subtle">{trNode(m.title)}</span>, hideBelow: "md" },
    { id: "manager", header: tr("Reports to"), sortValue: (m) => m.manager, cell: (m) => <span className="text-text-subtle">{m.manager ?? "—"}</span>, hideBelow: "lg" },
    {
      id: "role",
      header: tr("Role"),
      sortValue: (m) => m.role,
      cell: (m) =>
        canManage ? (
          <Select value={m.role} onValueChange={(v) => changeRole(m, v as Role)} disabled={pendingId === m.id}>
            <SelectTrigger size="sm" className="w-32" aria-label={tr("Role for {p0}", { p0: m.full_name })} onClick={(e) => e.stopPropagation()}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {ROLE_LABELS[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span>{ROLE_LABELS[m.role]}</span>
        ),
    },
    { id: "status", header: tr("Status"), cell: (m) => <StatusBadge status={m.is_active ? "active" : "inactive"} dot />, hideBelow: "sm" },
  ];

  return (
    <SettingsCard
      title={tr("Team")}
      description={canManage ? tr("Change a member's role. Every change is recorded in the audit log.") : tr("Members of your organization. Only an admin can change roles.")}
    >
      <DataTable data={members} columns={columns} getRowId={(m) => m.id} searchPlaceholder={tr("Search members…")} caption={tr("Team members")} />
    </SettingsCard>
  );
}
