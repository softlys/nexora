"use client";

import { Copy, RefreshCw, UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { resetCalendarFeedAction, syncVaultNowAction } from "@/server/actions/integrations";
import { tr } from "@/lib/i18n";

export function CopyField({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-surface-subtle p-2">
      <code className="min-w-0 flex-1 truncate text-xs" title={value}>
        {value}
      </code>
      <Button
        size="sm"
        variant="ghost"
        aria-label={tr("Copy {p0}", { p0: label })}
        onClick={() => {
          void navigator.clipboard?.writeText(value);
          toast.success(tr("Copied"));
        }}
      >
        <Copy aria-hidden />
      </Button>
    </div>
  );
}

export function ResetCalendarButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await resetCalendarFeedAction();
          if (!r.ok) return void toast.error(r.error);
          toast.success(tr("New link created; the old one no longer works"));
          router.refresh();
        })
      }
    >
      <RefreshCw aria-hidden />{tr("Reset link")}</Button>
  );
}

export function SyncVaultButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await syncVaultNowAction();
          if (!r.ok) return void toast.error(r.error);
          toast.success(tr("{p0} notes uploaded, {p1} unchanged", { p0: r.data.uploaded, p1: r.data.unchanged }));
          router.refresh();
        })
      }
    >
      <UploadCloud aria-hidden />
      {pending ? tr("Uploading…") : tr("Sync to Yandex Disk now")}
    </Button>
  );
}
