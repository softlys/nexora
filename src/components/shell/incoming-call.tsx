"use client";

import { PhoneIncoming, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { tr } from "@/lib/i18n";
import { incomingCallAction } from "@/server/actions/calls";
import { markNotificationsReadAction } from "@/server/actions/notifications";

type Card = { id: string; title: string; body: string; link: string | null };

const POLL_MS = 5000;

/**
 * The caller's card while a customer's call rings (Mango Office, Zadarma, Twilio, or a demo
 * simulation). Checks every few seconds while the tab is visible.
 */
export function IncomingCallPopup() {
  const router = useRouter();
  const [card, setCard] = useState<Card | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    const check = async () => {
      if (document.hidden) return;
      const r = await incomingCallAction({});
      if (live && r.ok) setCard(r.data);
    };
    void check();
    const timer = setInterval(check, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  if (!card || dismissed.includes(card.id)) return null;
  const close = () => {
    setDismissed((d) => [...d, card.id]);
    void markNotificationsReadAction({ ids: [card.id] });
  };
  return (
    <div role="alertdialog" aria-labelledby="incoming-call-title" className="fixed right-4 bottom-4 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-4 shadow-lg" data-testid="incoming-call">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 animate-pulse items-center justify-center rounded-full bg-success-bg text-success">
          <PhoneIncoming className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p id="incoming-call-title" className="font-medium">
            {card.title}
          </p>
          {card.body && <p className="mt-0.5 text-sm text-text-muted">{card.body}</p>}
        </div>
        <Button variant="ghost" size="icon" className="-mt-1 -mr-1 size-7" aria-label={tr("Dismiss")} onClick={close}>
          <X aria-hidden />
        </Button>
      </div>
      {card.link && (
        <Button
          size="sm"
          className="mt-3 w-full"
          onClick={() => {
            router.push(card.link!);
            close();
          }}
        >
          {tr("Open card")}
        </Button>
      )}
    </div>
  );
}
