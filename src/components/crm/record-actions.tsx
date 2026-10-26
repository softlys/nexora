"use client";

import { Archive, ArchiveRestore, MoreHorizontal, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { archiveRecordAction, deleteRecordAction, restoreRecordAction } from "@/server/actions/crm";
import { tr } from "@/lib/i18n";

type Table = "companies" | "contacts" | "leads" | "deals" | "orders" | "tasks";

/**
 * Archive / restore for anyone allowed to edit the record, permanent delete for admins.
 * Every action asks for confirmation and is written to the audit log on the server.
 */
export function RecordActions({
  table,
  id,
  label,
  archived,
  canArchive,
  canDelete,
  listPath,
  children,
}: {
  table: Table;
  id: string;
  label: string;
  archived: boolean;
  canArchive: boolean;
  canDelete: boolean;
  listPath: string;
  children?: ReactNode;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<"archive" | "delete" | null>(null);

  const run = async (kind: "archive" | "restore" | "delete") => {
    const action = kind === "archive" ? archiveRecordAction : kind === "restore" ? restoreRecordAction : deleteRecordAction;
    const result = await action({ id, table });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success(kind === "archive" ? `${label} archived` : kind === "restore" ? `${label} restored` : `${label} deleted`);
    if (kind === "delete") router.push(listPath);
    else router.refresh();
    return true;
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {children}
      {archived && canArchive && (
        <Button variant="outline" onClick={() => run("restore")}>
          <ArchiveRestore aria-hidden />{tr("Restore")}</Button>
      )}
      {(canArchive || canDelete) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label={tr("More actions")}>
              <MoreHorizontal aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {!archived && canArchive && (
              <DropdownMenuItem onSelect={() => setConfirm("archive")}>
                <Archive aria-hidden />{tr("Archive")}</DropdownMenuItem>
            )}
            {canDelete && (
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirm("delete")}>
                <Trash2 aria-hidden />{tr("Delete permanently")}</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {confirm && (
        <ConfirmDialog
          key={confirm}
          defaultOpen
          onOpenChange={(open) => !open && setConfirm(null)}
          title={confirm === "archive" ? tr("Archive this {p0}?", { p0: label.toLowerCase() }) : tr("Delete this {p0} permanently?", { p0: label.toLowerCase() })}
          description={
            confirm === "archive"
              ? tr("It disappears from lists but keeps its history. You can restore it later.")
              : tr("This cannot be undone. Related records keep working, but this record and its links are removed.")
          }
          confirmLabel={confirm === "archive" ? tr("Archive") : tr("Delete")}
          destructive
          onConfirm={() => run(confirm)}
        />
      )}
    </div>
  );
}
