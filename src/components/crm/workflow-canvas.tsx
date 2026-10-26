import { Bell, FileText, GitBranch, Hash, ListTodo, Mail, MessageCircle, MessageSquare, PackageCheck, PencilLine, Send, Timer, UserCheck, Webhook, Zap, type LucideIcon } from "lucide-react";
import { humanizeStatus } from "@/components/patterns/status-badge";
import type { Step, StepType, WorkflowDefinition } from "@/domain/automation/schema";
import { cn } from "@/lib/utils";
import { tr } from "@/lib/i18n";

const NODE: Record<StepType | "trigger", { icon: LucideIcon; tone: string; label: string; hint: string }> = {
  trigger: { icon: Zap, tone: "bg-brand-subtle text-brand-subtle-foreground", label: tr("Trigger"), hint: tr("Starts the workflow") },
  condition: { icon: GitBranch, tone: "bg-warning-bg text-warning", label: tr("Condition"), hint: tr("Branches on record fields") },
  assign_owner: { icon: UserCheck, tone: "bg-info-bg text-info", label: tr("Assign owner"), hint: tr("Round robin or a fixed rep") },
  create_task: { icon: ListTodo, tone: "bg-info-bg text-info", label: tr("Create task"), hint: tr("Assigns a follow-up") },
  update_record: { icon: PencilLine, tone: "bg-info-bg text-info", label: tr("Update record"), hint: tr("Allow-listed fields only") },
  create_activity: { icon: MessageSquare, tone: "bg-info-bg text-info", label: tr("Log activity"), hint: tr("Adds to the timeline") },
  create_notification: { icon: Bell, tone: "bg-success-bg text-success", label: tr("Notify"), hint: tr("In-app notification") },
  convert_deal_to_order: { icon: PackageCheck, tone: "bg-success-bg text-success", label: tr("Create order"), hint: tr("From a won deal") },
  send_email: { icon: Mail, tone: "bg-success-bg text-success", label: tr("Send email"), hint: tr("Owner or assignee") },
  send_telegram: { icon: Send, tone: "bg-info-bg text-info", label: tr("Send to Telegram"), hint: tr("Team chat via the bot") },
  send_whatsapp: { icon: MessageCircle, tone: "bg-success-bg text-success", label: tr("WhatsApp"), hint: tr("Message to the customer") },
  send_slack: { icon: Hash, tone: "bg-info-bg text-info", label: tr("Send to Slack"), hint: tr("Team channel") },
  create_notion_page: { icon: FileText, tone: "bg-surface-muted text-text-subtle", label: tr("Notion page"), hint: tr("In the configured database") },
  send_webhook: { icon: Webhook, tone: "bg-success-bg text-success", label: tr("Send webhook"), hint: tr("Signed, to integrations") },
  delay: { icon: Timer, tone: "bg-surface-muted text-text-subtle", label: tr("Delay"), hint: tr("Waits, then resumes") },
};

const W = 210;
const H = 60;
const GAP_X = 64;
const GAP_Y = 22;

function detail(step: Step): string {
  switch (step.type) {
    case "condition":
      return tr("If {p0} of {p1} condition{p2}", { p0: step.match, p1: step.conditions.length, p2: step.conditions.length === 1 ? "" : "s" });
    case "delay":
      return tr("Wait {p0} h", { p0: step.hours });
    case "send_webhook":
      return step.event_type;
    case "send_telegram":
    case "send_whatsapp":
    case "send_slack":
      return step.text;
    case "create_notion_page":
      return step.title;
    case "send_email":
    case "create_activity":
      return step.subject;
    case "create_task":
    case "create_notification":
      return step.title;
    default:
      return NODE[step.type].hint;
  }
}

type Placed = { id: string; x: number; y: number; kind: StepType | "trigger"; title: string; sub: string };
type Edge = { from: string; to: string; label?: string };

