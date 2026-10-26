import { expect, test } from "@playwright/test";

test.describe("several pipelines", () => {
  test("switches the board between pipelines and moves a deal into another pipeline", async ({ page }) => {
    await page.goto("/pipeline");
    const tabs = page.getByTestId("pipeline-tabs");
    await expect(tabs.getByRole("link", { name: "Sales" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("stage-column-Qualification")).toBeVisible();

    await tabs.getByRole("link", { name: "Tenders" }).click();
    await expect(page).toHaveURL(/pipeline=/);
    await expect(page.getByTestId("stage-column-Tender found")).toBeVisible();
    await expect(page.getByTestId("stage-column-Qualification")).toHaveCount(0);

    // Move an open deal of the sales pipeline into the tenders pipeline from its page.
    await page.goto("/deals?status=open&pipeline=");
    await page.locator("tbody tr a").first().click();
    await expect(page).toHaveURL(/\/deals\/[0-9a-f-]{36}$/);
    await page.getByLabel("Deal stage").click();
    await page.getByRole("option", { name: "Tenders · Bid submitted" }).click();
    await expect(page.getByText("Moved to Tenders · Bid submitted")).toBeVisible();
  });
});
