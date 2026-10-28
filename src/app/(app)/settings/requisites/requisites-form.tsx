"use client";

import { ImageUp, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FormField, SettingsCard } from "@/components/patterns/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Requisites } from "@/domain/entities";
import { tr } from "@/lib/i18n";
import { saveRequisitesAction } from "@/server/actions/requisites";

type TextKey = Exclude<keyof Requisites, "stamp" | "signature">;

/** Reads an image and shrinks it to fit `maxWidth` (PNG keeps the stamp's transparency). */
function readImage(file: File, maxWidth: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg)$/.test(file.type)) return reject(new Error(tr("Choose a PNG or JPEG image.")));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(tr("The file could not be read.")));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error(tr("The file could not be read.")));
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/png"));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function ImageField({ id, label, hint, value, onChange, maxWidth }: { id: string; label: string; hint: string; value: string | null; onChange: (v: string | null) => void; maxWidth: number }) {
  return (
    <FormField id={id} label={label} hint={hint}>
      <div className="flex items-center gap-3">
        <div className="flex h-24 w-40 items-center justify-center rounded-md border border-dashed border-border bg-white">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element -- a data: URL image, nothing for next/image to optimize
            <img src={value} alt={label} className="max-h-22 max-w-38 object-contain" />
          ) : <span className="text-xs text-text-muted">{tr("No image")}</span>}
        </div>
        <div className="flex flex-col gap-1">
          <label className="inline-flex cursor-pointer items-center gap-1 text-sm text-brand hover:underline">
            <ImageUp className="size-4" aria-hidden />
            {tr("Upload")}
            <input
              id={id}
              type="file"
              accept="image/png,image/jpeg"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  onChange(await readImage(file, maxWidth));
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : String(error));
                }
              }}
            />
          </label>
          {value && (
            <button type="button" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-danger" onClick={() => onChange(null)}>
              <Trash2 className="size-4" aria-hidden />
              {tr("Remove")}
            </button>
          )}
        </div>
      </div>
    </FormField>
  );
}

export function RequisitesForm({ initial }: { initial: Requisites }) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const set = (k: keyof Requisites, v: string | null) => setValues((cur) => ({ ...cur, [k]: v }));
  const field = (k: TextKey, label: string, opts: { hint?: string; inputMode?: "numeric"; placeholder?: string } = {}) => (
    <FormField id={`req-${k}`} label={label} hint={opts.hint} error={errors[k]}>
      <Input id={`req-${k}`} value={values[k]} onChange={(e) => set(k, k === "legal_name" || k === "address" || k === "bank_name" || k === "director" || k === "accountant" || k === "vat_note" ? e.target.value : e.target.value.replace(/\s/g, ""))} inputMode={opts.inputMode} placeholder={opts.placeholder} />
    </FormField>
  );
  const save = () =>
    start(async () => {
      const r = await saveRequisitesAction(values);
      if (!r.ok) {
        setErrors(Object.fromEntries(Object.entries(r.fieldErrors ?? {}).map(([k, v]) => [k, v[0] ?? ""])));
        return void toast.error(r.error);
      }
      setErrors({});
      toast.success(tr("Requisites saved"));
    });

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <SettingsCard title={tr("Company")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">{field("legal_name", tr("Legal name"), { placeholder: tr("e.g. LLC Atlasford") })}</div>
          {field("inn", tr("Tax ID (ИНН)"), { inputMode: "numeric" })}
          {field("kpp", tr("КПП"), { inputMode: "numeric" })}
          {field("ogrn", tr("ОГРН"), { inputMode: "numeric" })}
          {field("vat_note", tr("VAT note"), { hint: tr("For example: Без НДС (УСН)") })}
          <div className="sm:col-span-2">{field("address", tr("Legal address"))}</div>
        </div>
      </SettingsCard>
      <SettingsCard title={tr("Bank")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">{field("bank_name", tr("Bank name"))}</div>
          {field("bik", tr("БИК"), { inputMode: "numeric" })}
          {field("account", tr("Account (р/с)"), { inputMode: "numeric" })}
          {field("corr_account", tr("Correspondent account (к/с)"), { inputMode: "numeric" })}
        </div>
      </SettingsCard>
      <SettingsCard
        title={tr("Signatures and stamp")}
        footer={
          <Button type="submit" disabled={pending} data-testid="save-requisites">
            {pending ? tr("Saving…") : tr("Save changes")}
          </Button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {field("director", tr("Director"), { placeholder: tr("Surname I. O.") })}
          {field("accountant", tr("Chief accountant"), { placeholder: tr("Surname I. O.") })}
          <ImageField id="req-signature" label={tr("Director's signature")} hint={tr("A scan on a white or transparent background.")} value={values.signature} onChange={(v) => set("signature", v)} maxWidth={360} />
          <ImageField id="req-stamp" label={tr("Stamp")} hint={tr("PNG with a transparent background looks best.")} value={values.stamp} onChange={(v) => set("stamp", v)} maxWidth={420} />
        </div>
      </SettingsCard>
    </form>
  );
}
