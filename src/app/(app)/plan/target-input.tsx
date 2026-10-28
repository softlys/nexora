"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { tr } from "@/lib/i18n";
import { setTargetAction } from "@/server/actions/sales-plan";

/** The plan cell: saved when the field loses focus or Enter is pressed. */
export function TargetInput({ profileId, period, value, name }: { profileId: string; period: string; value: number | null; name: string }) {
  const router = useRouter();
  const [text, setText] = useState(value === null ? "" : String(value));
  const [pending, start] = useTransition();
  const save = () => {
    const amount = Number(text.replace(/\s/g, "").replace(",", "."));
    if (text.trim() === "" || !Number.isFinite(amount) || amount === value) return;
    start(async () => {
      const r = await setTargetAction({ profile_id: profileId, period, amount });
      if (!r.ok) return void toast.error(r.error);
      toast.success(tr("Plan for {p0} saved", { p0: name }));
      router.refresh();
    });
  };
  return (
    <Input
      aria-label={tr("Plan for {p0}", { p0: name })}
      inputMode="decimal"
      className="h-8 w-32 text-right tabular-nums"
      value={text}
      disabled={pending}
      placeholder="—"
      onChange={(e) => setText(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      data-testid={`target-${profileId}`}
    />
  );
}
