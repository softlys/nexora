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

const SHORTCUTS: Array<[string, string]> = [
  ["Ctrl / Cmd + K", "Open command palette"],
  ["Esc", "Close dialogs and menus"],
  ["Tab / Shift + Tab", "Move focus"],
  ["Enter", "Open the focused row"],
];

export function HelpMenu() {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Help">
            <CircleHelp aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel>Help</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/help">
              <BookOpen aria-hidden />
              Guide and documentation
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setShortcutsOpen(true)}>
            <Keyboard aria-hidden />
            Keyboard shortcuts
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>Shortcuts available everywhere in NEXORA.</DialogDescription>
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
