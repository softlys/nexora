"use client";

import { BookOpen, CircleHelp, Keyboard } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { tr } from "@/lib/i18n";

const SHORTCUTS: Array<[string, string]> = [
  [tr("Ctrl / Cmd + K"), tr("Open command palette")],
  [tr("Esc"), tr("Close dialogs and menus")],
  [tr("Tab / Shift + Tab"), tr("Move focus")],
  [tr("Enter"), tr("Open the focused row")],
];

export function HelpMenu() {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={tr("Help")}>
            <CircleHelp aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel>{tr("Help")}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/help">
              <BookOpen aria-hidden />{tr("Guide and documentation")}</Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setShortcutsOpen(true)}>
            <Keyboard aria-hidden />{tr("Keyboard shortcuts")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("Keyboard shortcuts")}</DialogTitle>
            <DialogDescription>{tr("Shortcuts available everywhere in NEXORA.")}</DialogDescription>
          </DialogHeader>
          <dl className="divide-y divide-border rounded-md border border-border">
            {SHORTCUTS.map(([keys, action]) => (
              <div key={keys} className="flex items-center justify-between px-3 py-2 text-sm">
                <dt className="text-text-subtle">{action}</dt>
                <dd>
                  <kbd className="rounded border border-border bg-surface-muted px-1.5 py-0.5 font-mono text-xs">{keys}</kbd>
                </dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </>
  );
}
