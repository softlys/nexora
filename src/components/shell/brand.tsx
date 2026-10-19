import { cn } from "@/lib/utils";

/** NEXORA wordmark: a simple geometric mark in the accent color. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("size-6 shrink-0", className)}>
      <rect width="24" height="24" rx="6" fill="var(--nx-accent)" />
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
          <div className="text-sm font-semibold tracking-tight">NEXORA</div>
          <div className="truncate text-xs text-text-muted">{orgName}</div>
        </div>
      )}
    </div>
  );
}
