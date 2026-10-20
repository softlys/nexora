import { Download, Inbox } from "lucide-react";
import tokens from "../../../../tokens/tokens.json";
import { EmptyState } from "@/components/patterns/empty-state";
import { KpiCard } from "@/components/patterns/kpi-card";
import { PageHeader } from "@/components/patterns/page-header";
import { StatusBadge, type Tone } from "@/components/patterns/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { requirePermission } from "@/server/guards";
import { ButtonsShowcase, ChartShowcase, InputsShowcase, NavigationShowcase, OverlaysShowcase, Section } from "./showcase";

export const metadata = { title: "Figma & UI Kit" };

type Leaf = { $type: string; $value: unknown };
type Group = Record<string, unknown>;

function leaves(group: Group, path: string[] = []): Array<{ path: string[]; token: Leaf }> {
  return Object.entries(group).flatMap(([k, v]) => {
    if (k.startsWith("$")) return [];
    if (v && typeof v === "object" && "$value" in v) return [{ path: [...path, k], token: v as Leaf }];
    return v && typeof v === "object" ? leaves(v as Group, [...path, k]) : [];
  });
}

const t = tokens as unknown as Group & { color: Group; semantic: { light: Group }; font: Group; spacing: Group; radius: Group; shadow: Group };

const SECTIONS = [
  ["principles", "Principles"],
  ["colors", "Color"],
  ["typography", "Typography"],
  ["spacing", "Spacing and radius"],
  ["buttons", "Buttons"],
  ["inputs", "Inputs"],
  ["tables", "Tables and badges"],
  ["overlays", "Modals and drawers"],
  ["navigation", "Navigation"],
  ["cards", "Cards and states"],
  ["charts", "Charts"],
  ["responsive", "Responsive"],
  ["a11y", "Accessibility"],
  ["figma", "Figma"],
] as const;

const TONES: Tone[] = ["neutral", "accent", "success", "warning", "danger", "info"];

