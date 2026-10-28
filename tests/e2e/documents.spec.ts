import { expect, test } from "@playwright/test";

test.describe("documents", () => {
  test("requisites with bank details appear on an invoice made from a deal", async ({ page }) => {
    await page.goto("/settings/requisites");
    await page.getByLabel("Legal name").fill("LLC Example");
    await page.getByLabel("Tax ID (ИНН)").fill("7701234567");
    await page.getByLabel("КПП").fill("770101001");
    await page.getByLabel("Bank name").fill("Example Bank");
    await page.getByLabel("БИК").fill("044525225");
    await page.getByLabel("Account (р/с)").fill("40702810400000000001");
    await page.getByLabel("Correspondent account (к/с)").fill("30101810400000000225");
    await page.getByLabel("Director", { exact: true }).fill("Ivanov I. I.");
    await page.getByTestId("save-requisites").click();
    await expect(page.getByText("Requisites saved")).toBeVisible();

    await page.goto("/deals?status=open");
    await page.locator("tbody tr a").first().click();
    const href = await page.getByTestId("deal-quote").getAttribute("href");
    await page.goto(`${href!.replace("doc=quote", "doc=invoice")}&lang=ru`);
    await expect(page.getByTestId("bank-block")).toContainText("044525225");
    await expect(page.getByText(/LLC Example, ИНН 7701234567, КПП 770101001/)).toBeVisible();
    await expect(page.getByTestId("signatures")).toContainText("Ivanov I. I.");
  });
});
