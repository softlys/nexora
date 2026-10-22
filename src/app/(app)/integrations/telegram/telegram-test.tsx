"use client";

import { Send } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { testTelegramAction } from "@/server/actions/integrations";

export function TelegramTest() {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await testTelegramAction({});
          if (!result.ok) return void toast.error(result.error);
          if (result.data.ok) toast.success("Test message delivered to the Telegram chat");
          else toast.error(result.data.error ?? "Telegram refused the message");
        })
      }
    >
      <Send aria-hidden />
      {pending ? "Sending…" : "Send test message"}
    </Button>
  );
}
