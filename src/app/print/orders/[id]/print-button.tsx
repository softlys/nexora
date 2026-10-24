"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button onClick={() => window.print()} data-testid="print-document">
      <Printer aria-hidden />
      Print / Save as PDF
    </Button>
  );
}
