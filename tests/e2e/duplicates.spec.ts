import { expect, test } from "@playwright/test";

test.describe("duplicates", () => {
  test("warns about a look-alike company, then merges it on the Duplicates page", async ({ page }) => {
    await page.goto("/companies");
    const existing = (await page.locator("tbody tr a").first().innerText()).trim();

    await page.goto("/companies?new=1");
    await page.getByLabel("Name").fill(`${existing} LLC`);
    await expect(page.getByTestId("duplicate-warning")).toContainText(existing);
    await page.getByLabel("Industry").fill("Retail");
    await page.getByRole("button", { name: "Create company" }).click();
    await expect(page).toHaveURL(/\/companies\/[0-9a-f-]{36}$/);

    await page.goto("/duplicates?entity=company");
    const group = page.getByTestId("duplicate-group-0");
    await expect(group).toContainText(`${existing} LLC`);
    await group.getByRole("button", { name: "Merge" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Merge" }).click();
    await expect(page.getByText(/Merged 1 into/)).toBeVisible();
    await expect(page.getByText("No duplicates found")).toBeVisible();
  });
});
