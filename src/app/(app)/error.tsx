"use client";

import { ErrorState } from "@/components/patterns/error-state";
import { Button } from "@/components/ui/button";
import { tr } from "@/lib/i18n";

/** Generic error boundary: no stack traces or internal messages reach the user. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl py-10">
      <ErrorState
        description={tr("The page could not be loaded. Try again, and if it keeps happening, share the reference below.")}
        reference={error.digest}
        action={
          <Button variant="outline" onClick={reset}>{tr("Try again")}</Button>
        }
      />
    </div>
  );
}
