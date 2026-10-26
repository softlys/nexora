"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { tr, trNode } from "@/lib/i18n";

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
      {copied ? tr("Copied") : label}
    </Button>
  );
}

/** Shows a secret or API key exactly once. Closing the dialog discards it from the page. */
export function SecretDialog({ title, description, secret, onClose }: { title: string; description: string; secret: string | null; onClose: () => void }) {
  return (
    <Dialog open={secret !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{trNode(title)}</DialogTitle>
          <DialogDescription>{trNode(description)}</DialogDescription>
        </DialogHeader>
        {secret && (
          <div className="space-y-3">
            <code data-testid="revealed-secret" className="block rounded-md border border-border bg-surface-muted p-3 font-mono text-xs break-all select-all">
              {secret}
            </code>
            <p className="text-xs text-warning">{tr("This is the only time it is shown. NEXORA stores it encrypted (signing secrets) or as a hash (API keys).")}</p>
          </div>
        )}
        <DialogFooter>
          {secret && <CopyButton value={secret} />}
          <Button type="button" onClick={onClose}>{tr("I saved it")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
