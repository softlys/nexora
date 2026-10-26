"use client";

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { Button } from "@/components/ui/button";
import { resetDemoDataAction } from "@/server/actions/session";
import { tr } from "@/lib/i18n";

export function ResetDemoButton() {
  const router = useRouter();
  return (
    <ConfirmDialog
      trigger={
        <Button variant="destructive">
          <RotateCcw aria-hidden />{tr("Reset demo data")}</Button>
      }
      title={tr("Reset demo data?")}
      description={tr("All records return to the seeded state. This cannot be undone.")}
      confirmLabel={tr("Reset data")}
      destructive
      onConfirm={async () => {
        const result = await resetDemoDataAction();
        if (!result.ok) {
          toast.error(result.error);
          return false;
        }
        toast.success(tr("Demo data restored"));
        router.refresh();
      }}
    />
  );
}
