"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";
import { NAV_ITEMS, SETTINGS_SECTIONS } from "@/domain/navigation";
import { useRecordLabels } from "./record-label";

const EXTRA_LABELS: Record<string, string> = { "/help": "Help" };

function labelFor(href: string): string | null {
  return (
    [...NAV_ITEMS, ...SETTINGS_SECTIONS].find((i) => i.href === href)?.label ?? EXTRA_LABELS[href] ?? null
  );
}

/** Breadcrumbs derived from the pathname and the navigation map. */
export function Breadcrumbs() {
  const pathname = usePathname();
  const recordLabels = useRecordLabels();
  const segments = pathname.split("/").filter(Boolean);
  const crumbs = segments.map((_, i) => {
    const href = `/${segments.slice(0, i + 1).join("/")}`;
    return { href, label: labelFor(href) ?? recordLabels.get(href) ?? (/^[0-9a-f-]{36}$/.test(segments[i]!) ? "Details" : decodeURIComponent(segments[i]!)) };
  });
  if (crumbs.length === 0) crumbs.push({ href: "/", label: "Overview" });

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-sm">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <Fragment key={c.href}>
              {i > 0 && (
                <li aria-hidden className="hidden text-text-muted sm:block">
                  /
                </li>
              )}
              <li className={last ? "truncate font-medium text-foreground" : "hidden truncate text-text-muted sm:block"}>
                {last ? (
                  <span aria-current="page">{c.label}</span>
                ) : (
                  <Link href={c.href} className="hover:text-foreground">
                    {c.label}
                  </Link>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
