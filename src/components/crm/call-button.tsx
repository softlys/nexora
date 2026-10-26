"use client";

import { Phone } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { tr } from "@/lib/i18n";
import { startCallAction } from "@/server/actions/calls";

/**
 * Calls a record's number. With the PBX connected and the user's internal number set, the PBX rings
 * the user's phone first and then the customer; otherwise the device's phone app opens (tel:).
 */
export function CallButton({ entity, id, phone, callback }: { entity: "contact" | "lead" | "company"; id: string; phone: string; callback: boolean }) {
  const [pending, start] = useTransition();
  if (!callback) {
    return (
      <Button variant="outline" asChild data-testid="call-button">
        <a href={`tel:${phone.replace(/[^\d+]/g, "")}`}>
          <Phone aria-hidden />
          {tr("Call")}
        </a>
      </Button>
    );
  }
  return (
    <Button
      variant="outline"
      disabled={pending}
      data-testid="call-button"
      onClick={() =>
        start(async () => {
          const r = await startCallAction({ entity, id });
          if (r.ok) toast.success(tr("Calling: pick up your phone, then {p0} is dialled.", { p0: r.data.phone }));
          else toast.error(r.error);
        })
      }
    >
      <Phone aria-hidden />
      {pending ? tr("Calling…") : tr("Call")}
    </Button>
  );
}
