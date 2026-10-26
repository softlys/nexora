"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { SecretDialog } from "@/components/integrations/secret-dialog";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { FormField } from "@/components/patterns/form-field";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { maskedKey, SCOPE_DESCRIPTIONS, SCOPES_BY_KIND, type ApiKeyKind, type ApiScope } from "@/domain/api/keys";
import type { ApiKey } from "@/domain/entities";
import { formatDate, formatRelative } from "@/lib/format";
import { createApiKeyAction, revokeApiKeyAction } from "@/server/actions/integrations";
import { tr } from "@/lib/i18n";

type KeyView = Omit<ApiKey, "key_hash">;

export function ApiKeysManager({ keys }: { keys: KeyView[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ApiKeyKind>("integration");
  const [scopes, setScopes] = useState<ApiScope[]>(["leads:write"]);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Every new key starts from the defaults, not from the previous key's choices.
  const openNew = () => {
    setName("");
    setKind("integration");
    setScopes(["leads:write"]);
    setError(null);
    setOpen(true);
  };

  const changeKind = (k: ApiKeyKind) => {
    setKind(k);
    setScopes([SCOPES_BY_KIND[k][0]!]);
  };

  const create = () =>
    startTransition(async () => {
      setError(null);
      const result = await createApiKeyAction({ name, kind, scopes });
      if (!result.ok) {
        setError(result.fieldErrors ? Object.values(result.fieldErrors).flat()[0] ?? result.error : result.error);
        return;
      }
      setOpen(false);
      setName("");
      setRevealed(result.data.key);
      router.refresh();
    });

  const revoke = async (id: string) => {
    const result = await revokeApiKeyAction({ id, reason: tr("Revoked in Settings") });
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    toast.success(tr("Key revoked"));
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openNew}>
          <Plus aria-hidden />{tr("Create API key")}</Button>
      </div>
      {keys.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-strong p-6 text-center text-sm text-text-muted">{tr("No API keys yet. Create one for Make, n8n, a website form or the SIEM.")}</p>
      ) : (
        <div className="relative overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">{tr("API keys")}</caption>
            <thead className="border-b border-border bg-surface-subtle text-xs text-text-muted">
              <tr>
                <th scope="col" className="h-9 px-3 text-left font-medium">{tr("Name")}</th>
                <th scope="col" className="h-9 px-3 text-left font-medium">{tr("Key")}</th>
                <th scope="col" className="hidden h-9 px-3 text-left font-medium md:table-cell">{tr("Scopes")}</th>
                <th scope="col" className="hidden h-9 px-3 text-left font-medium sm:table-cell">{tr("Last used")}</th>
                <th scope="col" className="h-9 px-3 text-left font-medium">{tr("Status")}</th>
                <th scope="col" className="h-9 px-3">
                  <span className="sr-only">{tr("Actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="border-b border-border last:border-0" data-testid="api-key-row">
                  <td className="px-3 py-2">
                    <span className="font-medium">{k.name}</span>
                    <span className="block text-xs text-text-muted">{k.kind === "siem" ? tr("SIEM key") : tr("Integration key")} {tr("· created")} {formatDate(k.created_at)}</span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{maskedKey(k)}</td>
                  <td className="hidden px-3 py-2 md:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {k.scopes.map((s) => (
                        <span key={s} className="rounded border border-border px-1 font-mono text-[11px]">
                          {s}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="hidden px-3 py-2 text-text-subtle sm:table-cell">{k.last_used_at ? formatRelative(k.last_used_at) : tr("Never")}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={k.revoked_at ? "revoked" : "active"} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    {!k.revoked_at && (
                      <ConfirmDialog
                        trigger={
                          <Button variant="ghost" size="sm">{tr("Revoke")}</Button>
                        }
                        title={tr("Revoke “{p0}”?", { p0: k.name })}
                        description={tr("Requests with this key fail immediately, and any further use is logged as api_key.used_after_revoke. This cannot be undone.")}
                        confirmLabel={tr("Revoke key")}
                        destructive
                        onConfirm={() => revoke(k.id)}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{tr("Create API key")}</DialogTitle>
            <DialogDescription>{tr("Give it the fewest scopes that do the job.")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <FormField id="key-name" label={tr("Name")} hint={tr("Where it is used, e.g. “Make — lead notifications”.")} error={error ?? undefined}>
              <Input id="key-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
            </FormField>
            <FormField id="key-kind" label={tr("Kind")}>
              <Select value={kind} onValueChange={(v) => changeKind(v as ApiKeyKind)}>
                <SelectTrigger id="key-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="integration">{tr("Integration (Make, n8n, forms)")}</SelectItem>
                  <SelectItem value="siem">{tr("SIEM (security log and response)")}</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{tr("Scopes")}</legend>
              {SCOPES_BY_KIND[kind].map((s) => (
                <label key={s} className="flex cursor-pointer gap-2.5 text-sm">
                  <Checkbox checked={scopes.includes(s)} onCheckedChange={(on) => setScopes((prev) => (on === true ? [...prev, s] : prev.filter((x) => x !== s)))} aria-label={s} />
                  <span>
                    <span className="block font-mono text-xs">{s}</span>
                    <span className="block text-xs text-text-muted">{SCOPE_DESCRIPTIONS[s]}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{tr("Cancel")}</Button>
            <Button onClick={create} disabled={pending || name.trim() === "" || scopes.length === 0}>
              {pending ? tr("Creating…") : tr("Create key")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SecretDialog title={tr("Your new API key")} description={tr("Send it as Authorization: Bearer <key>.")} secret={revealed} onClose={() => setRevealed(null)} />
    </div>
  );
}
