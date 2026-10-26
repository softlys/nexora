"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { tr } from "@/lib/i18n";

export function SettingsNav({ sections }: { sections: Array<{ href: string; label: string }> }) {
  const pathname = usePathname();
  return (
    <nav aria-label={tr("Settings")} className="min-w-0 md:w-52 md:shrink-0">
      <ul className="relative flex gap-1 overflow-x-auto md:flex-col">
        {sections.map((s) => {
          const active = pathname === s.href;
          return (
            <li key={s.href}>
              <Link
                href={s.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "block rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap text-text-subtle hover:bg-surface-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                  active && "bg-surface-muted font-medium text-foreground",
                )}
              >
                {s.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
