"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm, type Resolver } from "react-hook-form";
import { toast } from "sonner";
import { ComboboxField, SelectField, TextareaField, TextField } from "@/components/forms/fields";
import { RecordSheet, useAutoOpen } from "@/components/forms/record-sheet";
import { humanizeStatus } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { TASK_PRIORITIES, TASK_STATUSES, TASK_TYPES, type Task } from "@/domain/entities";
import { taskInput } from "@/domain/inputs";
import { applyServerErrors } from "@/lib/forms";
import { createTaskAction, updateTaskAction } from "@/server/actions/crm";

type Option = { value: string; label: string };

type Values = {
  title: string;
  description: string;
  type: Task["type"];
  assignee_id: string;
  due_date: string;
  due_time: string;
  priority: Task["priority"];
  status: Task["status"];
  company_id: string | null;
  deal_id: string | null;
  order_id: string | null;
  contact_id: string | null;
};

export type TaskFormOptions = { assignees: Option[]; companies: Option[]; deals: Option[]; orders: Option[]; currentUserId: string };

function toDue(date: string, time: string): string | null {
  if (!date) return null;
  return new Date(`${date}T${time || "09:00"}:00`).toISOString();
}

export function TaskFormButton({
  task,
  options,
  defaults: preset,
  label,
  variant = task ? "outline" : "default",
  autoOpen = false,
}: {
  task?: Task;
  options: TaskFormOptions;
  defaults?: Partial<Pick<Values, "company_id" | "deal_id" | "order_id" | "contact_id">>;
  label?: string;
  variant?: "default" | "outline";
  autoOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useAutoOpen(autoOpen);
  const due = task?.due_at ? new Date(task.due_at) : null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const defaults: Values = task
    ? {
        title: task.title,
        description: task.description,
        type: task.type,
        assignee_id: task.assignee_id,
        due_date: due ? `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}` : "",
        due_time: due ? `${pad(due.getHours())}:${pad(due.getMinutes())}` : "",
        priority: task.priority,
        status: task.status,
        company_id: task.company_id,
        deal_id: task.deal_id,
        order_id: task.order_id,
        contact_id: task.contact_id,
      }
    : { title: "", description: "", type: "follow_up", assignee_id: options.currentUserId, due_date: "", due_time: "", priority: "medium", status: "todo", company_id: null, deal_id: null, order_id: null, contact_id: null, ...preset };

  const base = zodResolver(taskInput) as unknown as Resolver<Record<string, unknown>>;
  const resolver: Resolver<Values> = async (values, ctx, opts) => {
    const { due_date, due_time, ...rest } = values;
    const result = await base({ ...rest, due_at: toDue(due_date, due_time) }, ctx, opts as never);
    return result as unknown as Awaited<ReturnType<Resolver<Values>>>;
  };
  const { control, handleSubmit, formState, setError, reset } = useForm<Values>({ resolver, defaultValues: defaults });

  const onSubmit = handleSubmit(async (values) => {
    const { due_date, due_time, ...rest } = values;
    const payload = { ...rest, due_at: toDue(due_date, due_time) };
    const result = task ? await updateTaskAction({ id: task.id, ...payload }) : await createTaskAction(payload);
    if (!result.ok) return applyServerErrors(result, setError);
    toast.success(task ? "Task updated" : "Task created");
    reset(values);
    setOpen(false);
    router.refresh();
  });

  return (
    <>
      <Button
        variant={variant}
        onClick={() => {
          reset(defaults);
          setOpen(true);
        }}
      >
        {task ? <Pencil aria-hidden /> : <Plus aria-hidden />}
        {label ?? (task ? "Edit" : "New task")}
      </Button>
      <RecordSheet open={open} onOpenChange={setOpen} title={task ? "Edit task" : "New task"} dirty={formState.isDirty} submitting={formState.isSubmitting} onSubmit={onSubmit} submitLabel={task ? "Save changes" : "Create task"}>
        <TextField control={control} name="title" label="Title" />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField control={control} name="type" label="Type" options={TASK_TYPES.map((t) => ({ value: t, label: humanizeStatus(t) }))} />
          <SelectField control={control} name="priority" label="Priority" options={TASK_PRIORITIES.map((t) => ({ value: t, label: humanizeStatus(t) }))} />
          <TextField control={control} name="due_date" label="Due date" type="date" />
          <TextField control={control} name="due_time" label="Due time" type="time" />
          <SelectField control={control} name="status" label="Status" options={TASK_STATUSES.map((t) => ({ value: t, label: humanizeStatus(t) }))} />
          <SelectField
            control={control}
            name="assignee_id"
            label="Assignee"
            options={options.assignees.length > 0 ? options.assignees : [{ value: options.currentUserId, label: "Me" }]}
            hint={options.assignees.length === 0 ? "Sales reps assign tasks to themselves." : undefined}
          />
        </div>
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Related to</legend>
          <ComboboxField control={control} name="company_id" label="Company" options={options.companies} placeholder="None" />
          <ComboboxField control={control} name="deal_id" label="Deal" options={options.deals} placeholder="None" />
          <ComboboxField control={control} name="order_id" label="Order" options={options.orders} placeholder="None" />
        </fieldset>
        <TextareaField control={control} name="description" label="Description" />
      </RecordSheet>
    </>
  );
}
