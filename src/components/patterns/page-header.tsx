import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { trNode } from "@/lib/i18n";

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0 space-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{trNode(title)}</h1>
        {description && <p className="max-w-2xl text-sm text-text-muted">{trNode(description)}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
