"use client";

import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { toast } from "sonner";

type FailedResult = { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/** Maps a failed server action result onto the form and shows a toast. */
export function applyServerErrors<T extends FieldValues>(result: FailedResult, setError: UseFormSetError<T>) {
  // Also kept on the form (formState.errors.root.server), shown by RecordSheet as a banner.
  setError("root.server" as Path<T>, { type: "server", message: result.error });
  if (result.fieldErrors) {
    for (const [field, messages] of Object.entries(result.fieldErrors)) {
      if (field !== "_form") setError(field as Path<T>, { type: "server", message: messages[0] });
    }
  }
  toast.error(result.error);
}
