"use client";

import { Copy, CreditCard, ExternalLink, FileText } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { orderPaymentLinkAction } from "@/server/actions/crm";
import { tr } from "@/lib/i18n";

const DOCS = [
  { doc: "invoice", lang: "ru", label: tr("Счёт (RU)") },
  { doc: "quote", lang: "ru", label: tr("КП (RU)") },
  { doc: "act", lang: "ru", label: "Акт" },
  { doc: "upd", lang: "ru", label: "УПД" },
  { doc: "invoice", lang: "en", label: tr("Invoice (EN)") },
  { doc: "quote", lang: "en", label: tr("Quote (EN)") },
] as const;

/** Printable invoice and quote, and online payment links (YooKassa, Stripe) for an order. */
export function OrderDocuments({ orderId, providers, canPay }: { orderId: string; providers: Array<{ id: "yookassa" | "stripe"; label: string }>; canPay: boolean }) {
  const [link, setLink] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {DOCS.map((d) => (
          <Button key={`${d.doc}-${d.lang}`} asChild size="sm" variant="outline">
            <a href={`/print/orders/${orderId}?doc=${d.doc}&lang=${d.lang}`} target="_blank" rel="noopener" data-testid={`doc-${d.doc}-${d.lang}`}>
              <FileText aria-hidden />
              {d.label}
            </a>
          </Button>
        ))}
      </div>
      {canPay && (
        <div className="space-y-2 border-t border-border pt-3">
          {providers.length === 0 ? (
            <p className="text-xs text-text-muted">{tr("Online payment: connect YooKassa or Stripe in Integrations to send customers a payment link.")}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {providers.map((p) => (
                <Button
                  key={p.id}
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await orderPaymentLinkAction({ order_id: orderId, provider: p.id });
                      if (!r.ok) return void toast.error(r.error);
                      setLink(r.data.url);
                    })
                  }
                >
                  <CreditCard aria-hidden />{tr("Payment link ·")} {p.label}
                </Button>
              ))}
            </div>
          )}
          {link && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-surface-subtle p-2 text-xs" data-testid="payment-link">
              <span className="min-w-0 flex-1 truncate font-mono">{link}</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  void navigator.clipboard?.writeText(link);
                  toast.success(tr("Link copied: send it to the customer"));
                }}
              >
                <Copy aria-hidden />{tr("Copy")}</Button>
              <Button asChild size="sm" variant="ghost">
                <a href={link} target="_blank" rel="noopener noreferrer">
                  <ExternalLink aria-hidden />{tr("Open")}</a>
              </Button>
            </div>
          )}
          <p className="text-xs text-text-muted">{tr("The payment is added to the order automatically when the provider confirms it.")}</p>
        </div>
      )}
    </div>
  );
}
