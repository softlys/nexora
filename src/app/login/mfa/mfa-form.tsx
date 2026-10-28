"use client";

import { useState, useTransition } from "react";
import { FormField } from "@/components/patterns/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { tr } from "@/lib/i18n";
import { verifyMfaLoginAction } from "@/server/actions/mfa";

export function MfaLoginForm() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await verifyMfaLoginAction({ code });
          if (r && !r.ok) setError(r.error);
        });
      }}
    >
      <FormField id="mfa-code" label={tr("Code from the app")} error={error ?? undefined}>
        <Input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus className="text-center text-lg tracking-[0.4em]" />
      </FormField>
      <Button type="submit" className="w-full" disabled={pending || code.length !== 6}>
        {pending ? tr("Checking…") : tr("Sign in")}
      </Button>
    </form>
  );
}
