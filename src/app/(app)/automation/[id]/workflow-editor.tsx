"use client";

import { ArrowDown, ArrowUp, CircleAlert, FlaskConical, GitBranch, Play, Plus, Save, Trash2, Undo2, Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { useUnsavedChangesWarning } from "@/components/forms/record-sheet";
import { Combobox } from "@/components/patterns/combobox";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { FormField } from "@/components/patterns/form-field";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { validateDefinition } from "@/domain/automation/logic";
import {
  CONDITION_OPS,
  RECIPIENTS,
  STEP_LABELS,
  STEP_TYPES,
  TRIGGER_ENTITIES,
  TRIGGER_LABELS,
  TRIGGER_TYPES,
  UPDATE_ALLOWLIST,
  variablesFor,
  type StepType,
  type TriggerEntity,
} from "@/domain/automation/schema";
import { COUNTRY_OPTIONS } from "@/lib/countries";
import { cn } from "@/lib/utils";
import { archiveWorkflowAction, testRunAction, updateWorkflowAction } from "@/server/actions/automation";
import { EnabledToggle } from "../studio-controls";

type Json = Record<string, unknown>;
type StepJson = Json & { id: string; type: StepType; name?: string; next?: string };
type Definition = { trigger: Json & { type: string; entity: TriggerEntity }; steps: StepJson[] };
type Option = { value: string; label: string };

const STEP_DEFAULTS: Record<StepType, Json> = {
  condition: { match: "all", conditions: [{ field: "", op: "eq", value: "" }], then: "end", else: "end" },
  assign_owner: { rule: "round_robin", only_if_unassigned: true, country_map: {} },
  create_task: { title: "Follow up", task_type: "follow_up", priority: "medium", due_in_business_days: 1, assignee: "record_owner" },
  update_record: { fields: {} },
  create_activity: { activity_type: "note", subject: "Automation note", body: "" },
  create_notification: { recipients: ["record_owner"], title: "Update", body: "", link: "record", once_per_record: true },
  convert_deal_to_order: {},
  send_email: { to: "record_owner", subject: "Update", body: "" },
  send_telegram: { text: "New lead: {{lead.title}} ({{lead.company_name}})" },
  send_webhook: { event_type: "custom.event" },
  delay: { hours: 24 },
};

export function WorkflowEditor({
  workflow,
  canEdit,
  canManage,
  reps,
  testRecords,
  startEditing,
}: {
  workflow: { id: string; name: string; description: string; enabled: boolean; version: number; definition: Json };
  canEdit: boolean;
  canManage: boolean;
  reps: Option[];
  testRecords: Option[];
  startEditing: boolean;
}) {
  const router = useRouter();
  const initial = useMemo(() => structuredClone(workflow.definition) as unknown as Definition, [workflow.definition]);
  const [name, setName] = useState(workflow.name);
  const [description, setDescription] = useState(workflow.description);
  const [def, setDef] = useState<Definition>(initial);
  const [selected, setSelected] = useState<string>("trigger");
  const [editing, setEditing] = useState(startEditing && canEdit);
  const [serverIssues, setServerIssues] = useState<Array<{ path: string; message: string }>>([]);
  const [testRecord, setTestRecord] = useState<string | null>(testRecords[0]?.value ?? null);
  const [pending, startTransition] = useTransition();

  const dirty = editing && (name !== workflow.name || description !== workflow.description || JSON.stringify(def) !== JSON.stringify(initial));
  useUnsavedChangesWarning(dirty);
  const validation = validateDefinition(def);
  const issues = validation.ok ? serverIssues : validation.issues;
  const issuesFor = (prefix: string) => issues.filter((i) => i.path === prefix || i.path.startsWith(`${prefix}.`));
  const entity = def.trigger.entity;
  const vars = variablesFor(entity);
  const stepIds = def.steps.map((s) => s.id);

  const updateStep = (id: string, patch: Json) => setDef((d) => ({ ...d, steps: d.steps.map((s) => (s.id === id ? ({ ...s, ...patch } as StepJson) : s)) }));
  // Keys set to undefined are removed so the strict trigger schema sees only relevant fields.
  const setTrigger = (patch: Json) =>
    setDef((d) => ({ ...d, trigger: Object.fromEntries(Object.entries({ ...d.trigger, ...patch }).filter(([, v]) => v !== undefined)) as Definition["trigger"] }));
  const addStep = (type: StepType) => {
    let n = def.steps.length + 1;
    while (stepIds.includes(`step-${n}`)) n++;
    const step = { id: `step-${n}`, name: STEP_LABELS[type], type, ...STEP_DEFAULTS[type] } as StepJson;
    setDef((d) => ({ ...d, steps: [...d.steps, step] }));
    setSelected(step.id);
  };
  const removeStep = (id: string) => {
    setDef((d) => ({ ...d, steps: d.steps.filter((s) => s.id !== id) }));
    setSelected("trigger");
  };
  const moveStep = (id: string, delta: -1 | 1) =>
    setDef((d) => {
      const i = d.steps.findIndex((s) => s.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= d.steps.length) return d;
      const steps = [...d.steps];
      [steps[i], steps[j]] = [steps[j]!, steps[i]!];
      return { ...d, steps };
    });

  const save = () =>
    startTransition(async () => {
      const result = await updateWorkflowAction({ id: workflow.id, name, description, definition: def });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if ("issues" in result.data) {
        setServerIssues(result.data.issues);
        toast.error("The workflow has validation errors");
        return;
      }
      setServerIssues([]);
      toast.success(`Saved as version ${result.data.version}`);
      setEditing(false);
      router.refresh();
    });

  const testRun = () =>
    startTransition(async () => {
      const result = await testRunAction({ id: workflow.id, record_id: testRecord });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const statusText = result.data.status === "failed" ? `failed: ${result.data.error}` : result.data.status;
      toast.success(`Test run ${statusText}`, { description: "No records were changed. Details are in the run history." });
      router.refresh();
    });

  const selectedStep = def.steps.find((s) => s.id === selected);
  const targetOptions = (fromIndex: number): Option[] => [...def.steps.slice(fromIndex + 1).map((s) => ({ value: s.id, label: s.name || s.id })), { value: "end", label: "End the run" }];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="flex items-center gap-2">
            <EnabledToggle id={workflow.id} name={workflow.name} enabled={workflow.enabled} disabled={!canManage || dirty} />
            {workflow.enabled ? "Enabled" : "Disabled"}
          </span>
          <span className="text-text-muted">Version {workflow.version}</span>
          {!validation.ok && <StatusBadge status="failed" label={`${validation.issues.length} issue${validation.issues.length === 1 ? "" : "s"}`} />}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && !editing && (
            <Button variant="outline" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
          {editing && (
            <>
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setDef(initial);
                  setName(workflow.name);
                  setDescription(workflow.description);
                  setServerIssues([]);
                  setEditing(false);
                }}
              >
                <Undo2 aria-hidden />
                Discard
              </Button>
              <Button onClick={save} disabled={pending || !dirty || !validation.ok}>
                <Save aria-hidden />
                {pending ? "Saving…" : "Save new version"}
              </Button>
            </>
          )}
          {canEdit && !dirty && (
            <div className="flex items-center gap-2">
              {testRecords.length > 0 && (
                <div className="w-56">
                  <Combobox options={testRecords} value={testRecord} onChange={setTestRecord} placeholder="Sample record" />
                </div>
              )}
              <Button variant="outline" onClick={testRun} disabled={pending || !validation.ok}>
                <FlaskConical aria-hidden />
                Test run
              </Button>
            </div>
          )}
          {canManage && !editing && (
            <ConfirmDialog
              trigger={
                <Button variant="ghost" size="icon" aria-label="Archive workflow">
                  <Trash2 aria-hidden />
                </Button>
              }
              title="Archive this workflow?"
              description="It stops running and disappears from the list. Its run history is kept."
              confirmLabel="Archive"
              destructive
              onConfirm={async () => {
                const result = await archiveWorkflowAction({ id: workflow.id });
                if (!result.ok) {
                  toast.error(result.error);
                  return false;
                }
                toast.success("Workflow archived");
                router.push("/automation");
              }}
            />
          )}
        </div>
      </div>

      {editing && (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="wf-name" label="Name">
            <Input id="wf-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          </FormField>
          <FormField id="wf-desc" label="Description">
            <Input id="wf-desc" value={description} maxLength={1000} onChange={(e) => setDescription(e.target.value)} />
          </FormField>
        </div>
      )}

      {issues.length > 0 && (
        <div role="alert" className="rounded-md border border-danger-border bg-danger-bg p-3 text-sm text-danger">
          <p className="mb-1 flex items-center gap-1.5 font-medium">
            <CircleAlert className="size-4" aria-hidden />
            Fix these before saving or enabling
          </p>
          <ul className="list-disc space-y-0.5 pl-5">
            {issues.slice(0, 8).map((i, idx) => (
              <li key={idx}>
                <span className="font-mono text-xs">{i.path}</span>: {i.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        {/* Flow view */}
        <section aria-label="Workflow steps" className="space-y-0 lg:col-span-2">
          <FlowNode
            icon={<Zap className="size-4" aria-hidden />}
            title={TRIGGER_LABELS[def.trigger.type as keyof typeof TRIGGER_LABELS] ?? def.trigger.type}
            subtitle={`on ${def.trigger.entity}`}
            selected={selected === "trigger"}
            invalid={issuesFor("trigger").length > 0}
            onSelect={() => setSelected("trigger")}
            kind="trigger"
          />
          {def.steps.map((step, index) => {
            const following = def.steps[index + 1]?.id;
            const branches =
              step.type === "condition"
                ? [
                    { label: "Yes", to: String(step.then) },
                    { label: "No", to: String(step.else) },
                  ]
                : step.next && step.next !== following
                  ? [{ label: "Then", to: step.next }]
                  : [];
            const nameOf = (id: string) => (id === "end" ? "End" : (def.steps.find((s) => s.id === id)?.name ?? id));
            return (
              <div key={step.id}>
                <Connector />
                <FlowNode
                  icon={step.type === "condition" ? <GitBranch className="size-4" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
                  title={step.name || STEP_LABELS[step.type]}
                  subtitle={STEP_LABELS[step.type]}
                  selected={selected === step.id}
                  invalid={issuesFor(`steps.${index}`).length > 0}
                  onSelect={() => setSelected(step.id)}
                  kind={step.type === "condition" ? "condition" : "step"}
                  branches={branches.map((b) => ({ label: b.label, to: nameOf(b.to) }))}
                  controls={
                    editing ? (
                      <span className="flex">
                        <Button variant="ghost" size="icon-xs" aria-label={`Move ${step.name || step.id} up`} disabled={index === 0} onClick={() => moveStep(step.id, -1)}>
                          <ArrowUp aria-hidden />
                        </Button>
                        <Button variant="ghost" size="icon-xs" aria-label={`Move ${step.name || step.id} down`} disabled={index === def.steps.length - 1} onClick={() => moveStep(step.id, 1)}>
                          <ArrowDown aria-hidden />
                        </Button>
                        <Button variant="ghost" size="icon-xs" aria-label={`Remove ${step.name || step.id}`} disabled={def.steps.length === 1} onClick={() => removeStep(step.id)}>
                          <Trash2 aria-hidden />
                        </Button>
                      </span>
                    ) : null
                  }
                />
              </div>
            );
          })}
          {editing && def.steps.length < 20 && (
            <>
              <Connector />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full border-dashed">
                    <Plus aria-hidden />
                    Add step
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56">
                  {STEP_TYPES.map((t) => (
                    <DropdownMenuItem key={t} onSelect={() => addStep(t)}>
                      {STEP_LABELS[t]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </section>

        {/* Configuration panel */}
        <section aria-label="Step configuration" className="rounded-lg border border-border bg-surface p-4 lg:col-span-3">
          <fieldset disabled={!editing} className="space-y-4">
            {selected === "trigger" ? (
              <TriggerPanel trigger={def.trigger} onChange={setTrigger} />
            ) : selectedStep ? (
              <StepPanel
                step={selectedStep}
                entity={entity}
                vars={vars}
                reps={reps}
                targets={targetOptions(def.steps.indexOf(selectedStep))}
                onChange={(patch) => updateStep(selectedStep.id, patch)}
              />
            ) : (
              <p className="text-sm text-text-muted">Select a step.</p>
            )}
            {!editing && canEdit && <p className="text-xs text-text-muted">Click Edit to change this workflow. Saving creates a new version.</p>}
          </fieldset>
          <details className="mt-5 text-xs text-text-muted">
            <summary className="cursor-pointer">Variables available in text fields</summary>
            <p className="mt-2 flex flex-wrap gap-1">
              {vars.map((v) => (
                <code key={v} className="rounded bg-surface-muted px-1 py-0.5 font-mono">{`{{${v}}}`}</code>
              ))}
            </p>
          </details>
        </section>
      </div>
    </div>
  );
}

function Connector() {
  return <div aria-hidden className="mx-auto h-4 w-px bg-border-strong" />;
}

function FlowNode({
  icon,
  title,
  subtitle,
  selected,
  invalid,
  onSelect,
  kind,
  branches = [],
  controls,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  selected: boolean;
  invalid: boolean;
  onSelect: () => void;
  kind: "trigger" | "condition" | "step";
  branches?: Array<{ label: string; to: string }>;
  controls?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border bg-surface p-2.5 shadow-xs transition-colors",
        selected ? "border-brand ring-2 ring-brand/20" : "border-border",
        invalid && "border-danger",
      )}
    >
      <button type="button" onClick={onSelect} aria-pressed={selected} className="flex min-w-0 flex-1 items-start gap-2.5 text-left focus-visible:outline-none">
        <span
          className={cn(
            "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md",
            kind === "trigger" ? "bg-brand text-brand-foreground" : kind === "condition" ? "bg-warning-bg text-warning" : "bg-surface-muted text-text-subtle",
          )}
        >
          {icon}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{title}</span>
          <span className="block truncate text-xs text-text-muted">{subtitle}</span>
          {branches.length > 0 && (
            <span className="mt-1 flex flex-wrap gap-1">
              {branches.map((b) => (
                <span key={b.label} className="rounded border border-border px-1.5 text-[11px] text-text-subtle">
                  {b.label} → {b.to}
                </span>
              ))}
            </span>
          )}
        </span>
        {invalid && <CircleAlert className="ml-auto size-4 shrink-0 text-danger" aria-label="Has issues" />}
      </button>
      {controls}
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  const id = `f-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <FormField id={id} label={label} hint={hint}>
      {children}
    </FormField>
  );
}

function SelectBox({ value, options, onChange, label }: { value: string; options: Option[]; onChange: (v: string) => void; label: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const opt = (values: readonly string[]) => values.map((v) => ({ value: v, label: v.replace(/_/g, " ") }));

function TriggerPanel({ trigger, onChange }: { trigger: Definition["trigger"]; onChange: (patch: Json) => void }) {
  const type = trigger.type;
  return (
    <div className="space-y-4">
      <h2 className="text-md font-semibold">Trigger</h2>
      <Field label="When">
        <SelectBox
          label="Trigger type"
          value={type}
          options={TRIGGER_TYPES.map((t) => ({ value: t, label: TRIGGER_LABELS[t] }))}
          onChange={(t) => {
            if (t === "deal.stage_changed") onChange({ type: t, entity: "deal", to: "won", fields: undefined, task_type: undefined, field: undefined, event_type: undefined });
            else if (t === "date.reached") onChange({ type: t, entity: "task", field: "due_at", task_type: "any", to: undefined, fields: undefined, event_type: undefined });
            else if (t === "webhook.received") onChange({ type: t, event_type: "external.event", to: undefined, fields: undefined, task_type: undefined, field: undefined });
            else if (t === "record.updated") onChange({ type: t, fields: [], to: undefined, task_type: undefined, field: undefined, event_type: undefined });
            else onChange({ type: t, to: undefined, fields: undefined, task_type: undefined, field: undefined, event_type: undefined });
          }}
        />
      </Field>
      {(type === "record.created" || type === "record.updated" || type === "webhook.received") && (
        <Field label="Record type">
          <SelectBox label="Record type" value={trigger.entity} options={opt(TRIGGER_ENTITIES)} onChange={(v) => onChange({ entity: v })} />
        </Field>
      )}
      {type === "record.updated" && (
        <Field label="Only when these fields change" hint="Comma-separated field names; empty means any change.">
          <Input value={((trigger.fields as string[]) ?? []).join(", ")} onChange={(e) => onChange({ fields: e.target.value.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 10) })} />
        </Field>
      )}
      {type === "deal.stage_changed" && (
        <Field label="Moved to">
          <SelectBox label="Moved to" value={String(trigger.to)} options={[{ value: "won", label: "A won stage" }, { value: "lost", label: "A lost stage" }, { value: "any", label: "Any stage" }]} onChange={(v) => onChange({ to: v })} />
        </Field>
      )}
      {type === "date.reached" && (
        <Field label="Task type" hint="Fires once per task when its due date passes (checked by the scheduler).">
          <SelectBox label="Task type" value={String(trigger.task_type ?? "any")} options={opt(["any", "follow_up", "call", "email", "meeting", "todo"])} onChange={(v) => onChange({ task_type: v })} />
        </Field>
      )}
      {type === "webhook.received" && (
        <Field label="Event type" hint="Inbound events arrive through the API (phase 4).">
          <Input value={String(trigger.event_type ?? "")} onChange={(e) => onChange({ event_type: e.target.value })} />
        </Field>
      )}
    </div>
  );
}

function StepPanel({
  step,
  entity,
  vars,
  reps,
  targets,
  onChange,
}: {
  step: StepJson;
  entity: TriggerEntity;
  vars: string[];
  reps: Option[];
  targets: Option[];
  onChange: (patch: Json) => void;
}) {
  const text = (key: string, label: string, multiline = false, hint?: string) => (
    <Field label={label} hint={hint}>
      {multiline ? (
        <Textarea rows={3} value={String(step[key] ?? "")} onChange={(e) => onChange({ [key]: e.target.value })} />
      ) : (
        <Input value={String(step[key] ?? "")} onChange={(e) => onChange({ [key]: e.target.value })} />
      )}
    </Field>
  );
  const select = (key: string, label: string, options: Option[]) => (
    <Field label={label}>
      <SelectBox label={label} value={String(step[key] ?? "")} options={options} onChange={(v) => onChange({ [key]: v })} />
    </Field>
  );
  const nextOptions = [{ value: "__default", label: "Following step" }, ...targets];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-md font-semibold">{STEP_LABELS[step.type]}</h2>
        <code className="text-xs text-text-muted">{step.id}</code>
      </div>
      {text("name", "Step name")}

      {step.type === "condition" && (
        <>
          {select("match", "Match", [{ value: "all", label: "All conditions" }, { value: "any", label: "Any condition" }])}
          <div className="space-y-2">
            {((step.conditions as Json[]) ?? []).map((c, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2">
                <SelectBox label={`Condition ${i + 1} field`} value={String(c.field ?? "")} options={vars.map((v) => ({ value: v, label: v }))} onChange={(v) => onChange({ conditions: (step.conditions as Json[]).map((x, j) => (j === i ? { ...x, field: v } : x)) })} />
                <SelectBox label={`Condition ${i + 1} operator`} value={String(c.op ?? "eq")} options={opt(CONDITION_OPS)} onChange={(v) => onChange({ conditions: (step.conditions as Json[]).map((x, j) => (j === i ? { ...x, op: v } : x)) })} />
                <Input
                  aria-label={`Condition ${i + 1} value`}
                  value={Array.isArray(c.value) ? (c.value as string[]).join(", ") : String(c.value ?? "")}
                  disabled={c.op === "is_empty" || c.op === "not_empty"}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const value = c.op === "in" ? raw.split(",").map((s) => s.trim()).filter(Boolean) : ["gt", "gte", "lt", "lte"].includes(String(c.op)) && raw !== "" && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
                    onChange({ conditions: (step.conditions as Json[]).map((x, j) => (j === i ? { ...x, value } : x)) });
                  }}
                />
                <Button variant="ghost" size="icon-sm" aria-label={`Remove condition ${i + 1}`} disabled={(step.conditions as Json[]).length === 1} onClick={() => onChange({ conditions: (step.conditions as Json[]).filter((_, j) => j !== i) })}>
                  <Trash2 aria-hidden />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => onChange({ conditions: [...((step.conditions as Json[]) ?? []), { field: vars[0], op: "eq", value: "" }] })}>
              <Plus aria-hidden />
              Add condition
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {select("then", "If yes, go to", targets)}
            {select("else", "If no, go to", targets)}
          </div>
        </>
      )}

      {step.type === "assign_owner" && (
        <>
          {select("rule", "Rule", [{ value: "by_country", label: "By country, otherwise round robin" }, { value: "round_robin", label: "Round robin among sales reps" }])}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={Boolean(step.only_if_unassigned)} onCheckedChange={(v) => onChange({ only_if_unassigned: v === true })} />
            Only when the lead has no owner
          </label>
          {step.rule === "by_country" && (
            <div className="space-y-2">
              <p className="text-xs text-text-muted">Country map</p>
              {Object.entries((step.country_map as Record<string, string>) ?? {}).map(([cc, rep]) => (
                <div key={cc} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                  <Input value={cc} readOnly aria-label="Country code" />
                  <SelectBox label={`Rep for ${cc}`} value={rep} options={reps} onChange={(v) => onChange({ country_map: { ...(step.country_map as Json), [cc]: v } })} />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${cc}`}
                    onClick={() => {
                      const next = { ...(step.country_map as Record<string, string>) };
                      delete next[cc];
                      onChange({ country_map: next });
                    }}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              ))}
              {reps.length > 0 && (
                <Combobox
                  options={COUNTRY_OPTIONS.filter((c) => !((step.country_map as Json) ?? {})[c.value])}
                  value={null}
                  onChange={(cc) => cc && onChange({ country_map: { ...(step.country_map as Json), [cc]: reps[0]!.value } })}
                  placeholder="Add a country…"
                />
              )}
            </div>
          )}
        </>
      )}

      {step.type === "create_task" && (
        <>
          {text("title", "Task title")}
          <div className="grid gap-4 sm:grid-cols-2">
            {select("task_type", "Type", opt(["follow_up", "call", "email", "meeting", "todo"]))}
            {select("priority", "Priority", opt(["low", "medium", "high", "urgent"]))}
            <Field label="Due in business days">
              <Input inputMode="numeric" value={String(step.due_in_business_days ?? 1)} onChange={(e) => onChange({ due_in_business_days: Number(e.target.value.replace(/\D/g, "") || 0) })} />
            </Field>
            {select("assignee", "Assign to", entity === "task" ? opt(["record_owner", "assignee"]) : [{ value: "record_owner", label: "Record owner" }])}
          </div>
        </>
      )}

      {step.type === "update_record" && (
        <div className="space-y-2">
          {UPDATE_ALLOWLIST[entity] ? (
            Object.keys(UPDATE_ALLOWLIST[entity]!).map((field) => {
              const fields = (step.fields as Json) ?? {};
              const on = field in fields;
              return (
                <div key={field} className="grid grid-cols-[auto_1fr] items-center gap-3">
                  <label className="flex w-40 items-center gap-2 text-sm">
                    <Checkbox
                      checked={on}
                      onCheckedChange={(v) => {
                        const next = { ...fields };
                        if (v === true) next[field] = field === "probability" ? 50 : "";
                        else delete next[field];
                        onChange({ fields: next });
                      }}
                    />
                    {field.replace(/_/g, " ")}
                  </label>
                  <Input
                    aria-label={`Value for ${field}`}
                    disabled={!on}
                    value={on ? String(fields[field] ?? "") : ""}
                    onChange={(e) => onChange({ fields: { ...fields, [field]: field === "probability" ? Number(e.target.value || 0) : e.target.value } })}
                  />
                </div>
              );
            })
          ) : (
            <p className="text-sm text-text-muted">Automations cannot update {entity} records.</p>
          )}
          <p className="text-xs text-text-muted">Only these fields can be changed by automations. Roles, owners, API keys and integration settings never can.</p>
        </div>
      )}

      {step.type === "create_activity" && (
        <>
          {select("activity_type", "Activity type", opt(["note", "call", "meeting", "email", "follow_up", "system"]))}
          {text("subject", "Subject")}
          {text("body", "Details", true)}
        </>
      )}

      {step.type === "create_notification" && (
        <>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Recipients</legend>
            {RECIPIENTS.filter((r) => r !== "assignee" || entity === "task").map((r) => {
              const list = (step.recipients as string[]) ?? [];
              return (
                <label key={r} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={list.includes(r)} onCheckedChange={(v) => onChange({ recipients: v === true ? [...list, r] : list.filter((x) => x !== r) })} />
                  {r.replace(/_/g, " ")}
                </label>
              );
            })}
          </fieldset>
          {text("title", "Title")}
          {text("body", "Message", true)}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={Boolean(step.once_per_record)} onCheckedChange={(v) => onChange({ once_per_record: v === true })} />
            Notify each person only once per record
          </label>
        </>
      )}

      {step.type === "convert_deal_to_order" && (
        <p className="text-sm text-text-muted">Creates the order for the deal using the organization&apos;s conversion mode (draft or confirmed). If an order already exists for the deal, it is reused.</p>
      )}

      {step.type === "send_email" && (
        <>
          {select("to", "To", entity === "task" ? opt(["record_owner", "assignee"]) : [{ value: "record_owner", label: "Record owner" }])}
          {text("subject", "Subject")}
          {text("body", "Body", true)}
          <p className="text-xs text-text-muted">Sent only when an email provider is configured; otherwise the step is logged as skipped.</p>
        </>
      )}

      {step.type === "send_telegram" && (
        <>
          {text("text", "Message", true)}
          <p className="text-xs text-text-muted">Plain text to the team chat set in Integrations → Telegram. Placeholders like {"{{lead.title}}"} are filled in. Without a configured bot the step is logged as skipped.</p>
        </>
      )}

      {step.type === "send_webhook" && (
        <>
          {text("event_type", "Event type")}
          <p className="text-xs text-text-muted">Delivered as workflow.webhook to every enabled integration that subscribes to it (Make, n8n, generic webhook).</p>
        </>
      )}

      {step.type === "delay" && (
        <Field label="Wait (hours)" hint="Up to 30 days. The scheduler continues the run afterwards.">
          <Input inputMode="numeric" value={String(step.hours ?? 1)} onChange={(e) => onChange({ hours: Number(e.target.value.replace(/\D/g, "") || 1) })} />
        </Field>
      )}

      {step.type !== "condition" && (
        <Field label="Then go to">
          <SelectBox label="Then go to" value={step.next ? String(step.next) : "__default"} options={nextOptions} onChange={(v) => onChange({ next: v === "__default" ? undefined : v })} />
        </Field>
      )}
    </div>
  );
}
