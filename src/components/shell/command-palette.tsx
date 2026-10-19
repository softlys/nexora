"use client";

import { Building2, Handshake, Loader2, Moon, Package, Search, Settings, Sun, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
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
import { searchAction } from "@/server/actions/crm";
import type { SearchResult } from "@/server/services/search";
import { NAV_ICONS } from "./nav-icons";
import { useShell } from "./shell-context";

export const OPEN_COMMAND_PALETTE_EVENT = "nexora:open-command-palette";

const RESULT_ICON = { company: Building2, contact: Users, deal: Handshake, order: Package } as const;
const RESULT_GROUP = { company: "Companies", contact: "Contacts", deal: "Deals", order: "Orders" } as const;

/**
 * Cmd/Ctrl+K palette: page navigation plus record search. Search runs on the server and
 * only returns companies, contacts, deals and orders the current role may see.
 */
export function CommandPalette() {
  const { navGroups, settingsSections } = useShell();
  const router = useRouter();
  const { setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

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

  // Debounced server search; stale responses are ignored.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const id = ++requestId.current;
    const t = setTimeout(async () => {
      setLoading(true);
      const result = await searchAction({ q: q.slice(0, 100) });
      if (id !== requestId.current) return;
      setLoading(false);
      if (result.ok) {
        setResults(result.data);
        setError(null);
      } else {
        setResults([]);
        setError(result.error);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  const reset = () => {
    setQuery("");
    setResults([]);
    setError(null);
  };
  const go = (href: string) => {
    setOpen(false);
    reset();
    router.push(href);
  };
  const q = query.trim().toLowerCase();
  const searching = q.length >= 2;
  const matches = (text: string) => !q || text.toLowerCase().includes(q);
  const navMatches = navGroups.map((g) => ({ ...g, items: g.items.filter((i) => matches(`${i.label} ${(i.keywords ?? []).join(" ")}`)) })).filter((g) => g.items.length > 0);
  const settingsMatches = settingsSections.filter((s) => matches(`settings ${s.label}`));
  const shownResults = searching ? results : [];
  const groups = (["company", "contact", "deal", "order"] as const).map((kind) => ({ kind, items: shownResults.filter((r) => r.kind === kind) })).filter((g) => g.items.length > 0);

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
      title="Command palette"
      description="Search records or jump to a page"
    >
      <Command shouldFilter={false}>
        <CommandInput placeholder="Search records or go to page…" value={query} onValueChange={(v) => setQuery(v.slice(0, 100))} />
        <CommandList>
          <CommandEmpty>{loading ? "Searching…" : (error ?? "No matches.")}</CommandEmpty>
          {loading && searching && (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-text-muted" aria-live="polite">
              <Loader2 className="size-3 animate-spin" aria-hidden /> Searching records…
            </div>
          )}
          {groups.map((g) => {
            const Icon = RESULT_ICON[g.kind];
            return (
              <CommandGroup key={g.kind} heading={RESULT_GROUP[g.kind]}>
                {g.items.map((r) => (
                  <CommandItem key={`${r.kind}-${r.id}`} value={`${r.kind}-${r.id}`} onSelect={() => go(r.href)}>
                    <Icon aria-hidden />
                    <span className="truncate">{r.title}</span>
                    {r.subtitle && <span className="ml-auto truncate text-xs text-text-muted">{r.subtitle}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            );
          })}
          {navMatches.map((group, gi) => (
            <CommandGroup key={group.label ?? gi} heading={group.label ?? "General"}>
              {group.items.map((item) => {
                const Icon = NAV_ICONS[item.icon];
                return (
                  <CommandItem key={item.href} value={`nav-${item.href}`} onSelect={() => go(item.href)}>
                    <Icon aria-hidden />
                    {item.label}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))}
          {settingsMatches.length > 0 && (
            <CommandGroup heading="Settings">
              {settingsMatches.map((s) => (
                <CommandItem key={s.href} value={`nav-${s.href}`} onSelect={() => go(s.href)}>
                  <Settings aria-hidden />
                  {s.label}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {!searching && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Preferences">
                <CommandItem
                  value="theme-light"
                  onSelect={() => {
                    setTheme("light");
                    setOpen(false);
                  }}
                >
                  <Sun aria-hidden />
                  Switch to light theme
                </CommandItem>
                <CommandItem
                  value="theme-dark"
                  onSelect={() => {
                    setTheme("dark");
                    setOpen(false);
                  }}
                >
                  <Moon aria-hidden />
                  Switch to dark theme
                </CommandItem>
              </CommandGroup>
            </>
          )}
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
