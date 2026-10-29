"use client";

import { FileText, Paperclip, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatRelative } from "@/lib/format";
import { tr } from "@/lib/i18n";
import { archiveAttachmentAction } from "@/server/actions/attachments";

export type AttachmentItem = { id: string; file_name: string; size: number; content_type: string; created_at: string; uploader: string | null; canRemove: boolean };

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Uploads one file through /api/files; returns its id or null (and shows the error). */
export async function uploadFile(file: File, entity: string, entityId: string): Promise<string | null> {
  if (file.size > 10 * 1024 * 1024) {
    toast.error(tr("The file is larger than 10 MB."));
    return null;
  }
  const body = new FormData();
  body.set("file", file);
  body.set("entity", entity);
  body.set("entity_id", entityId);
  const response = await fetch("/api/files", { method: "POST", body });
  const data = (await response.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!response.ok || !data.id) {
    toast.error(tr(data.error ?? "The file was not uploaded."));
    return null;
  }
  return data.id;
}

export function AttachmentList({ entity, entityId, items, canUpload }: { entity: string; entityId: string; items: AttachmentItem[]; canUpload: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3" data-testid="attachments">
      {items.length === 0 && <p className="text-sm text-text-muted">{tr("No files yet.")}</p>}
      <ul className="space-y-2">
        {items.map((a) => (
          <li key={a.id} className="flex items-center gap-3">
            {a.content_type.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element -- a private file behind an access check, not an optimizable asset
              <img src={`/api/files/${a.id}`} alt="" className="size-10 shrink-0 rounded border border-border object-cover" />
            ) : (
              <FileText className="size-10 shrink-0 rounded border border-border p-2 text-text-muted" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <a href={`/api/files/${a.id}`} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium text-brand hover:underline">
                {a.file_name}
              </a>
              <p className="truncate text-xs text-text-muted">
                {formatSize(a.size)} · {a.uploader ?? tr("Customer")} · {formatRelative(a.created_at)}
              </p>
            </div>
            {a.canRemove && (
              <Button
                size="icon"
                variant="ghost"
                aria-label={tr("Remove {p0}", { p0: a.file_name })}
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await archiveAttachmentAction({ id: a.id });
                    if (!r.ok) return void toast.error(r.error);
                    router.refresh();
                  })
                }
              >
                <Trash2 aria-hidden />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canUpload && (
        <>
          <input
            ref={input}
            type="file"
            className="sr-only"
            data-testid="attachment-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              start(async () => {
                if (await uploadFile(file, entity, entityId)) {
                  toast.success(tr("File added"));
                  router.refresh();
                }
              });
            }}
          />
          <Button size="sm" variant="outline" disabled={pending} onClick={() => input.current?.click()}>
            <Paperclip aria-hidden />
            {pending ? tr("Uploading…") : tr("Add file")}
          </Button>
        </>
      )}
    </div>
  );
}
