"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** Tabs whose active tab is kept in ?tab= so links and reloads open the same view. */
export function RecordTabs({ tabs, defaultTab }: { tabs: Array<{ id: string; label: string; count?: number; content: ReactNode }>; defaultTab: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const current = tabs.some((t) => t.id === params.get("tab")) ? params.get("tab")! : defaultTab;
  return (
    <Tabs
      value={current}
      onValueChange={(value) => {
        const sp = new URLSearchParams(params.toString());
        if (value === defaultTab) sp.delete("tab");
        else sp.set("tab", value);
        router.replace(sp.size ? `${pathname}?${sp}` : pathname, { scroll: false });
      }}
    >
      <TabsList className="max-w-full overflow-x-auto overflow-y-hidden">
        {tabs.map((t) => (
          <TabsTrigger key={t.id} value={t.id}>
            {t.label}
            {t.count !== undefined && <span className="ml-1 text-xs text-text-muted tabular-nums">{t.count}</span>}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((t) => (
        <TabsContent key={t.id} value={t.id} className="mt-4">
          {t.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
