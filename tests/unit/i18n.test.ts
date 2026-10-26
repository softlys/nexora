import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { intlLocale, plural, tr } from "@/lib/i18n";
import { RU } from "@/lib/i18n/ru";
import { countryName } from "@/lib/countries";
import { formatDate, formatMoney } from "@/lib/format";

const setLocale = (l: "ru" | "en") => (process.env.NEXORA_LOCALE = l);
afterEach(() => setLocale("en"));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? sources(join(dir, d.name)) : /\.tsx?$/.test(d.name) ? [join(dir, d.name)] : []));
}

describe("Russian interface", () => {
  it("translates texts, fills placeholders and falls back to English", () => {
    setLocale("ru");
    expect(tr("Companies")).toBe("Компании");
    expect(tr("Move {p0} up", { p0: "Шаг 1" })).toBe("Переместить «Шаг 1» выше");
    expect(tr("A text nobody translated")).toBe("A text nobody translated");
    expect(intlLocale()).toBe("ru-RU");
    setLocale("en");
    expect(tr("Companies")).toBe("Companies");
    expect(tr("Move {p0} up", { p0: "Step 1" })).toBe("Move Step 1 up");
  });

  it("uses Russian plural forms", () => {
    setLocale("ru");
    expect([1, 2, 5, 11, 21, 22, 25, 111].map((n) => plural(n, "task"))).toEqual(["1 задача", "2 задачи", "5 задач", "11 задач", "21 задача", "22 задачи", "25 задач", "111 задач"]);
    setLocale("en");
    expect(plural(1, "task")).toBe("1 task");
    expect(plural(3, "task")).toBe("3 tasks");
  });

  it("formats dates, money and countries for the language", () => {
    setLocale("ru");
    expect(formatDate("2026-10-24")).toBe("24 окт. 2026 г.");
    expect(formatMoney(1500, "RUB")).toMatch(/^1\s500\s₽$/);
    expect(countryName("RU")).toBe("Россия");
    setLocale("en");
    expect(countryName("RU")).toBe("Russia");
  });

  it("has a translation for every interface text in the code", () => {
    const keys = new Set<string>();
    for (const file of [...sources("src/app"), ...sources("src/components")]) {
      for (const m of readFileSync(file, "utf8").matchAll(/\btr\(\s*("(?:[^"\\]|\\.)*")/g)) keys.add(JSON.parse(m[1]!) as string);
    }
    // Texts that are code, names or examples stay as they are: env vars, headers, brands, JSON.
    const isCode = (k: string) => /^[A-Z0-9_]+$/.test(k) || /[{}<>]|=|:\/\/|^\.|^@|^POST |^npm |→ |^[a-z_:.-]+$|^X-|^Idempoten|^[a-z_]+ \/ [a-z_]+$|^Authorization|^HTTP|Ctrl|^Esc$|^Enter$|^Tab \//.test(k) || /^(Make|Telegram|WhatsApp|Stripe|Figma|NEXORA|URL|IF|Vb|Webhook|Tokens Studio JSON|Header Auth|HTTP Request)$/.test(k) || /^(Atlasford|Kestrel|Lindqvarn|Pellmar|Deal won:|Mono NX|space-|shadow-|Счёт|КП|Invoice \(EN\)|Quote \(EN\)|Instagram Direct|Facebook Messenger|sha256|crypto|type|partner|events:write)/.test(k);
    const missing = [...keys].filter((k) => !RU[k] && !isCode(k));
    expect(missing).toEqual([]);
  });
});
