import { beforeEach, describe, expect, it } from "vitest";
import type { Dataset } from "@/domain/entities";
import { csvCell, parseCsv, toCsv } from "@/lib/csv";
import type { Db } from "@/server/db/types";
import { DomainError } from "@/server/repositories/types";
import { importCsv } from "@/server/services/imports";
import { createTestDb, ctxFor, DEMO_USER_IDS } from "./helpers/services";

describe("CSV", () => {
  it("quotes what needs quoting and neutralizes spreadsheet formulas", () => {
    expect(csvCell('Acme, "Ltd"')).toBe('"Acme, ""Ltd"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe("\"'=HYPERLINK(\"\"http://evil\"\")\"");
    expect(csvCell("+7 999 123")).toBe("'+7 999 123");
    expect(csvCell(null)).toBe("");
    expect(csvCell(["a", "b"])).toBe("a; b");
  });

  it("writes a BOM for Excel and parses its own output back", () => {
    const text = toCsv(["Name", "City"], [["Север, ООО", "Москва"], ['Say "hi"', ""]]);
    expect(text.startsWith("﻿")).toBe(true);
    expect(parseCsv(text)).toEqual([["Name", "City"], ["Север, ООО", "Москва"], ['Say "hi"', ""]]);
  });

  it("reads semicolon-separated files and skips blank lines", () => {
    expect(parseCsv("Name;Country\r\nA;RU\r\n\r\nB;KZ\r\n")).toEqual([["Name", "Country"], ["A", "RU"], ["B", "KZ"]]);
  });
});

describe("CSV import", () => {
  let db: Db;
  let data: () => Dataset;
  beforeEach(() => {
    ({ db, data } = createTestDb());
  });
  const admin = () => ctxFor(db, data(), DEMO_USER_IDS.admin);

  it("checks companies first, reporting errors by spreadsheet row, and imports nothing on a dry run", async () => {
    const before = data().companies.length;
    const csv = "Name,Industry,Country,City\nУральский завод,Metal Fabrication,Russia,Екатеринбург\nNo Country Ltd,Logistics,,\n,Mining,KZ,Almaty\nSteppe Mining,Mining,KZ,Almaty\n";
    const r = await importCsv(admin(), { entity: "companies", csv, dry_run: true });
    expect(r).toMatchObject({ rows: 4, valid: 2, created: 0 });
    expect(r.errors.map((e) => e.row)).toEqual([3, 4]);
    expect(r.errors[0]!.message).toMatch(/country/);
    expect(data().companies.length).toBe(before);
    await expect(importCsv(admin(), { entity: "companies", csv, dry_run: false })).rejects.toBeInstanceOf(DomainError);
  });

  it("imports valid companies, Russian country names and codes included", async () => {
    const csv = "Name;Industry;Country;City\nУральский завод;Metal Fabrication;Russia;Екатеринбург\nSteppe Mining;Mining;kz;Almaty\n";
    const r = await importCsv(admin(), { entity: "companies", csv, dry_run: false });
    expect(r).toMatchObject({ rows: 2, valid: 2, created: 2, errors: [] });
    const created = data().companies.filter((c) => ["Уральский завод", "Steppe Mining"].includes(c.name));
    expect(created.map((c) => c.country).sort()).toEqual(["KZ", "RU"]);
    expect(data().audit_logs.filter((a) => a.action === "record.created" && a.target_type === "company").length).toBeGreaterThanOrEqual(2);
  });

  it("imports contacts with messengers, linked to existing companies by name", async () => {
    const company = data().companies[0]!;
    const csv = `First name,Last name,Email,Company,Telegram,WhatsApp\nИван,Петров,ivan@example.com,${company.name},@ivan_petrov,+7 999 123-45-67\nNo,Company,,Does Not Exist Inc,,\n`;
    const check = await importCsv(admin(), { entity: "contacts", csv, dry_run: true });
    expect(check.valid).toBe(1);
    expect(check.errors[0]).toMatchObject({ row: 3 });
    expect(check.errors[0]!.message).toMatch(/was not found/);

    const ok = await importCsv(admin(), { entity: "contacts", csv: csv.split("\n").slice(0, 2).join("\n"), dry_run: false });
    expect(ok.created).toBe(1);
    const ivan = data().contacts.find((c) => c.first_name === "Иван")!;
    expect(ivan.company_id).toBe(company.id);
    expect(ivan.messengers).toEqual({ telegram: "ivan_petrov", whatsapp: "+79991234567" });
  });

  it("refuses files without the required columns or without data", async () => {
    await expect(importCsv(admin(), { entity: "contacts", csv: "Email\nx@example.com\n", dry_run: true })).rejects.toThrow(/Missing columns: first name, last name/);
    await expect(importCsv(admin(), { entity: "companies", csv: "Name,Industry,Country\n", dry_run: true })).rejects.toThrow(/at least one data row/);
  });

  it("creates records as the importing user, who becomes their owner", async () => {
    const rep = ctxFor(db, data(), DEMO_USER_IDS.repDaniel);
    const r = await importCsv(rep, { entity: "contacts", csv: "First name,Last name\nA,B\n", dry_run: false });
    expect(r.created).toBe(1);
    expect(data().contacts.find((c) => c.first_name === "A" && c.last_name === "B")!.owner_id).toBe(DEMO_USER_IDS.repDaniel);
  });
});
