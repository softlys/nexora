import { expect, test } from "@playwright/test";

test.describe("products in deals", () => {
  test("adding products to a deal sets its amount", async ({ page }) => {
    await page.goto("/deals?status=open");
    await page.locator("tbody tr a").first().click();
    await expect(page).toHaveURL(/\/deals\/[0-9a-f-]{36}$/);
    await page.getByTestId("edit-deal-products").click();
    await page.getByPlaceholder("Description").first().fill("Installation");
    await page.getByLabel("Qty 1").fill("2");
    await page.getByLabel("Price 1").fill("150");
    await page.getByTestId("save-deal-products").click();
    await expect(page.getByTestId("deal-products-total")).toContainText("300");
    await expect(page.getByText(/Products saved/)).toBeVisible();
  });
});
