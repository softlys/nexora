"use client";

import { Check, ChevronsUpDown, LogOut, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { initials, ROLE_LABELS } from "@/lib/format";
import { switchDemoUserAction, signOutAction } from "@/server/actions/session";
import { useShell } from "./shell-context";
import { tr } from "@/lib/i18n";

function Avatar({ name }: { name: string }) {
  return (
    <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-xs font-semibold text-brand-subtle-foreground">
      {initials(name)}
    </span>
  );
}

export function UserMenu() {
  const { user, mode, demoUsers } = useShell();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const switchTo = (id: string, name: string) =>
    startTransition(async () => {
      const result = await switchDemoUserAction({ profile_id: id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(tr("Now acting as {p0}", { p0: name }), { description: ROLE_LABELS[result.data.role] });
      router.refresh();
    });

  const byRole = (["admin", "manager", "sales_rep"] as const).map((role) => ({ role, users: demoUsers.filter((u) => u.role === role) }));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-2 px-1.5" disabled={pending} aria-label={tr("User menu, signed in as {p0}", { p0: user.full_name })} data-testid="user-menu">
          <Avatar name={user.full_name} />
          <span className="hidden min-w-0 text-left leading-tight md:block">
            <span className="block max-w-36 truncate text-sm font-medium">{user.full_name}</span>
            <span className="block text-xs text-text-muted" data-testid="current-role">
              {ROLE_LABELS[user.role]}
            </span>
          </span>
          <ChevronsUpDown className="hidden text-text-muted md:block" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <div className="text-sm font-medium">{user.full_name}</div>
          <div className="truncate text-xs text-text-muted">{user.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings/profile">
            <UserRound aria-hidden />{tr("Profile")}</Link>
        </DropdownMenuItem>
        {mode === "demo" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-text-muted">{tr("Demo mode: act as")}</DropdownMenuLabel>
            {byRole.map(({ role, users }) =>
              users.length === 0 ? null : (
                <DropdownMenuGroup key={role}>
                  {users.map((u) => (
                    <DropdownMenuItem
                      key={u.id}
                      disabled={pending}
                      onSelect={() => {
                        if (u.id !== user.id) switchTo(u.id, u.full_name);
                      }}
                      data-testid={`switch-user-${u.role}`}
                    >
                      <Avatar name={u.full_name} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{u.full_name}</span>
                        <span className="block text-xs text-text-muted">{ROLE_LABELS[u.role]}</span>
                      </span>
                      {u.id === user.id && <Check className="text-brand" aria-label={tr("Current user")} />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              ),
            )}
          </>
        )}
        {mode === "supabase" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => startTransition(() => signOutAction())}>
              <LogOut aria-hidden />{tr("Sign out")}</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
