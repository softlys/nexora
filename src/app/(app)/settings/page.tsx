import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { visibleSettingsSections } from "@/domain/navigation";
import { getRepoContext } from "@/server/auth";

export const metadata = { title: "Settings" };

export default async function SettingsIndexPage() {
  const { user } = await getRepoContext();
  const sections = visibleSettingsSections(user.actor);
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
      {sections.map((s) => (
        <li key={s.href}>
          <Link href={s.href} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-subtle focus-visible:bg-surface-subtle focus-visible:outline-none">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{s.label}</div>
              <div className="text-sm text-text-muted">{s.description}</div>
            </div>
            <ChevronRight className="size-4 text-text-muted" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}
