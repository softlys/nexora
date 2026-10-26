"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { NavGroup } from "@/domain/navigation";
import { cn } from "@/lib/utils";
import { NAV_ICONS } from "./nav-icons";
import { tr, trNode } from "@/lib/i18n";

export function isActivePath(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav({
  groups,
  collapsed = false,
  onNavigate,
}: {
  groups: NavGroup[];
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <nav aria-label={tr("Main")} className="flex flex-col gap-4">
      {groups.map((group, gi) => (
        <div key={group.label ?? gi} className="flex flex-col gap-0.5">
          {group.label && !collapsed && (
            <div className="px-3 pb-1.5 text-[11px] font-medium tracking-wider text-sidebar-muted uppercase">{trNode(group.label)}</div>
          )}
          {group.label && collapsed && <div className="mx-2 mb-1 border-t border-sidebar-border" aria-hidden />}
          {group.items.map((item) => {
            const Icon = NAV_ICONS[item.icon];
            const active = isActivePath(pathname, item.href);
            const link = (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group flex h-9 items-center gap-3 rounded-lg px-3 text-sm text-sidebar-muted transition-colors",
                  "hover:bg-sidebar-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
                  active && "bg-brand font-medium text-brand-foreground shadow-md shadow-brand/30 hover:bg-brand hover:text-brand-foreground",
                  collapsed && "justify-center px-0",
                )}
              >
                <Icon className={cn("size-4 shrink-0", active ? "text-brand-foreground" : "text-sidebar-muted group-hover:text-sidebar-foreground")} aria-hidden />
                {collapsed ? <span className="sr-only">{trNode(item.label)}</span> : <span className="truncate">{trNode(item.label)}</span>}
              </Link>
            );
            return collapsed ? (
              <Tooltip key={item.href}>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right">{trNode(item.label)}</TooltipContent>
              </Tooltip>
            ) : (
              link
            );
          })}
        </div>
      ))}
    </nav>
  );
}
