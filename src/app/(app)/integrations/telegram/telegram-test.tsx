"use client";

import { Send } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { testTelegramAction } from "@/server/actions/integrations";
import { tr } from "@/lib/i18n";

export function TelegramTest() {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await testTelegramAction({});
          if (!result.ok) return void toast.error(result.error);
          if (result.data.ok) toast.success(tr("Test message delivered to the Telegram chat"));
          else toast.error(result.data.error ?? tr("Telegram refused the message"));
        })
      }
    >
      <Send aria-hidden />
      {pending ? tr("Sending…") : tr("Send test message")}
    </Button>
  );
}
