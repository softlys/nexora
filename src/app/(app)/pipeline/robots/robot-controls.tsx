"use client";

import { Bot, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { FormField } from "@/components/patterns/form-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { tr } from "@/lib/i18n";
import { createRobotAction, removeRobotAction, setRobotEnabledAction } from "@/server/actions/robots";

type Kind = "task" | "notify" | "email_owner" | "whatsapp" | "telegram" | "probability";
const KINDS: Array<[Kind, string, string]> = [
  ["task", "Create a task", "A task for the deal owner, due in a few business days."],
  ["notify", "Notify", "A notification in NEXORA for the owner, managers or admins."],
  ["email_owner", "E-mail the deal owner", "Needs the e-mail provider."],
  ["whatsapp", "WhatsApp to the customer", "To the primary contact's number; needs WhatsApp Business."],
  ["telegram", "Message the team in Telegram", "To the team chat of the Telegram bot."],
  ["probability", "Set the probability", "Changes the deal's probability."],
];
const TEXT_LABEL: Partial<Record<Kind, string>> = { task: "Task title", notify: "Notification title", email_owner: "Subject", whatsapp: "Message", telegram: "Message" };

function Choice({ id, label, value, options, onChange }: { id: string; label: string; value: string; options: Array<[string, string]>; onChange: (v: string) => void }) {
  return (
    <FormField id={id} label={label}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([v, l]) => (
            <SelectItem key={v} value={v}>
              {l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  );
}

/** "+ Robot" on a stage column. */
export function AddRobotButton({ stageId, stageName }: { stageId: string; stageName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("task");
  const [text, setText] = useState("");
  const [dueDays, setDueDays] = useState("1");
  const [taskType, setTaskType] = useState("call");
  const [recipients, setRecipients] = useState("record_owner");
  const [probability, setProbability] = useState("50");
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const r = await createRobotAction({ stage_id: stageId, kind, text, due_days: dueDays, task_type: taskType, recipients, probability });
      if (!r.ok) return void toast.error(r.error);
      toast.success(tr("Robot added to {p0}", { p0: stageName }));
      setOpen(false);
      router.refresh();
    });
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="w-full justify-start"
        data-testid={`add-robot-${stageId}`}
        onClick={() => {
          setKind("task");
          setText("");
          setOpen(true);
        }}
      >
        <Plus aria-hidden />
        {tr("Robot")}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{tr("New robot: {p0}", { p0: stageName })}</DialogTitle>
            <DialogDescription>{tr("Runs every time a deal enters this stage.")}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={tr("Action")}>
              {KINDS.map(([k, label, hint]) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={kind === k}
                  onClick={() => setKind(k)}
                  className={`rounded-md border p-2 text-left text-sm ${kind === k ? "border-brand bg-brand/5" : "border-border hover:bg-surface-subtle"}`}
                >
                  <span className="block font-medium">{tr(label)}</span>
                  <span className="block text-xs text-text-muted">{tr(hint)}</span>
                </button>
              ))}
            </div>
            {TEXT_LABEL[kind] && (
              <FormField id="robot-text" label={tr(TEXT_LABEL[kind]!)} hint={tr("Optional. Variables such as {{deal.name}}, {{deal.company_name}}, {{deal.amount}} and {{deal.stage}} are filled in.")}>
                {kind === "whatsapp" || kind === "telegram" ? <Textarea id="robot-text" value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={1000} /> : <Input id="robot-text" value={text} onChange={(e) => setText(e.target.value)} maxLength={200} />}
              </FormField>
            )}
            {kind === "task" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Choice id="robot-task-type" label={tr("Task type")} value={taskType} onChange={setTaskType} options={[["call", tr("Call")], ["email", tr("Email")], ["meeting", tr("Meeting")], ["follow_up", tr("Follow-up")], ["todo", tr("To-do")]]} />
                <FormField id="robot-due" label={tr("Due in business days")}>
                  <Input id="robot-due" inputMode="numeric" value={dueDays} onChange={(e) => setDueDays(e.target.value)} />
                </FormField>
              </div>
            )}
            {kind === "notify" && <Choice id="robot-recipients" label={tr("Who")} value={recipients} onChange={setRecipients} options={[["record_owner", tr("Deal owner")], ["managers", tr("Managers")], ["admins", tr("Admins")]]} />}
            {kind === "probability" && (
              <FormField id="robot-probability" label={tr("Probability, %")}>
                <Input id="robot-probability" inputMode="numeric" value={probability} onChange={(e) => setProbability(e.target.value)} />
              </FormField>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                {tr("Cancel")}
              </Button>
              <Button type="submit" disabled={pending} data-testid="save-robot">
                <Bot aria-hidden />
                {pending ? tr("Saving…") : tr("Add robot")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function RobotCard({ robot, canManage }: { robot: { id: string; name: string; enabled: boolean; summary: string; runs: number; failed: number }; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="space-y-1.5 rounded-md border border-border bg-surface p-2.5 text-sm" data-testid="robot">
      <div className="flex items-start justify-between gap-2">
        <Link href={`/automation/${robot.id}`} className="font-medium hover:underline">
          {robot.name}
        </Link>
        {canManage && (
          <Switch
            aria-label={tr("Robot on")}
            checked={robot.enabled}
            disabled={pending}
            onCheckedChange={(enabled) =>
              start(async () => {
                const r = await setRobotEnabledAction({ id: robot.id, enabled });
                if (!r.ok) toast.error(r.error);
                router.refresh();
              })
            }
          />
        )}
      </div>
      {robot.summary && <p className="line-clamp-2 text-xs text-text-muted">{robot.summary}</p>}
      <div className="flex items-center justify-between text-[11px] text-text-muted">
        <span>
          {tr("Runs: {p0}", { p0: robot.runs })}
          {robot.failed > 0 && <span className="text-danger"> · {tr("failed: {p0}", { p0: robot.failed })}</span>}
        </span>
        {canManage && (
          <ConfirmDialog
            trigger={
              <Button size="icon-sm" variant="ghost" aria-label={tr("Remove {p0}", { p0: robot.name })}>
                <Trash2 aria-hidden />
              </Button>
            }
            title={tr("Remove the robot?")}
            description={tr("Its run history stays in Automation Studio.")}
            confirmLabel={tr("Remove")}
            destructive
            onConfirm={async () => {
              const r = await removeRobotAction({ id: robot.id });
              if (!r.ok) {
                toast.error(r.error);
                return false;
              }
              router.refresh();
            }}
          />
        )}
      </div>
    </div>
  );
}
