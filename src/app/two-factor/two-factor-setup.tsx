"use client";

import { ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FormField } from "@/components/patterns/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { tr } from "@/lib/i18n";
import { confirmMfaSetupAction, removeMfaAction, setRequireMfaAction, startMfaSetupAction } from "@/server/actions/mfa";

const CodeInput = ({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) => (
  <Input id={id} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))} className="w-40 text-center tracking-[0.3em]" />
);

/** Turn two-factor sign-in on (QR code + first code) or off (with a current code). */
export function TwoFactorSetup({ enabled, required, isAdmin }: { enabled: boolean; required: boolean; isAdmin: boolean }) {
  const router = useRouter();
  const [setup, setSetup] = useState<{ factorId: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<void>) => start(async () => {
    setError(null);
    await fn();
  });

  return (
    <div className="space-y-6">
      {enabled ? (
        <div className="space-y-4">
          <p className="flex items-center gap-2 font-medium text-success">
            <ShieldCheck className="size-5" aria-hidden />
            {tr("Two-factor sign-in is on.")}
          </p>
          {!required && (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  const r = await removeMfaAction({ code });
                  if (!r.ok) return setError(r.error);
                  toast.success(tr("Two-factor sign-in is off"));
                  router.refresh();
                });
              }}
            >
              <FormField id="mfa-off" label={tr("Code from the app, to turn it off")} error={error ?? undefined}>
                <CodeInput id="mfa-off" value={code} onChange={setCode} />
              </FormField>
              <Button type="submit" variant="outline" disabled={pending || code.length !== 6}>
                {tr("Turn off")}
              </Button>
            </form>
          )}
        </div>
      ) : setup ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const r = await confirmMfaSetupAction({ factorId: setup.factorId, code });
              if (!r.ok) return setError(r.error);
              toast.success(tr("Two-factor sign-in is on"));
              router.push("/");
            });
          }}
        >
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>{tr("Install an authenticator app: Яндекс Ключ, Google Authenticator or similar.")}</li>
            <li>{tr("Scan the QR code, or enter the key by hand.")}</li>
            <li>{tr("Enter the 6-digit code the app shows.")}</li>
          </ol>
          <div className="flex flex-wrap items-center gap-6">
            <img src={setup.qr} alt={tr("QR code for the authenticator app")} className="size-44 rounded-md border border-border bg-white p-2" />
            <code className="rounded bg-surface-muted px-2 py-1 font-mono text-sm break-all">{setup.secret}</code>
          </div>
          <FormField id="mfa-confirm" label={tr("Code from the app")} error={error ?? undefined}>
            <CodeInput id="mfa-confirm" value={code} onChange={setCode} />
          </FormField>
          <Button type="submit" disabled={pending || code.length !== 6}>
            {pending ? tr("Checking…") : tr("Turn on")}
          </Button>
        </form>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-text-muted">{tr("After the password, NEXORA will ask for a code from an app on your phone, so a stolen password alone is not enough.")}</p>
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button
            onClick={() =>
              run(async () => {
                const r = await startMfaSetupAction();
                if (!r.ok) return setError(r.error);
                setSetup(r.data);
              })
            }
            disabled={pending}
            data-testid="start-mfa"
          >
            <ShieldCheck aria-hidden />
            {tr("Set up two-factor sign-in")}
          </Button>
        </div>
      )}
      {isAdmin && enabled && (
        <label className="flex items-center gap-3 border-t border-border pt-4 text-sm">
          <Switch
            checked={required}
            disabled={pending}
            onCheckedChange={(v) =>
              run(async () => {
                const r = await setRequireMfaAction({ required: v });
                if (!r.ok) return setError(r.error);
                router.refresh();
              })
            }
          />
          {tr("Require two-factor sign-in for everyone in the organization")}
        </label>
      )}
    </div>
  );
}
