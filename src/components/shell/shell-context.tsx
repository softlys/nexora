"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { NavGroup, SettingsSection } from "@/domain/navigation";
import type { Notification, Role } from "@/domain/entities";

/** Narrow, serializable data the client shell needs. No secrets, no other users' private data. */
export type ShellData = {
  mode: "demo" | "supabase";
  organization: { name: string; currency: string; locale: string };
  user: { id: string; full_name: string; email: string; role: Role; title: string };
  navGroups: NavGroup[];
  settingsSections: SettingsSection[];
  notifications: { items: Notification[]; unread: number };
  demoUsers: Array<{ id: string; full_name: string; role: Role; title: string }>;
  quickCreate: Array<{ label: string; href: string; icon: "company" | "contact" | "lead" | "deal" | "order" | "task" | "stage" }>;
  sidebarCollapsed: boolean;
  /** Poll for incoming call cards (a telephony provider is connected, or demo mode can simulate calls). */
  incomingCalls: boolean;
};

const ShellContext = createContext<ShellData | null>(null);

export function ShellProvider({ value, children }: { value: ShellData; children: ReactNode }) {
  return <ShellContext value={value}>{children}</ShellContext>;
}

export function useShell(): ShellData {
  const value = useContext(ShellContext);
  if (!value) throw new Error("useShell must be used inside ShellProvider");
  return value;
}