export default async function UiKitPage() {
  await requirePermission("view", "ui_kit");
  const primitives = leaves(t.color);
  const semantic = leaves(t.semantic.light);
  const sizes = leaves(t.font).filter((l) => l.path[0] === "size");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Figma & UI Kit"
        description="The living style guide: every swatch and component below is rendered from tokens/tokens.json and the components the app uses. Switch the theme in the top bar to see dark mode."
        actions={
          <>
            <a href="/ui-kit/tokens-studio.json" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-sm text-primary-foreground hover:bg-brand-hover" data-testid="download-tokens-studio">
              <Download className="size-4" aria-hidden />
              Tokens Studio JSON
            </a>
            <a href="/ui-kit/tokens.json" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-sm hover:bg-muted">
              <Download className="size-4" aria-hidden />
              tokens.json
            </a>
          </>
        }
      />

      <nav aria-label="Style guide sections" className="flex flex-wrap gap-1.5">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="rounded-md border border-border px-2 py-1 text-xs text-text-subtle hover:bg-surface-subtle hover:text-foreground">
            {label}
          </a>
        ))}
      </nav>

      <Section id="principles" title="Design principles">
        <ul className="grid gap-3 text-sm md:grid-cols-2">
          {[
            ["Calm density", "Tables and lists show a lot without shouting: 13–14 px text, quiet borders, one accent."],
            ["One accent", "Indigo marks the primary action and selection. Status colors are reserved for state and always come with a label."],
            ["Honest UI", "No button without an action, no number without a source, illustrative values are labelled."],
            ["Keyboard first", "Every action is reachable with the keyboard and shows a visible focus ring."],
          ].map(([title, text]) => (
            <li key={title} className="rounded-md border border-border p-3">
              <p className="font-medium">{title}</p>
              <p className="text-text-muted">{text}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="colors" title="Color tokens" description="Primitives are fixed values; semantic tokens alias them and change with the theme. Use semantic tokens in components.">
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-xs font-medium tracking-wide text-text-muted uppercase">Semantic (current theme)</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {semantic.map(({ path, token }) => (
                <div key={path.join(".")} className="overflow-hidden rounded-md border border-border">
                  <div className="h-10" style={{ background: `var(--nx-${path.join("-")})` }} />
                  <div className="p-2">
                    <p className="truncate font-mono text-[11px]">{path.join("-")}</p>
                    <p className="truncate font-mono text-[11px] text-text-muted">{String(token.$value)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium tracking-wide text-text-muted uppercase">Primitives</p>
            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8 lg:grid-cols-15">
              {primitives.map(({ path, token }) => (
                <div key={path.join(".")} title={`color.${path.join(".")} ${String(token.$value)}`}>
                  <div className="h-8 rounded border border-border" style={{ background: String(token.$value) }} />
                  <p className="mt-1 truncate font-mono text-[10px] text-text-muted">{path.join(".")}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Section>

      <Section id="typography" title="Typography" description="Geist Sans for UI, Geist Mono for ids, code and amounts in logs.">
        <div className="divide-y divide-border">
          {sizes.map(({ path, token }) => (
            <div key={path.join(".")} className="flex items-baseline gap-4 py-2">
              <span className="w-24 shrink-0 font-mono text-[11px] text-text-muted">
                {path[1]} · {String(token.$value)}
              </span>
              <span style={{ fontSize: `var(--nx-font-size-${path[1]})`, lineHeight: `var(--nx-font-line-height-${path[1]})` }}>Deal won: Brennholt Foundry, $164,200</span>
            </div>
          ))}
          <div className="flex gap-6 py-2 text-sm">
            <span className="font-normal">Regular 400</span>
            <span className="font-medium">Medium 500</span>
            <span className="font-semibold">Semibold 600</span>
            <span className="font-mono">Mono NX-2026-0042</span>
          </div>
        </div>
      </Section>

      <Section id="spacing" title="Spacing, radius and elevation" description="A 4 px grid. Radii stay small; shadows are subtle and used for overlays.">
        <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
          <div className="space-y-1.5">
            {leaves(t.spacing).map(({ path, token }) => (
              <div key={path[0]} className="flex items-center gap-3 text-xs">
                <span className="w-16 font-mono text-text-muted">space-{path[0]}</span>
                <span className="h-3 rounded-sm bg-brand" style={{ width: String(token.$value) }} />
                <span className="text-text-muted">{String(token.$value)}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {leaves(t.radius).map(({ path, token }) => (
              <div key={path[0]} className="text-center text-xs">
                <div className="mx-auto size-12 border-2 border-brand bg-brand-subtle" style={{ borderRadius: String(token.$value) }} />
                <p className="mt-1 font-mono text-text-muted">{path[0]}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {leaves(t.shadow).map(({ path }) => (
              <div key={path[0]} className="flex h-14 items-center justify-center rounded-md border border-border bg-surface text-xs" style={{ boxShadow: `var(--nx-shadow-${path[0]})` }}>
                shadow-{path[0]}
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section id="buttons" title="Buttons and states" description="One primary action per area. Destructive actions use Danger and a confirmation.">
        <ButtonsShowcase />
      </Section>

      <Section id="inputs" title="Inputs and validation" description="Labels are always visible. Errors appear under the field, are announced and linked with aria-describedby.">
        <InputsShowcase />
      </Section>

      <Section id="tables" title="Tables and status badges" description="The same status word always has the same color. Badges carry text, never color alone.">
        <div className="relative overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">Sample orders</caption>
            <thead className="border-b border-border bg-surface-subtle text-xs text-text-muted">
              <tr>
                <th scope="col" className="h-9 px-3 text-left font-medium">Order</th>
                <th scope="col" className="h-9 px-3 text-left font-medium">Company</th>
                <th scope="col" className="h-9 px-3 text-left font-medium">Status</th>
                <th scope="col" className="h-9 px-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["NX-2026-0041", "Kestrel Ridge Water Authority", "confirmed", "$133,000.00"],
                ["NX-2026-0040", "Lindqvarn Timber", "shipped", "$278,112.00"],
                ["NX-2026-0039", "Pellmar Construction Group", "overdue", "$12,600.00"],
              ].map(([n, c, s, total]) => (
                <tr key={n} className="border-b border-border last:border-0 hover:bg-surface-subtle">
                  <td className="px-3 py-2 font-mono text-xs">{n}</td>
                  <td className="px-3 py-2">{c}</td>
                  <td className="px-3 py-2">
                    <StatusBadge status={s!} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-2">
          {TONES.map((tone) => (
            <StatusBadge key={tone} tone={tone} label={tone} dot />
          ))}
        </div>
        <p className="text-xs text-text-muted">Sample rows for the style guide.</p>
      </Section>

      <Section id="overlays" title="Modals, drawers, confirmations and toasts">
        <OverlaysShowcase />
      </Section>

      <Section id="navigation" title="Navigation" description="Sidebar for sections, breadcrumbs in the top bar, tabs inside records, Ctrl/Cmd+K for everything.">
        <NavigationShowcase />
      </Section>

      <Section id="cards" title="Cards, empty and loading states">
        <div className="grid gap-3 md:grid-cols-3">
          <KpiCard label="Won deal value" value="$1,555,300" delta={{ value: 0.125, label: "vs previous period" }} illustrative />
          <KpiCard label="Overdue tasks" value="22" delta={{ value: -0.08, positiveIsGood: false, label: "vs previous period" }} illustrative />
          <div className="space-y-2 rounded-lg border border-border p-4" aria-label="Loading example">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-7 w-3/4" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
        <EmptyState icon={Inbox} title="No orders yet" description="Orders appear when a won deal is converted or an order is created by hand." />
      </Section>

      <Section id="charts" title="Charts" description="Chart colors come from chart-1…5 tokens, validated for color-vision deficiency on light and dark surfaces. Every chart has a data table.">
        <ChartShowcase />
      </Section>

      <Section id="responsive" title="Responsive layouts">
        <div className="grid gap-3 text-sm md:grid-cols-3">
          {[
            ["Mobile < 768 px", "Sidebar becomes a drawer, tables hide secondary columns, KPI grid has two columns, forms stack."],
            ["Tablet 768–1279 px", "Sidebar can collapse to icons, detail pages use one column, the pipeline scrolls horizontally."],
            ["Desktop ≥ 1280 px", "Full sidebar, two-column record pages, six KPI cards in a row."],
          ].map(([title, text]) => (
            <div key={title} className="rounded-md border border-border p-3">
              <p className="font-medium">{title}</p>
              <p className="text-text-muted">{text}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="a11y" title="Focus and accessibility">
        <ul className="list-disc space-y-1 pl-5 text-sm text-text-muted">
          <li>Visible 3 px focus ring (ring token) on every interactive element; never removed without a replacement.</li>
          <li>Text contrast meets WCAG AA in both themes; muted text is used only for secondary information.</li>
          <li>Icon-only buttons have an accessible name and a tooltip. Status is never conveyed by color alone.</li>
          <li>Dialogs trap focus and return it to the trigger; the pipeline supports keyboard moves; Ctrl/Cmd+K opens the command palette.</li>
          <li>A skip link jumps to the main content; tables have captions and column headers.</li>
        </ul>
      </Section>

      <Section id="figma" title="Figma" description="No live Figma connection is claimed. Tokens move from code to Figma through the Tokens Studio plugin.">
        <div className="grid gap-4 text-sm lg:grid-cols-2">
          <div className="space-y-2">
            <p className="font-medium">Import the tokens</p>
            <ol className="list-decimal space-y-1 pl-5 text-text-muted">
              <li>Download “Tokens Studio JSON” above.</li>
              <li>In Figma, open the Tokens Studio for Figma plugin → Settings → Token storage: Local document.</li>
              <li>Tools → Load from file/folder → choose nexora-tokens-studio.json. Sets core, light and dark and the themes Light and Dark appear.</li>
              <li>Styles &amp; Variables → Export to Figma → select both themes. Figma gets a variable collection with Light and Dark modes.</li>
            </ol>
          </div>
          <div className="space-y-2">
            <p className="font-medium">Recommended file structure</p>
            <ol className="grid grid-cols-2 gap-1 font-mono text-xs text-text-muted">
              {["01 Foundations", "02 Components", "03 CRM", "04 Sales Pipeline", "05 Orders", "06 Automation Studio", "07 Analytics", "08 Responsive Layouts"].map((p) => (
                <li key={p} className="rounded border border-border px-2 py-1">
                  {p}
                </li>
              ))}
            </ol>
            <p className="text-text-muted">Code is the source of truth: change tokens/tokens.json, run npm run tokens:build, re-import in Figma. Details in docs/figma-design-system.md.</p>
          </div>
        </div>
      </Section>
    </div>
  );
}
