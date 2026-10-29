"use client";

import { Sparkles } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { tr } from "@/lib/i18n";
import { summarizeCallAction } from "@/server/actions/calls";

/** On a recorded call: transcribe it and add a short AI summary to the timeline. */
export function CallSummaryButton({ activityId }: { activityId: string }) {
  const path = usePathname();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      className="mt-2"
      disabled={pending}
      data-testid="call-summary"
      onClick={() =>
        start(async () => {
          const r = await summarizeCallAction({ activity_id: activityId, path });
          if (!r.ok) return void toast.error(r.error);
          toast.success(tr("The call summary is on the timeline"));
        })
      }
    >
      <Sparkles aria-hidden />
      {pending ? tr("Listening to the call…") : tr("Transcribe and summarize")}
    </Button>
  );
}
