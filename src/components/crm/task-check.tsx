"use client";

import { useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { setTaskDoneAction } from "@/server/actions/crm";
import { tr } from "@/lib/i18n";

/** One-click complete / reopen with optimistic state. */
export function TaskCheck({ id, title, done, disabled }: { id: string; title: string; done: boolean; disabled?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [optimisticDone, setOptimisticDone] = useOptimistic(done);
  return (
    <Checkbox
      checked={optimisticDone}
      disabled={disabled || pending}
      aria-label={optimisticDone ? tr("Reopen {p0}", { p0: title }) : tr("Complete {p0}", { p0: title })}
      onCheckedChange={(value) =>
        startTransition(async () => {
          setOptimisticDone(value === true);
          const result = await setTaskDoneAction({ id, done: value === true });
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          if (value === true) toast.success(tr("Task completed"));
          router.refresh();
        })
      }
    />
  );
}
