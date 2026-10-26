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
import { tr, trNode } from "@/lib/i18n";

export function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-20 space-y-4 rounded-lg border border-border bg-surface p-5 shadow-xs">
      <div>
        <h2 id={`${id}-heading`} className="text-md font-semibold">
          {trNode(title)}
        </h2>
        {description && <p className="mt-0.5 text-sm text-text-muted">{trNode(description)}</p>}
      </div>
      {children}
    </section>
  );
}

function Spec({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium tracking-wide text-text-muted uppercase">{trNode(label)}</p>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function ButtonsShowcase() {
  return (
    <div className="space-y-4">
      <Spec label={tr("Variants")}>
        <Button>{tr("Primary")}</Button>
        <Button variant="outline">{tr("Outline")}</Button>
        <Button variant="secondary">{tr("Secondary")}</Button>
        <Button variant="ghost">{tr("Ghost")}</Button>
        <Button variant="danger">{tr("Danger")}</Button>
        <Button variant="link">{tr("Link")}</Button>
      </Spec>
      <Spec label={tr("Sizes and icons")}>
        <Button size="xs">{tr("Extra small")}</Button>
        <Button size="sm">{tr("Small")}</Button>
        <Button>{tr("Default")}</Button>
        <Button size="lg">{tr("Large")}</Button>
        <Button>
          <Plus aria-hidden />{tr("With icon")}</Button>
        <IconButton label={tr("Notifications")} icon={Bell} />
      </Spec>
      <Spec label={tr("States")}>
        <Button disabled>{tr("Disabled")}</Button>
        <Button disabled>{tr("Saving…")}</Button>
        <Button variant="outline" className="ring-3 ring-ring/40">{tr("Focus ring")}</Button>
      </Spec>
    </div>
  );
}

export function InputsShowcase() {
  const [email, setEmail] = useState("not-an-email");
  const invalid = !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <FormField id="kit-name" label={tr("Company name")} hint={tr("Shown on orders and invoices.")}>
        <Input id="kit-name" placeholder={tr("Atlasford Industrial Supply")} aria-describedby="kit-name-hint" />
      </FormField>
      <FormField id="kit-email" label={tr("Email")} error={invalid ? tr("Enter a valid email address.") : undefined}>
        <Input id="kit-email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={invalid || undefined} aria-describedby={invalid ? "kit-email-error" : undefined} />
      </FormField>
      <FormField id="kit-search" label={tr("Search with icon")}>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-text-muted" aria-hidden />
          <Input id="kit-search" className="pl-8" placeholder={tr("Search companies…")} />
        </div>
      </FormField>
      <FormField id="kit-disabled" label={tr("Disabled")}>
        <Input id="kit-disabled" disabled value="Read only for your role" />
      </FormField>
      <FormField id="kit-select" label={tr("Select")}>
        <Select defaultValue="draft">
          <SelectTrigger id="kit-select" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="draft">{tr("Draft")}</SelectItem>
            <SelectItem value="confirmed">{tr("Confirmed")}</SelectItem>
          </SelectContent>
        </Select>
      </FormField>
      <FormField id="kit-notes" label={tr("Textarea")}>
        <Textarea id="kit-notes" rows={2} placeholder={tr("Notes are plain text.")} />
      </FormField>
      <div className="flex items-center gap-2">
        <Checkbox id="kit-check" defaultChecked />
        <Label htmlFor="kit-check">{tr("Checkbox")}</Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="kit-switch" defaultChecked />
        <Label htmlFor="kit-switch">{tr("Switch")}</Label>
      </div>
    </div>
  );
}

export function OverlaysShowcase() {
  return (
    <div className="flex flex-wrap gap-2">
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline">{tr("Open modal")}</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("Modal dialog")}</DialogTitle>
            <DialogDescription>{tr("Focus moves into the dialog, Escape closes it and focus returns to the trigger.")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button>{tr("Close with Escape")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="outline">{tr("Open drawer")}</Button>
        </SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{tr("Detail drawer")}</SheetTitle>
            <SheetDescription>{tr("Used for quick edits and record previews, such as the deal drawer on the pipeline.")}</SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>
      <ConfirmDialog
        trigger={
          <Button variant="outline">
            <Trash2 aria-hidden />{tr("Destructive confirm")}</Button>
        }
        title={tr("Archive this company?")}
        description={tr("Destructive and irreversible actions are always confirmed. This is a demo: nothing is archived.")}
        confirmLabel={tr("Archive")}
        destructive
        onConfirm={() => {
          toast.success(tr("Confirmed (demo only, nothing changed)"));
        }}
      />
      <Button variant="outline" onClick={() => toast.success(tr("Saved"), { description: tr("Toasts confirm completed actions.") })}>{tr("Show toast")}</Button>
    </div>
  );
}

export function NavigationShowcase() {
  return (
    <Tabs defaultValue="overview">
      <TabsList>
        <TabsTrigger value="overview">{tr("Overview")}</TabsTrigger>
        <TabsTrigger value="activity">{tr("Activity")}</TabsTrigger>
        <TabsTrigger value="notes">{tr("Notes")}</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="pt-3 text-sm text-text-muted">{tr("Tabs switch views of one record. Arrow keys move between tabs.")}</TabsContent>
      <TabsContent value="activity" className="pt-3 text-sm text-text-muted">{tr("Activity timeline content.")}</TabsContent>
      <TabsContent value="notes" className="pt-3 text-sm text-text-muted">{tr("Notes and comments.")}</TabsContent>
    </Tabs>
  );
}

export function ChartShowcase() {
  return (
    <BarsChart
      title={tr("Sample bar chart")}
      description={tr("Sample data for the style guide, not computed from your records.")}
      data={[
        { label: tr("Qualification"), value: 8 },
        { label: tr("Discovery"), value: 6 },
        { label: tr("Proposal"), value: 5 },
        { label: tr("Negotiation"), value: 3 },
        { label: tr("Won"), value: 4 },
      ]}
      format="count"
      layout="horizontal"
      height={220}
      valueLabel={tr("Deals")}
    />
  );
}
