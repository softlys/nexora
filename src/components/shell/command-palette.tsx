"use client";

import { Moon, Search, Settings, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { NAV_ICONS } from "./nav-icons";
import { useShell } from "./shell-context";

export const OPEN_COMMAND_PALETTE_EVENT = "nexora:open-command-palette";

/**
 * Cmd/Ctrl+K palette. Phase 1: navigation to every page the role can open, plus theme.
 * Record search is added in phase 2 (server-side, permission-scoped).
 */
export function CommandPalette() {
  const { navGroups, settingsSections } = useShell();
  const router = useRouter();
  const { setTheme } = useTheme();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpen);
    };
  }, []);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Command palette" description="Jump to a page or run a command">
      <Command>
        <CommandInput placeholder="Go to page…" />
        <CommandList>
          <CommandEmpty>No matching pages.</CommandEmpty>
          {navGroups.map((group, gi) => (
            <CommandGroup key={group.label ?? gi} heading={group.label ?? "General"}>
              {group.items.map((item) => {
                const Icon = NAV_ICONS[item.icon];
                return (
                  <CommandItem key={item.href} value={`${item.label} ${(item.keywords ?? []).join(" ")}`} onSelect={() => go(item.href)}>
                    <Icon aria-hidden />
                    {item.label}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))}
          {settingsSections.length > 0 && (
            <CommandGroup heading="Settings">
              {settingsSections.map((s) => (
                <CommandItem key={s.href} value={`Settings ${s.label}`} onSelect={() => go(s.href)}>
                  <Settings aria-hidden />
                  {s.label}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          <CommandSeparator />
          <CommandGroup heading="Preferences">
            <CommandItem value="Light theme" onSelect={() => { setTheme("light"); setOpen(false); }}>
              <Sun aria-hidden />
              Switch to light theme
            </CommandItem>
            <CommandItem value="Dark theme" onSelect={() => { setTheme("dark"); setOpen(false); }}>
              <Moon aria-hidden />
              Switch to dark theme
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

export function CommandPaletteButton() {
  return (
    <Button
      variant="outline"
      size="sm"
      className="w-9 justify-center px-0 text-text-muted sm:w-56 sm:justify-start sm:px-2.5"
      onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT))}
      aria-label="Open command palette"
    >
      <Search aria-hidden />
      <span className="hidden sm:inline">Search or jump to…</span>
      <CommandShortcut className="ml-auto hidden sm:inline">Ctrl K</CommandShortcut>
    </Button>
  );
}
