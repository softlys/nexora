"use client";

import { Bell, Plus, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { BarsChart } from "@/components/charts/charts";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { FormField } from "@/components/patterns/form-field";
import { IconButton } from "@/components/patterns/icon-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

export function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-20 space-y-4 rounded-lg border border-border bg-surface p-5 shadow-xs">
      <div>
        <h2 id={`${id}-heading`} className="text-md font-semibold">
          {title}
        </h2>
        {description && <p className="mt-0.5 text-sm text-text-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Spec({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium tracking-wide text-text-muted uppercase">{label}</p>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function ButtonsShowcase() {
  return (
    <div className="space-y-4">
      <Spec label="Variants">
        <Button>Primary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
        <Button variant="link">Link</Button>
      </Spec>
      <Spec label="Sizes and icons">
        <Button size="xs">Extra small</Button>
        <Button size="sm">Small</Button>
        <Button>Default</Button>
        <Button size="lg">Large</Button>
        <Button>
          <Plus aria-hidden />
          With icon
        </Button>
        <IconButton label="Notifications" icon={Bell} />
      </Spec>
      <Spec label="States">
        <Button disabled>Disabled</Button>
        <Button disabled>Saving…</Button>
        <Button variant="outline" className="ring-3 ring-ring/40">
          Focus ring
        </Button>
      </Spec>
    </div>
  );
}

export function InputsShowcase() {
  const [email, setEmail] = useState("not-an-email");
  const invalid = !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <FormField id="kit-name" label="Company name" hint="Shown on orders and invoices.">
        <Input id="kit-name" placeholder="Atlasford Industrial Supply" aria-describedby="kit-name-hint" />
      </FormField>
      <FormField id="kit-email" label="Email" error={invalid ? "Enter a valid email address." : undefined}>
        <Input id="kit-email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={invalid || undefined} aria-describedby={invalid ? "kit-email-error" : undefined} />
      </FormField>
      <FormField id="kit-search" label="Search with icon">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-text-muted" aria-hidden />
          <Input id="kit-search" className="pl-8" placeholder="Search companies…" />
        </div>
      </FormField>
      <FormField id="kit-disabled" label="Disabled">
        <Input id="kit-disabled" disabled value="Read only for your role" />
      </FormField>
      <FormField id="kit-select" label="Select">
        <Select defaultValue="draft">
          <SelectTrigger id="kit-select" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
          </SelectContent>
        </Select>
      </FormField>
      <FormField id="kit-notes" label="Textarea">
        <Textarea id="kit-notes" rows={2} placeholder="Notes are plain text." />
      </FormField>
      <div className="flex items-center gap-2">
        <Checkbox id="kit-check" defaultChecked />
        <Label htmlFor="kit-check">Checkbox</Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="kit-switch" defaultChecked />
        <Label htmlFor="kit-switch">Switch</Label>
      </div>
    </div>
  );
}

export function OverlaysShowcase() {
  return (
    <div className="flex flex-wrap gap-2">
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline">Open modal</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modal dialog</DialogTitle>
            <DialogDescription>Focus moves into the dialog, Escape closes it and focus returns to the trigger.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button>Close with Escape</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="outline">Open drawer</Button>
        </SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Detail drawer</SheetTitle>
            <SheetDescription>Used for quick edits and record previews, such as the deal drawer on the pipeline.</SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>
      <ConfirmDialog
        trigger={
          <Button variant="outline">
            <Trash2 aria-hidden />
            Destructive confirm
          </Button>
        }
        title="Archive this company?"
        description="Destructive and irreversible actions are always confirmed. This is a demo: nothing is archived."
        confirmLabel="Archive"
        destructive
        onConfirm={() => {
          toast.success("Confirmed (demo only, nothing changed)");
        }}
      />
      <Button variant="outline" onClick={() => toast.success("Saved", { description: "Toasts confirm completed actions." })}>
        Show toast
      </Button>
    </div>
  );
}

export function NavigationShowcase() {
  return (
    <Tabs defaultValue="overview">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
        <TabsTrigger value="notes">Notes</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="pt-3 text-sm text-text-muted">
        Tabs switch views of one record. Arrow keys move between tabs.
      </TabsContent>
      <TabsContent value="activity" className="pt-3 text-sm text-text-muted">
        Activity timeline content.
      </TabsContent>
      <TabsContent value="notes" className="pt-3 text-sm text-text-muted">
        Notes and comments.
      </TabsContent>
    </Tabs>
  );
}

export function ChartShowcase() {
  return (
    <BarsChart
      title="Sample bar chart"
      description="Sample data for the style guide, not computed from your records."
      data={[
        { label: "Qualification", value: 8 },
        { label: "Discovery", value: 6 },
        { label: "Proposal", value: 5 },
        { label: "Negotiation", value: 3 },
        { label: "Won", value: 4 },
      ]}
      format="count"
      layout="horizontal"
      height={220}
      valueLabel="Deals"
    />
  );
}
