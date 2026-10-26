"use client";

import { useActionState } from "react";
import { FormField } from "@/components/patterns/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loginAction, type LoginState } from "@/server/actions/auth";
import { demoAccessAction, type DemoAccessState } from "@/server/actions/session";
import { tr } from "@/lib/i18n";

export function LoginForm() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(loginAction, { error: null });
  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-border bg-surface p-6 shadow-sm">
      <FormField id="email" label={tr("Email")}>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </FormField>
      <FormField id="password" label={tr("Password")}>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </FormField>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? tr("Signing in…") : tr("Sign in")}
      </Button>
    </form>
  );
}

/** Demo installations protected by NEXORA_DEMO_ACCESS_CODE. */
export function DemoAccessForm() {
  const [state, formAction, pending] = useActionState<DemoAccessState, FormData>(demoAccessAction, { error: null });
  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-border bg-surface p-6 shadow-sm">
      <FormField id="code" label={tr("Access code")}>
        <Input id="code" name="code" type="password" autoComplete="off" required autoFocus maxLength={200} />
      </FormField>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? tr("Checking…") : tr("Open the demo")}
      </Button>
      <p className="text-xs text-text-muted">{tr("Demo data only. Inside, you can act as any of the demo users.")}</p>
    </form>
  );
}