/** Lays the workflow out left to right: one column per step depth, branches stacked. */
function layout(def: WorkflowDefinition) {
  const steps = def.steps;
  const byId = new Map(steps.map((s) => [s.id, s]));
  const next = (i: number): Array<{ to: string; label?: string }> => {
    const s = steps[i]!;
    const fallthrough = steps[i + 1]?.id ?? "end";
    if (s.type === "condition") return [{ to: s.then, label: "yes" }, { to: s.else, label: "no" }];
    return [{ to: s.next ?? fallthrough }];
  };
  const depth = new Map<string, number>([["trigger", 0]]);
  const edges: Edge[] = [{ from: "trigger", to: steps[0]!.id }];
  const queue: Array<[string, number]> = [[steps[0]!.id, 1]];
  const seen = new Set<string>();
  while (queue.length) {
    const [id, d] = queue.shift()!;
    if (seen.has(id) || !byId.has(id)) continue;
    seen.add(id);
    depth.set(id, Math.max(depth.get(id) ?? 0, d));
    const i = steps.findIndex((s) => s.id === id);
    for (const n of next(i)) {
      if (n.to === "end") continue;
      edges.push({ from: id, to: n.to, label: n.label });
      queue.push([n.to, d + 1]);
    }
  }
  const columns = new Map<number, string[]>();
  for (const [id, d] of depth) columns.set(d, [...(columns.get(d) ?? []), id]);
  const tallest = Math.max(...[...columns.values()].map((c) => c.length));
  const height = tallest * H + (tallest - 1) * GAP_Y;
  const placed: Placed[] = [];
  for (const [d, ids] of columns) {
    const colHeight = ids.length * H + (ids.length - 1) * GAP_Y;
    ids.forEach((id, row) => {
      const x = d * (W + GAP_X);
      const y = (height - colHeight) / 2 + row * (H + GAP_Y);
      if (id === "trigger") {
        placed.push({ id, x, y, kind: "trigger", title: humanizeStatus(def.trigger.type.replace(".", "_")), sub: `on ${def.trigger.entity}` });
      } else {
        const s = byId.get(id)!;
        placed.push({ id, x, y, kind: s.type, title: s.name ?? NODE[s.type].label, sub: detail(s) });
      }
    });
  }
  const width = (Math.max(...columns.keys()) + 1) * (W + GAP_X) - GAP_X;
  return { placed, edges, width, height };
}

/** Read-only visual map of a workflow, next to the editor (the definition stays the source of truth). */
export function WorkflowCanvas({ definition }: { definition: WorkflowDefinition }) {
  const { placed, edges, width, height } = layout(definition);
  const at = new Map(placed.map((p) => [p.id, p]));
  const used = new Set<StepType | "trigger">(["trigger", ...definition.steps.map((s) => s.type)]);
  return (
    <section className="grid gap-4 rounded-xl border border-border bg-surface p-4 shadow-sm lg:grid-cols-[220px_1fr]" aria-label={tr("Workflow map")}>
      <aside>
        <h2 className="text-sm font-semibold">{tr("Nodes library")}</h2>
        <p className="mt-0.5 text-xs text-text-muted">{tr("Highlighted: used in this workflow")}</p>
        <ul className="mt-3 space-y-1.5">
          {(Object.keys(NODE) as Array<keyof typeof NODE>).map((k) => {
            const n = NODE[k];
            return (
              <li key={k} className={cn("flex items-center gap-2.5 rounded-lg border px-2.5 py-1.5", used.has(k) ? "border-brand/40 bg-brand-subtle/40" : "border-border opacity-60")}>
                <span className={cn("flex size-7 items-center justify-center rounded-md", n.tone)}>
                  <n.icon className="size-4" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-medium">{n.label}</span>
                  <span className="block truncate text-[11px] text-text-muted">{n.hint}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </aside>
      <div
        className="relative flex min-h-64 items-center overflow-auto rounded-lg border border-border bg-surface-subtle p-6"
        style={{ backgroundImage: "radial-gradient(var(--nx-border-strong) 1px, transparent 1px)", backgroundSize: "18px 18px" }}
      >
        <div className="relative shrink-0" style={{ width, height }}>
          <svg className="absolute inset-0 overflow-visible" width={width} height={height} aria-hidden>
            {edges.map((e, i) => {
              const a = at.get(e.from);
              const b = at.get(e.to);
              if (!a || !b) return null;
              const x1 = a.x + W;
              const y1 = a.y + H / 2;
              const x2 = b.x;
              const y2 = b.y + H / 2;
              const mx = (x1 + x2) / 2;
              return (
                <g key={i}>
                  <path d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke="var(--nx-border-strong)" strokeWidth={1.5} />
                  <circle cx={x1} cy={y1} r={3} fill="var(--nx-accent)" />
                  <circle cx={x2} cy={y2} r={3} fill="var(--nx-surface)" stroke="var(--nx-border-strong)" />
                  {e.label && (
                    <text x={mx} y={(y1 + y2) / 2 - 6} textAnchor="middle" fontSize={10} fill="var(--nx-text-muted)">
                      {e.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          {placed.map((p) => {
            const n = NODE[p.kind];
            return (
              <div
                key={p.id}
                className={cn("absolute flex items-center gap-2.5 rounded-xl border bg-surface px-3 shadow-sm", p.kind === "trigger" ? "border-brand ring-2 ring-brand/20" : "border-border")}
                style={{ left: p.x, top: p.y, width: W, height: H }}
                data-testid="workflow-node"
              >
                <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", n.tone)}>
                  <n.icon className="size-4" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{p.title}</span>
                  <span className="block truncate text-[11px] text-text-muted">{p.sub}</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
