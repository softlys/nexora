"use client";

import { useActionState } from "react";
import { FormField } from "@/components/patterns/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loginAction, type LoginState } from "@/server/actions/auth";
import { demoAccessAction, type DemoAccessState } from "@/server/actions/session";

export function LoginForm() {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(loginAction, { error: null });
  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-border bg-surface p-6 shadow-sm">
      <FormField id="email" label="Email">
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </FormField>
      <FormField id="password" label="Password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </FormField>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

/** Demo installations protected by NEXORA_DEMO_ACCESS_CODE. */
export function DemoAccessForm() {
  const [state, formAction, pending] = useActionState<DemoAccessState, FormData>(demoAccessAction, { error: null });
  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-border bg-surface p-6 shadow-sm">
      <FormField id="code" label="Access code">
        <Input id="code" name="code" type="password" autoComplete="off" required autoFocus maxLength={200} />
      </FormField>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Checking…" : "Open the demo"}
      </Button>
      <p className="text-xs text-text-muted">Demo data only. Inside, you can act as any of the demo users.</p>
    </form>
  );
}
