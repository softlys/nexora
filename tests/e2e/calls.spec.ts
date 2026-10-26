import { expect, test } from "@playwright/test";

test.describe("calls", () => {
  test("a simulated incoming call shows the caller's card, which opens the contact", async ({ page }) => {
    await page.goto("/integrations/mango");
    await page.getByTestId("simulate-call").click();
    const card = page.getByTestId("incoming-call");
    await expect(card).toContainText("Incoming call:", { timeout: 15_000 });
    await card.getByRole("button", { name: "Open card" }).click();
    await expect(page).toHaveURL(/\/contacts\/[0-9a-f-]{36}$/);
    await expect(card).toHaveCount(0);
    // Without a PBX the call button opens the phone app.
    await expect(page.getByTestId("call-button")).toHaveAttribute("href", /^tel:\+?\d+$/);
  });
});
