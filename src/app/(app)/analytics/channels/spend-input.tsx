"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { tr } from "@/lib/i18n";
import { setAdSpendAction } from "@/server/actions/channels";

/** The spend cell of a channel: saved on blur or Enter. */
export function SpendInput({ period, channel, value }: { period: string; channel: string; value: number | null }) {
  const router = useRouter();
  const [text, setText] = useState(value === null ? "" : String(value));
  const [pending, start] = useTransition();
  const save = () => {
    const amount = Number(text.replace(/\s/g, "").replace(",", "."));
    if (text.trim() === "" || !Number.isFinite(amount) || amount === value) return;
    start(async () => {
      const r = await setAdSpendAction({ period, channel, amount });
      if (!r.ok) return void toast.error(r.error);
      router.refresh();
    });
  };
  return (
    <Input
      aria-label={tr("Spend for {p0}", { p0: channel })}
      inputMode="decimal"
      className="h-8 w-28 text-right tabular-nums"
      value={text}
      disabled={pending}
      placeholder="—"
      onChange={(e) => setText(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

/** Spend for a channel that has no leads yet this month. */
export function AddSpend({ period }: { period: string }) {
  const router = useRouter();
  const [channel, setChannel] = useState("");
  const [amount, setAmount] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await setAdSpendAction({ period, channel, amount });
          if (!r.ok) return void toast.error(r.error);
          setChannel("");
          setAmount("");
          router.refresh();
        });
      }}
    >
      <Input aria-label={tr("Channel (utm_source)")} placeholder={tr("Channel (utm_source)")} value={channel} onChange={(e) => setChannel(e.target.value)} className="h-8 w-48" />
      <Input aria-label={tr("Spend")} placeholder={tr("Spend")} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-8 w-28" />
      <Button type="submit" size="sm" variant="outline" disabled={pending || !channel.trim() || !amount.trim()}>
        {tr("Add spend")}
      </Button>
    </form>
  );
}
