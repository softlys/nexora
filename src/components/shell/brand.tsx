import { cn } from "@/lib/utils";
import { tr } from "@/lib/i18n";

/** NEXORA wordmark: a simple geometric mark in the accent color. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("size-8 shrink-0", className)}>
      <defs>
        <linearGradient id="nx-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--nx-color-accent-400)" />
          <stop offset="1" stopColor="var(--nx-color-accent-700)" />
        </linearGradient>
      </defs>
      <rect width="24" height="24" rx="7" fill="url(#nx-mark)" />
      <path d="M7 17V7l10 10V7" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Brand({ orgName, collapsed = false }: { orgName: string; collapsed?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <BrandMark />
      {!collapsed && (
        <div className="min-w-0 leading-tight">
          <div className="text-base font-semibold tracking-tight">{tr("NEXORA")}</div>
          <div className="truncate text-xs text-sidebar-muted">{orgName}</div>
        </div>
      )}
    </div>
  );
}
