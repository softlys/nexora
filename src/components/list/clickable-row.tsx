"use client";

import { useRouter } from "next/navigation";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

/**
 * Table row that opens a record on click or Enter. Clicks on links, buttons and
 * inputs inside the row keep their own behavior.
 */
export function ClickableRow({ href, children }: { href: string; children: ReactNode }) {
  const router = useRouter();
  const interactive = (target: EventTarget | null) => target instanceof Element && target.closest("a, button, input, select, textarea, [role='checkbox'], [role='combobox']");
  const open = (e: MouseEvent | KeyboardEvent) => {
    if (interactive(e.target)) return;
    if ("metaKey" in e && (e.metaKey || e.ctrlKey)) window.open(href, "_blank", "noopener,noreferrer");
    else router.push(href);
  };
  return (
    <tr
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter") open(e);
      }}
      className="cursor-pointer border-b border-border last:border-b-0 hover:bg-surface-subtle focus-visible:bg-surface-subtle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
    >
      {children}
    </tr>
  );
}
