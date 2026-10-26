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
import { IncomingCallPopup } from "./incoming-call";
import { QuickCreate } from "./quick-create";
import { ShellProvider, type ShellData } from "./shell-context";
import { SidebarNav } from "./sidebar-nav";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";
import { tr } from "@/lib/i18n";

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
        <a href="#main" className="sr-only z-50 rounded-md bg-surface px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:shadow-md">{tr("Skip to content")}</a>

        {/* Desktop sidebar */}
        <aside
          className={cn(
            "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-150 lg:flex",
            collapsed ? "w-16" : "w-64",
          )}
          data-testid="sidebar"
        >
          <div className={cn("flex h-16 items-center", collapsed ? "justify-center px-2" : "px-5")}>
            <Brand orgName={data.organization.name} collapsed={collapsed} />
          </div>
          <div className={cn("flex-1 overflow-y-auto py-2", collapsed ? "px-2" : "px-3")}>
            <SidebarNav groups={data.navGroups} collapsed={collapsed} />
          </div>
          <div className={cn("border-t border-sidebar-border p-2", collapsed && "flex justify-center")}>
            <Button
              variant="ghost"
              size={collapsed ? "icon" : "sm"}
              onClick={toggleCollapsed}
              aria-label={collapsed ? tr("Expand sidebar") : tr("Collapse sidebar")}
              className={cn("text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-foreground", !collapsed && "w-full justify-start")}
            >
              {collapsed ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
              {!collapsed && tr("Collapse")}
            </Button>
          </div>
        </aside>

        {/* Mobile drawer */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-72 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground">
            <SheetHeader className="border-b border-sidebar-border px-4 py-3">
              <SheetTitle asChild>
                <div>
                  <Brand orgName={data.organization.name} />
                </div>
              </SheetTitle>
              <SheetDescription className="sr-only">{tr("Main navigation")}</SheetDescription>
            </SheetHeader>
            <div className="overflow-y-auto px-3 py-3">
              <SidebarNav groups={data.navGroups} onNavigate={() => setMobileOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-border bg-surface/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-surface/80 sm:px-6">
            <Button variant="ghost" size="icon" className="lg:hidden" aria-label={tr("Open navigation")} onClick={() => setMobileOpen(true)}>
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
            <div className="border-b border-warning-border bg-warning-bg px-4 py-1.5 text-xs text-warning">{tr("Demo mode: fictional data stored on this server. Payments are simulated. Switch users from the menu in the top right.")}</div>
          )}
          <main id="main" className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-8">
            {children}
          </main>
        </div>
        <CommandPalette />
        {data.incomingCalls && <IncomingCallPopup />}
      </div>
    </ShellProvider>
  );
}
