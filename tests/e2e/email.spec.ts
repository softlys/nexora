import { expect, test } from "@playwright/test";

test.describe("e-mail from a record", () => {
  test("fills a template from the deal and offers the mail app when sending is not set up", async ({ page }) => {
    await page.goto("/deals?status=open");
    await page.locator("tbody tr a").first().click();
    await expect(page).toHaveURL(/\/deals\/[0-9a-f-]{36}$/);
    const dealName = (await page.getByRole("heading", { level: 1 }).innerText()).trim();

    await page.getByTestId("write-email").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Recipient")).toHaveValue(/@/);
    await dialog.getByLabel("Template").click();
    await page.getByRole("option", { name: "Follow-up" }).click();
    await expect(dialog.getByLabel("Subject")).toHaveValue(`Following up: ${dealName}`);
    await expect(dialog.getByLabel("Message")).toHaveValue(/Olivia Hart/);
    await expect(dialog.getByRole("link", { name: "Open in mail app" })).toHaveAttribute("href", /^mailto:.+subject=Following%20up/);
  });
});
