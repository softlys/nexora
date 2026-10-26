/** Display formatting helpers. Formatting only; no business logic. Defaults follow the interface language. */
import { intlLocale, locale as uiLocale, tr } from "@/lib/i18n";

/** Rounding leftovers like -0.004 must not print as "-$0.00". */
const noNegativeZero = (value: number, digits: number) => (Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value);

export function formatMoney(value: number, currency = "USD", locale = intlLocale(), compact = false): string {
  value = noNegativeZero(value, 0);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: compact ? 1 : 0,
    notation: compact ? "compact" : "standard",
  }).format(value);
}

/** Exact money with cents, for orders, items and payments. */
export function formatAmount(value: number, currency = "USD", locale = intlLocale()): string {
  value = noNegativeZero(value, 2);
  return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

export function formatNumber(value: number, locale = intlLocale()): string {
  return new Intl.NumberFormat(locale).format(value);
}

export function formatPercent(value: number, locale = intlLocale(), digits = 0): string {
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: digits }).format(value);
}

export function formatDate(iso: string | null | undefined, locale = intlLocale()): string {
  if (!iso) return "—";
  const date = iso.length === 10 ? new Date(`${iso}T00:00:00Z`) : new Date(iso);
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

export function formatRelative(iso: string, now: Date = new Date()): string {
  const diff = Date.parse(iso) - now.getTime();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(uiLocale(), { numeric: "auto" });
  if (abs < 60_000) return tr("just now");
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour");
  if (abs < 30 * 86_400_000) return rtf.format(Math.round(diff / 86_400_000), "day");
  return formatDate(iso);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

export const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  manager: "Manager",
  sales_rep: "Sales Rep",
};
