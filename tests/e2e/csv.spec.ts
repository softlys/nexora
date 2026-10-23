import { expect, test } from "@playwright/test";

const stamp = Date.now().toString(36);

test.describe("CSV export and import", () => {
  test("exports the filtered list with a BOM for Excel", async ({ page }) => {
    await page.goto("/companies?q=a");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-companies").click()]);
    expect(download.suggestedFilename()).toMatch(/^nexora-companies-\d{4}-\d{2}-\d{2}\.csv$/);
    const text = await (await download.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString("utf8"));
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.slice(1).split("\r\n")[0]).toBe("Name,Industry,Size,Country,Country code,City,Address,Phone,Website,Lifecycle stage,Owner,Open deals,Contacts,Created");
    expect(text.split("\r\n").length).toBeGreaterThan(2);
  });

  test("checks an import first, refuses rows with errors, then imports a fixed file", async ({ page }) => {
    const name = `Уральский завод ${stamp}`;
    await page.goto("/companies");
    await page.getByTestId("import-companies").click();
    const dialog = page.getByRole("dialog");
    const file = (body: string) => ({ name: "companies.csv", mimeType: "text/csv", buffer: Buffer.from(body, "utf8") });

    await dialog.getByLabel("CSV file").setInputFiles(file(`Name;Industry;Country;City\n${name};Metal Fabrication;Russia;Екатеринбург\nBroken Row;Mining;Atlantis;\n`));
    const check = dialog.getByTestId("import-check");
    await expect(check).toContainText("2 rows");
    await expect(check).toContainText("1 with errors");
    await expect(check).toContainText("Row 3");
    await expect(dialog.getByRole("button", { name: /^Import \d/ })).toBeDisabled();

    await dialog.getByLabel("CSV file").setInputFiles(file(`Name;Industry;Country;City\n${name};Metal Fabrication;Russia;Екатеринбург\n`));
    await expect(check).toContainText("1 ready to import");
    await dialog.getByRole("button", { name: "Import 1 companies" }).click();
    await expect(dialog).toBeHidden();

    await page.goto(`/companies?q=${encodeURIComponent(stamp)}`);
    await expect(page.getByRole("link", { name })).toBeVisible();
  });
});
