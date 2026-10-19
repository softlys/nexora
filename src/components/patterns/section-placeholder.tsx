import { CircleDashed, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { EmptyState } from "./empty-state";
import { PageHeader } from "./page-header";

/**
 * Honest placeholder for a section whose screens are not built yet:
 * states what the section will hold and what data already exists for it.
 */
export function SectionPlaceholder({
  title,
  description,
  icon,
  emptyTitle,
  emptyDescription,
  planned,
  dataNote,
  children,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  emptyTitle: string;
  emptyDescription: ReactNode;
  planned: string[];
  dataNote?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />
      {children}
      <EmptyState icon={icon} title={emptyTitle} description={emptyDescription}>
        <ul className="space-y-1.5 text-left text-sm text-text-subtle">
          {planned.map((item) => (
            <li key={item} className="flex gap-2">
              <CircleDashed className="mt-0.5 size-4 shrink-0 text-text-muted" aria-hidden />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        {dataNote && <p className="mt-4 text-xs text-text-muted">{dataNote}</p>}
      </EmptyState>
    </div>
  );
}
