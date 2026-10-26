import { expect, test } from "@playwright/test";

test.describe("custom fields", () => {
  test("an admin adds a company field; it is filled in the form and shown on the company", async ({ page }) => {
    await page.goto("/settings/fields");
    await page.getByTestId("new-field-company").click();
    await page.getByLabel("Name").fill("Tax ID");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("fields-company").getByText("Tax ID")).toBeVisible();

    await page.goto("/companies");
    await page.locator("tbody tr a").first().click();
    await expect(page).toHaveURL(/\/companies\/[0-9a-f-]{36}$/);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("Tax ID").fill("7701234567");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Company updated")).toBeVisible();
    await expect(page.getByText("7701234567")).toBeVisible();
  });
});
