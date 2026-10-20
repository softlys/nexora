"use client";

import { Clock, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { EXAMPLE_WORKFLOWS } from "@/domain/automation/examples";
import { createFromTemplateAction, createWorkflowAction, runSchedulerAction, setWorkflowEnabledAction } from "@/server/actions/automation";

export function EnabledToggle({ id, name, enabled, disabled }: { id: string; name: string; enabled: boolean; disabled?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useOptimistic(enabled);
  return (
    <Switch
      checked={value}
      disabled={disabled || pending}
      aria-label={`${value ? "Disable" : "Enable"} ${name}`}
      onCheckedChange={(next) =>
        startTransition(async () => {
          setValue(next);
          const result = await setWorkflowEnabledAction({ id, enabled: next });
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success(next ? `${name} enabled` : `${name} disabled`);
          router.refresh();
        })
      }
    />
  );
}

export function RunSchedulerButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await runSchedulerAction({});
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          const r = result.data;
          toast.success("Scheduler ran", { description: `${r.dateEvents} date triggers, ${r.executions} new runs, ${r.resumed} resumed, ${r.webhookRetries} webhook retries${r.heartbeat ? ", heartbeat recorded" : ""}.` });
          router.refresh();
        })
      }
    >
      <Clock aria-hidden />
      {pending ? "Running…" : "Run scheduler"}
    </Button>
  );
}

const BLANK = {
  trigger: { type: "record.created", entity: "lead" },
  steps: [{ id: "log", name: "Log activity", type: "create_activity", activity_type: "note", subject: "New lead: {{lead.title}}", body: "" }],
};

export function NewWorkflowMenu() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const open = (id: string) => router.push(`/automation/${id}?edit=1`);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button disabled={pending}>
          <Plus aria-hidden />
          New workflow
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Start from</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() =>
            startTransition(async () => {
              const result = await createWorkflowAction({ name: "Untitled workflow", description: "", definition: BLANK });
              if (!result.ok || "issues" in result.data) {
                toast.error(result.ok ? "Could not create the workflow" : result.error);
                return;
              }
              open(result.data.id);
            })
          }
        >
          Blank workflow
        </DropdownMenuItem>
        {EXAMPLE_WORKFLOWS.map((t) => (
          <DropdownMenuItem
            key={t.key}
            onSelect={() =>
              startTransition(async () => {
                const result = await createFromTemplateAction({ key: t.key });
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                open(result.data.id);
              })
            }
          >
            <span className="min-w-0">
              <span className="block">{t.name}</span>
              <span className="block truncate text-xs text-text-muted">Template · created disabled</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
