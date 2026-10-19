"use client";

import { Bell, CheckCheck } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { markNotificationsReadAction } from "@/server/actions/notifications";
import { useShell } from "./shell-context";

/** Bell reading the notifications table for the current user. */
export function NotificationsMenu() {
  const { notifications } = useShell();
  const [pending, startTransition] = useTransition();

  const markRead = (ids: string[] | "all") =>
    startTransition(async () => {
      const result = await markNotificationsReadAction({ ids });
      if (!result.ok) toast.error(result.error);
    });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Notifications${notifications.unread ? `, ${notifications.unread} unread` : ""}`} className="relative">
          <Bell aria-hidden />
          {notifications.unread > 0 && (
            <span className="absolute top-1 right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-brand px-1 text-[10px] leading-none font-semibold text-brand-foreground tabular-nums">
              {notifications.unread > 9 ? "9+" : notifications.unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          <Button variant="ghost" size="xs" disabled={pending || notifications.unread === 0} onClick={() => markRead("all")}>
            <CheckCheck aria-hidden />
            Mark all read
          </Button>
        </div>
        {notifications.items.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-text-muted">You have no notifications.</p>
        ) : (
          <ul className="max-h-96 overflow-y-auto py-1">
            {notifications.items.map((n) => {
              const body = (
                <>
                  <span aria-hidden className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-brand")} />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-sm", n.read_at ? "text-text-subtle" : "font-medium text-foreground")}>{n.title}</span>
                    {n.body && <span className="block truncate text-xs text-text-muted">{n.body}</span>}
                    <span className="mt-0.5 block text-[11px] text-text-muted">{formatRelative(n.created_at)}</span>
                  </span>
                  {!n.read_at && <span className="sr-only">Unread</span>}
                </>
              );
              const itemClass = "flex w-full gap-2.5 px-3 py-2 text-left hover:bg-surface-subtle focus-visible:bg-surface-subtle focus-visible:outline-none";
              return (
                <li key={n.id}>
                  {n.link ? (
                    <Link href={n.link} onClick={() => !n.read_at && markRead([n.id])} className={itemClass}>
                      {body}
                    </Link>
                  ) : (
                    <button type="button" onClick={() => !n.read_at && markRead([n.id])} className={itemClass}>
                      {body}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
