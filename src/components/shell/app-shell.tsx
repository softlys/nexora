"use client";

import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { Brand } from "./brand";
import { Breadcrumbs } from "./breadcrumbs";
import { CommandPalette, CommandPaletteButton } from "./command-palette";
import { HelpMenu } from "./help-menu";
import { NotificationsMenu } from "./notifications-menu";
import { QuickCreate } from "./quick-create";
import { ShellProvider, type ShellData } from "./shell-context";
import { SidebarNav } from "./sidebar-nav";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";

export const SIDEBAR_COOKIE = "nx_sidebar";

export function AppShell({ data, children }: { data: ShellData; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(data.sidebarCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    // UI preference only (not business data): remembered for server rendering.
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax`;
  };

  return (
    <ShellProvider value={data}>
      <div className="flex min-h-dvh bg-background">
        <a href="#main" className="sr-only z-50 rounded-md bg-surface px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:shadow-md">
          Skip to content
        </a>

        {/* Desktop sidebar */}
        <aside
          className={cn(
            "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-sidebar transition-[width] duration-150 lg:flex",
            collapsed ? "w-14" : "w-60",
          )}
          data-testid="sidebar"
        >
          <div className={cn("flex h-14 items-center border-b border-border", collapsed ? "justify-center px-2" : "px-4")}>
            <Brand orgName={data.organization.name} collapsed={collapsed} />
          </div>
          <div className={cn("flex-1 overflow-y-auto py-3", collapsed ? "px-2" : "px-3")}>
            <SidebarNav groups={data.navGroups} collapsed={collapsed} />
          </div>
          <div className={cn("border-t border-border p-2", collapsed && "flex justify-center")}>
            <Button
              variant="ghost"
              size={collapsed ? "icon" : "sm"}
              onClick={toggleCollapsed}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className={cn(!collapsed && "w-full justify-start text-text-muted")}
            >
              {collapsed ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
              {!collapsed && "Collapse"}
            </Button>
          </div>
        </aside>

        {/* Mobile drawer */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-72 bg-sidebar p-0">
            <SheetHeader className="border-b border-border px-4 py-3">
              <SheetTitle asChild>
                <div>
                  <Brand orgName={data.organization.name} />
                </div>
              </SheetTitle>
              <SheetDescription className="sr-only">Main navigation</SheetDescription>
            </SheetHeader>
            <div className="overflow-y-auto px-3 py-3">
              <SidebarNav groups={data.navGroups} onNavigate={() => setMobileOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-4">
            <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
              <Menu aria-hidden />
            </Button>
            <div className="min-w-0 flex-1">
              <Breadcrumbs />
            </div>
            <div className="flex items-center gap-1">
              <CommandPaletteButton />
              <QuickCreate />
              <NotificationsMenu />
              <HelpMenu />
              <ThemeToggle />
              <UserMenu />
            </div>
          </header>
          {data.mode === "demo" && (
            <div className="border-b border-warning-border bg-warning-bg px-4 py-1.5 text-xs text-warning">
              Demo mode: fictional data stored on this server. Payments are simulated. Switch users from the menu in the top right.
            </div>
          )}
          <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
            {children}
          </main>
        </div>
        <CommandPalette />
      </div>
    </ShellProvider>
  );
}
