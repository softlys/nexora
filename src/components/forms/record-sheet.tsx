"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { tr, trNode } from "@/lib/i18n";


/**
 * Open state for a create form that can be opened from the quick-create menu (?new=1).
 * Closing it removes the parameter so a reload does not reopen the form.
 */
export function useAutoOpen(autoOpen: boolean): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(autoOpen);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return [
    open,
    (next: boolean) => {
      setOpen(next);
      if (!next && params.get("new")) {
        const sp = new URLSearchParams(params.toString());
        sp.delete("new");
        router.replace(sp.size ? `${pathname}?${sp}` : pathname, { scroll: false });
      }
    },
  ];
}

/** Warns before leaving the page while a form has unsaved changes. */
export function useUnsavedChangesWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
}

/**
 * Side sheet hosting a create/edit form. Closing a dirty form (Cancel, ×, Escape, outside
 * click) asks for confirmation in an in-app dialog, and leaving the page with unsaved changes
 * triggers the browser warning. Server errors show as a banner above the buttons, so they are
 * visible even when a toast is missed.
 */
export function RecordSheet({
  open,
  onOpenChange,
  title,
  description,
  dirty,
  submitting,
  submitLabel = "Save",
  onSubmit,
  children,
  wide = false,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  dirty: boolean;
  submitting: boolean;
  submitLabel?: string;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
  wide?: boolean;
  /** Error from the server for the whole form (shown above the buttons). */
  error?: string;
}) {
  useUnsavedChangesWarning(open && dirty);
  const [confirming, setConfirming] = useState(false);
  const requestClose = (next: boolean) => {
    if (!next && dirty && !submitting) {
      setConfirming(true);
      return;
    }
    onOpenChange(next);
  };
  return (
    <Sheet open={open} onOpenChange={requestClose}>
      <SheetContent className={cn("flex w-full flex-col gap-0 p-0 sm:max-w-lg", wide && "sm:max-w-3xl")}>
        <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
          <SheetHeader className="border-b border-border px-5 py-4">
            <SheetTitle>{trNode(title)}</SheetTitle>
            {description ? <SheetDescription>{trNode(description)}</SheetDescription> : <SheetDescription className="sr-only">{trNode(title)}</SheetDescription>}
          </SheetHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">{children}</div>
          {error && (
            <p role="alert" className="mx-5 mb-3 rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger" data-testid="form-error">
              {error}
            </p>
          )}
          <SheetFooter className="flex-row justify-end gap-2 border-t border-border px-5 py-3">
            <Button type="button" variant="outline" onClick={() => requestClose(false)}>{tr("Cancel")}</Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? tr("Saving…") : submitLabel}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr("Discard unsaved changes?")}</AlertDialogTitle>
            <AlertDialogDescription>{tr("Your edits in this form will be lost.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr("Keep editing")}</AlertDialogCancel>
            <Button
              variant="danger"
              onClick={() => {
                setConfirming(false);
                onOpenChange(false);
              }}
            >{tr("Discard changes")}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}
