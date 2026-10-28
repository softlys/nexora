"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { tr } from "@/lib/i18n";

export function PrintButton() {
  return (
    <Button onClick={() => window.print()} data-testid="print-document">
      <Printer aria-hidden />
      {tr("Print / Save as PDF")}
    </Button>
  );
}
