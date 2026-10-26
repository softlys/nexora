/**
 * Navigation map. Pure data so it can be shared by the sidebar, the command
 * palette, breadcrumbs, route guards and tests. Icons are resolved in the UI layer.
 */
import { can, type Action, type Actor, type Resource } from "./permissions";

export type NavIcon =
  | "overview"
  | "companies"
  | "contacts"
  | "leads"
  | "deals"
  | "pipeline"
  | "orders"
  | "tasks"
  | "automation"
  | "integrations"
  | "analytics"
  | "uikit"
  | "settings";

export type NavItem = {
  href: string;
  label: string;
  icon: NavIcon;
  requires: { action: Action; resource: Resource };
  /** Search keywords for the command palette. */
  keywords?: string[];
};

export type NavGroup = { label: string | null; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [{ href: "/", label: "Overview", icon: "overview", requires: { action: "view", resource: "analytics" }, keywords: ["dashboard", "home"] }],
  },
  {
    label: "CRM",
    items: [
      { href: "/companies", label: "Companies", icon: "companies", requires: { action: "view", resource: "company" }, keywords: ["accounts", "customers"] },
      { href: "/contacts", label: "Contacts", icon: "contacts", requires: { action: "view", resource: "contact" }, keywords: ["people"] },
      { href: "/leads", label: "Leads", icon: "leads", requires: { action: "view", resource: "lead" }, keywords: ["prospects"] },
      { href: "/deals", label: "Deals", icon: "deals", requires: { action: "view", resource: "deal" }, keywords: ["opportunities"] },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/pipeline", label: "Sales Pipeline", icon: "pipeline", requires: { action: "view", resource: "deal" }, keywords: ["kanban", "board", "forecast"] },
      { href: "/orders", label: "Orders", icon: "orders", requires: { action: "view", resource: "order" }, keywords: ["invoices", "payments"] },
      { href: "/tasks", label: "Tasks & Activities", icon: "tasks", requires: { action: "view", resource: "task" }, keywords: ["todo", "calendar", "activities"] },
    ],
  },
  {
    label: "Platform",
    items: [
      { href: "/automation", label: "Automation Studio", icon: "automation", requires: { action: "view", resource: "automation" }, keywords: ["workflows", "rules"] },
      { href: "/integrations", label: "Integrations", icon: "integrations", requires: { action: "view", resource: "integration" }, keywords: ["webhooks", "make", "n8n", "api"] },
      { href: "/analytics", label: "Analytics", icon: "analytics", requires: { action: "view", resource: "analytics" }, keywords: ["reports", "charts"] },
      { href: "/ui-kit", label: "Figma & UI Kit", icon: "uikit", requires: { action: "view", resource: "ui_kit" }, keywords: ["design system", "tokens", "style guide"] },
      { href: "/settings", label: "Settings", icon: "settings", requires: { action: "view", resource: "profile" }, keywords: ["preferences", "team", "organization"] },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

export type SettingsSection = {
  href: string;
  label: string;
  description: string;
  requires: { action: Action; resource: Resource };
};

export const SETTINGS_SECTIONS: SettingsSection[] = [
  { href: "/settings/profile", label: "Profile", description: "Your name and job title.", requires: { action: "update", resource: "profile" } },
  { href: "/settings/organization", label: "Organization", description: "Company name, currency, locale and order conversion mode.", requires: { action: "update", resource: "organization" } },
  { href: "/settings/team", label: "Team", description: "Members, roles and reporting lines.", requires: { action: "view", resource: "team" } },
  { href: "/settings/pipeline", label: "Pipelines", description: "Pipelines and their stages: rename, reorder, probabilities, won and lost.", requires: { action: "manage", resource: "pipeline_stage" } },
  { href: "/settings/fields", label: "Fields", description: "Your own fields on companies, contacts, leads and deals.", requires: { action: "manage", resource: "organization" } },
  { href: "/settings/email-templates", label: "E-mail templates", description: "Ready-made e-mails for writing to customers from record pages.", requires: { action: "manage", resource: "organization" } },
  { href: "/settings/api-keys", label: "API keys", description: "Keys for the public API and the SIEM, with scopes. Shown once, stored hashed.", requires: { action: "view", resource: "api_key" } },
  { href: "/settings/security", label: "Security log", description: "Tamper-evident log of security events, with chain verification.", requires: { action: "view", resource: "audit_log" } },
  { href: "/settings/demo", label: "Demo data", description: "Reset the demo dataset to its seeded state.", requires: { action: "manage", resource: "demo" } },
];

export function visibleNavGroups(actor: Actor): NavGroup[] {
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => can(actor, i.requires.action, i.requires.resource)) })).filter(
    (g) => g.items.length > 0,
  );
}

export function visibleSettingsSections(actor: Actor): SettingsSection[] {
  return SETTINGS_SECTIONS.filter((s) => can(actor, s.requires.action, s.requires.resource));
}

/** Finds the navigation entry that owns a pathname (longest prefix match). */
export function navItemForPath(pathname: string): NavItem | SettingsSection | undefined {
  const candidates = [...SETTINGS_SECTIONS, ...NAV_ITEMS].filter((i) =>
    i.href === "/" ? pathname === "/" : pathname === i.href || pathname.startsWith(`${i.href}/`),
  );
  return candidates.sort((a, b) => b.href.length - a.href.length)[0];
}
