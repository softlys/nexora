"use client";

import { Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FormField } from "@/components/patterns/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { testEmailAction } from "@/server/actions/integrations";
import { tr } from "@/lib/i18n";

export function EmailTest({ defaultTo }: { defaultTo: string }) {
  const router = useRouter();
  const [to, setTo] = useState(defaultTo);
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await testEmailAction({ to });
          if (!result.ok) return void toast.error(result.error);
          if (result.data.ok) toast.success(tr("Test email accepted by the provider"));
          else toast.error(tr("The provider refused the email: {p0}", { p0: result.data.error }));
          router.refresh();
        });
      }}
    >
      <FormField id="test-to" label={tr("Send a test email to")} className="flex-1">
        <Input id="test-to" type="email" required value={to} onChange={(e) => setTo(e.target.value)} />
      </FormField>
      <Button type="submit" disabled={pending}>
        <Send aria-hidden />
        {pending ? tr("Sending…") : tr("Send test email")}
      </Button>
    </form>
  );
}
