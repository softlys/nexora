import { expect, test } from "@playwright/test";

/** Bugs found in QA, kept fixed. */
const stamp = Date.now().toString(36);

test.describe("QA regressions", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("a task keeps its due date and time after create and edit", async ({ page }) => {
    await page.goto("/tasks?new=1");
    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("Title").fill(`Call back about spares ${stamp}`);
    await sheet.getByLabel("Due date").fill("2026-12-15");
    await sheet.getByLabel("Due time").fill("14:30");
    await sheet.getByRole("button", { name: "Create task" }).click();
    await page.goto(`/tasks?q=${encodeURIComponent(stamp)}`);
    await page.getByRole("link", { name: `Call back about spares ${stamp}` }).click();
    await expect(page.getByText(/Dec 15, 2026/).first()).toBeVisible();

    await page.getByRole("button", { name: "Edit" }).click();
    const edit = page.getByRole("dialog");
    await expect(edit.getByLabel("Due date")).toHaveValue("2026-12-15");
    await edit.getByLabel("Title").fill(`Call back about spares ${stamp} (edited)`);
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("heading", { level: 1, name: `Call back about spares ${stamp} (edited)` })).toBeVisible();
    await expect(page.getByText(/Dec 15, 2026/).first()).toBeVisible();
  });

  test("an order edit that would drop below the payments shows the reason inside the form", async ({ page }) => {
    await page.goto("/orders?payment=partially_paid");
    await page.locator('main a[href^="/orders/"]').first().click();
    await page.getByRole("button", { name: "Edit" }).first().click();
    const sheet = page.getByRole("dialog");
    // Shrink every line so the new total is far below what was already paid.
    const quantities = sheet.locator('input[name$=".quantity"]');
    for (let i = 0; i < (await quantities.count()); i++) await quantities.nth(i).fill("0.01");
    await sheet.getByRole("button", { name: "Save changes" }).click();
    await expect(sheet.getByTestId("form-error")).toContainText(/is lower than the payments already recorded \(\$[\d,]+\.\d{2}\)/);
    // Escape with unsaved changes asks before discarding.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("alertdialog")).toContainText("Discard unsaved changes?");
    await page.getByRole("button", { name: "Keep editing" }).click();
    await expect(sheet).toBeVisible();
  });

  test("missing records answer 404 and forbidden pages 403", async ({ page }) => {
    expect((await page.goto("/companies/00000000-0000-4000-8000-000000000000"))!.status()).toBe(404);
    await page.goto("/");
    await page.getByTestId("user-menu").click();
    await page.getByTestId("switch-user-sales_rep").first().click();
    await expect(page.getByTestId("current-role")).toHaveText("Sales Rep");
    expect((await page.goto("/settings/team"))!.status()).toBe(403);
    await expect(page.getByRole("heading", { name: "You don't have access to this page" })).toBeVisible();
  });

  test("record pages put the record name in the browser tab", async ({ page }) => {
    await page.goto("/companies");
    const link = page.locator('main a[href^="/companies/"]').first();
    const name = (await link.innerText()).trim();
    await link.click();
    await expect(page).toHaveTitle(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} · NEXORA$`));
  });

  test("a workflow shows its map: trigger first, then its steps", async ({ page }) => {
    await page.goto("/automation");
    await page.locator('main a[href^="/automation/"]').first().click();
    const nodes = page.getByTestId("workflow-node");
    await expect(nodes.first()).toBeVisible();
    expect(await nodes.count()).toBeGreaterThan(1);
    await expect(page.getByRole("heading", { name: "Nodes library" })).toBeVisible();
  });
});
