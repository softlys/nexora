"use client";

import { KeyRound, Send, Unplug } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { FormField } from "@/components/patterns/form-field";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { STATUS_HINTS, STATUS_LABELS, type IntegrationStatus } from "@/domain/integrations/status";
import { OUTBOUND_EVENT_DESCRIPTIONS, OUTBOUND_EVENTS, type OutboundEvent } from "@/domain/integrations/webhooks";
import { formatDate, formatRelative } from "@/lib/format";
import { disconnectIntegrationAction, rotateSecretAction, saveIntegrationAction, sendTestEventAction } from "@/server/actions/integrations";
import { SecretDialog } from "./secret-dialog";

export type IntegrationFormValue = {
  provider: "make" | "n8n" | "generic_webhook";
  url: string | null;
  auth_mode: "signature" | "header_token";
  subscribed_events: OutboundEvent[];
  enabled: boolean;
  secret_preview: string | null;
  status: IntegrationStatus;
  last_tested_at: string | null;
  last_error: string | null;
};

/** Endpoint, auth, subscribed events and enable switch; test event, secret rotation, disconnect. */
export function IntegrationForm({ value, canManage, urlHint }: { value: IntegrationFormValue; canManage: boolean; urlHint: string }) {
  const router = useRouter();
  const [url, setUrl] = useState(value.url ?? "");
  const [authMode, setAuthMode] = useState(value.auth_mode);
  const [events, setEvents] = useState<OutboundEvent[]>(value.subscribed_events);
  const [enabled, setEnabled] = useState(value.enabled);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const configured = value.url !== null;

  const toggle = (e: OutboundEvent, on: boolean) => setEvents((prev) => (on ? [...prev, e] : prev.filter((x) => x !== e)));

  const save = () =>
    startTransition(async () => {
      setError(null);
      const result = await saveIntegrationAction({ provider: value.provider, url, auth_mode: authMode, subscribed_events: events, enabled });
      if (!result.ok) {
        setError(result.fieldErrors ? Object.values(result.fieldErrors).flat()[0] ?? result.error : result.error);
        return;
      }
      toast.success("Integration saved");
      if (result.data.secret) setSecret(result.data.secret);
      router.refresh();
    });

  const test = () =>
    startTransition(async () => {
      const result = await sendTestEventAction({ provider: value.provider });
      if (!result.ok) return void toast.error(result.error);
      if (result.data.status === "success") toast.success(`Test event delivered (HTTP ${result.data.status_code}, ${result.data.duration_ms} ms)`);
      else toast.error(`Test event failed: ${result.data.error ?? "unknown error"}`);
      router.refresh();
    });

  const rotate = async () => {
    const result = await rotateSecretAction({ provider: value.provider });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    setSecret(result.data.secret);
    router.refresh();
  };

  const disconnect = async () => {
    const result = await disconnectIntegrationAction({ provider: value.provider });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success("Disconnected");
    setUrl("");
    setEnabled(false);
    router.refresh();
  };

  return (
    <section className="min-w-0 space-y-5 rounded-lg border border-border bg-surface p-5 shadow-xs" aria-labelledby="connection-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="connection-heading" className="text-md font-semibold">
            Connection
          </h2>
          <p className="text-sm text-text-muted">{STATUS_HINTS[value.status]}</p>
        </div>
        <div className="text-right">
          <StatusBadge status={value.status} label={STATUS_LABELS[value.status]} dot />
          {value.last_tested_at && (
            <p className="mt-1 text-xs text-text-muted" title={formatDate(value.last_tested_at)}>
              Last test {formatRelative(value.last_tested_at)}
            </p>
          )}
        </div>
      </div>
      {value.status === "error" && value.last_error && (
        <p role="alert" className="rounded-md border border-danger-border bg-danger-bg p-3 text-sm text-danger">
          {value.last_error}
        </p>
      )}

      <FormField id="webhook-url" label="Webhook URL" hint={urlHint} error={error ?? undefined}>
        <Input id="webhook-url" type="url" inputMode="url" placeholder="https://" value={url} disabled={!canManage} onChange={(e) => setUrl(e.target.value)} aria-invalid={error ? true : undefined} />
      </FormField>

      <FormField id="auth-mode" label="Authentication" hint="Every request carries an X-Nexora-Signature HMAC header. Header token also sends the secret in X-Nexora-Token for receivers that can only compare a header.">
        <Select value={authMode} onValueChange={(v) => setAuthMode(v as typeof authMode)} disabled={!canManage}>
          <SelectTrigger id="auth-mode" className="w-full sm:w-80">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="signature">HMAC signature (recommended)</SelectItem>
            <SelectItem value="header_token">HMAC signature + header token</SelectItem>
          </SelectContent>
        </Select>
      </FormField>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Events to send</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {OUTBOUND_EVENTS.map((e) => (
            <label key={e} className="flex cursor-pointer gap-2.5 rounded-md border border-border p-2.5 has-[button:focus-visible]:ring-3 has-[button:focus-visible]:ring-ring/40">
              <Checkbox checked={events.includes(e)} onCheckedChange={(on) => toggle(e, on === true)} disabled={!canManage} aria-label={e} />
              <span className="min-w-0">
                <span className="block font-mono text-xs">{e}</span>
                <span className="block text-xs text-text-muted">{OUTBOUND_EVENT_DESCRIPTIONS[e]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex items-center gap-2">
        <Switch id="integration-enabled" checked={enabled} onCheckedChange={setEnabled} disabled={!canManage} />
        <Label htmlFor="integration-enabled">Send events to this endpoint</Label>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        {canManage && (
          <Button onClick={save} disabled={pending || url.trim() === ""}>
            {pending ? "Saving…" : configured ? "Save changes" : "Save and create secret"}
          </Button>
        )}
        {canManage && configured && (
          <Button variant="outline" onClick={test} disabled={pending}>
            <Send aria-hidden />
            Send test event
          </Button>
        )}
        {value.secret_preview && <span className="text-xs text-text-muted">Signing secret ends in …{value.secret_preview}</span>}
        <span className="flex-1" />
        {canManage && configured && (
          <>
            <ConfirmDialog
              trigger={
                <Button variant="ghost" size="sm">
                  <KeyRound aria-hidden />
                  Rotate secret
                </Button>
              }
              title="Rotate the signing secret?"
              description="The current secret stops working immediately. Update the receiver with the new secret, then send a test event."
              confirmLabel="Rotate"
              onConfirm={rotate}
            />
            <ConfirmDialog
              trigger={
                <Button variant="ghost" size="sm">
                  <Unplug aria-hidden />
                  Disconnect
                </Button>
              }
              title="Disconnect this integration?"
              description="The URL and signing secret are removed and no more events are sent. The delivery log is kept."
              confirmLabel="Disconnect"
              destructive
              onConfirm={disconnect}
            />
          </>
        )}
      </div>
      {!canManage && <p className="text-xs text-text-muted">Only admins can change integrations.</p>}

      <SecretDialog
        title="Signing secret"
        description="Use it in the receiver to verify X-Nexora-Signature (HMAC-SHA256 of “timestamp.body”)."
        secret={secret}
        onClose={() => setSecret(null)}
      />
    </section>
  );
}
