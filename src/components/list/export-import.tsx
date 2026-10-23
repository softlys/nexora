"use client";

import { Download, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { importCsvAction } from "@/server/actions/crm";

/** Downloads the current list (same search, filters and sort) as CSV. */
export function ExportButton({ entity, query }: { entity: "companies" | "contacts" | "leads" | "deals"; query: string }) {
  return (
    <Button variant="outline" asChild>
      <a href={`/export/${entity}${query ? `?${query}` : ""}`} data-testid={`export-${entity}`}>
        <Download aria-hidden />
        Export CSV
      </a>
    </Button>
  );
}

type Result = { rows: number; valid: number; errors: Array<{ row: number; message: string }>; created: number };

const COLUMNS = {
  companies: "Name, Industry, Country (name or code) — required. Optional: Size, City, Address, Phone, Website, Lifecycle stage, Notes.",
  contacts: "First name, Last name — required. Optional: Email, Phone, Job title, Company (an existing company's name), Tags (separated by ;), Telegram, WhatsApp, Instagram and other messengers.",
} as const;

/** Upload a CSV, see what would be imported and the errors by row, then import. */
export function ImportButton({ entity }: { entity: "companies" | "contacts" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [check, setCheck] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  const reset = () => {
    setCsv(null);
    setFileName("");
    setCheck(null);
    setError(null);
    if (input.current) input.current.value = "";
  };

  const run = (dryRun: boolean, text: string) =>
    start(async () => {
      setError(null);
      const r = await importCsvAction({ entity, csv: text, dry_run: dryRun });
      if (!r.ok) {
        setError(r.fieldErrors ? (Object.values(r.fieldErrors).flat()[0] ?? r.error) : r.error);
        return;
      }
      if (dryRun) setCheck(r.data);
      else {
        toast.success(`Imported ${r.data.created} ${entity}`);
        setOpen(false);
        reset();
        router.refresh();
      }
    });

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} data-testid={`import-${entity}`}>
        <Upload aria-hidden />
        Import CSV
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (pending) return;
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Import {entity} from CSV</DialogTitle>
            <DialogDescription>{COLUMNS[entity]} The first row holds the column names; an exported file can be imported back. Comma or semicolon separated, UTF-8.</DialogDescription>
          </DialogHeader>
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv"
            aria-label="CSV file"
            className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-surface-muted file:px-3 file:py-1.5 file:text-sm"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              setCheck(null);
              setError(null);
              if (!file) return;
              if (file.size > 900_000) {
                setError("The file is larger than 900 KB; split it into parts.");
                return;
              }
              const text = await file.text();
              setCsv(text);
              setFileName(file.name);
              run(true, text);
            }}
          />
          {pending && <p className="text-sm text-text-muted">Checking {fileName}…</p>}
          {error && (
            <p role="alert" className="rounded-md border border-danger-border bg-danger-bg p-3 text-sm text-danger">
              {error}
            </p>
          )}
          {check && (
            <div className="space-y-2 text-sm" data-testid="import-check">
              <p>
                {check.rows} rows: <span className="font-medium text-success">{check.valid} ready to import</span>
                {check.errors.length > 0 && <span className="font-medium text-danger">, {check.errors.length} with errors</span>}.
              </p>
              {check.errors.length > 0 && (
                <ul className="max-h-48 space-y-1 overflow-auto rounded-md border border-border p-2 text-xs">
                  {check.errors.map((e) => (
                    <li key={`${e.row}-${e.message}`}>
                      <span className="font-medium">Row {e.row}:</span> {e.message}
                    </li>
                  ))}
                </ul>
              )}
              {check.errors.length > 0 && <p className="text-xs text-text-muted">Fix these rows in the file and choose it again. Nothing is imported while there are errors.</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={() => csv && run(false, csv)} disabled={pending || !check || check.errors.length > 0 || check.valid === 0}>
              {pending && check ? "Importing…" : `Import ${check?.valid ?? ""} ${entity}`.trim()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
