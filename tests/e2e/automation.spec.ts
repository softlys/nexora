import { expect, test } from "@playwright/test";

const stamp = Date.now().toString(36);

test.describe("dashboard and automation", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("creating a lead triggers the New lead automation: follow-up task and execution log", async ({ page }) => {
    await page.goto("/leads?new=1");
    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("Title").fill(`Hydraulic press inquiry ${stamp}`);
    await sheet.getByLabel("Company").fill(`Vestfold Presswerk ${stamp}`);
    await sheet.getByLabel("Contact name").fill(`Ilse Brandt ${stamp}`);
    await sheet.getByRole("button", { name: "Create lead" }).click();
    await expect(page.getByRole("heading", { level: 1, name: `Hydraulic press inquiry ${stamp}` })).toBeVisible();

    // The automation's activity shows on the lead timeline.
    await expect(page.getByText("Lead received and assigned")).toBeVisible();

    // The follow-up task exists.
    await page.goto(`/tasks?q=${encodeURIComponent(`Ilse Brandt ${stamp}`)}`);
    await expect(page.getByRole("link", { name: `Follow up with Ilse Brandt ${stamp} at Vestfold Presswerk ${stamp}` })).toBeVisible();

    // The execution log has a fresh successful run.
    await page.goto("/automation");
    await page.getByRole("link", { name: "New lead: assign and follow up" }).click();
    const latest = page.getByTestId("run-row").first();
    await expect(latest).toContainText("just now");
    await expect(latest).toContainText("Success");
    await latest.click();
    await expect(page.getByText("2. Create follow-up task")).toBeVisible();
  });

  test("clicking a stage bar on the dashboard opens the filtered deals list for the same range", async ({ page }) => {
    await page.goto("/?range=this_year");
    await page.waitForLoadState("networkidle");
    const bars = page.locator("figure", { hasText: "Deals by stage" }).locator(".recharts-bar-rectangle path, .recharts-rectangle");
    await expect(bars.first()).toBeVisible();
    await bars.first().click();
    await expect(page).toHaveURL(/\/deals\?stage=[0-9a-f-]{36}&created_from=\d{4}-01-01&created_to=\d{4}-\d{2}-\d{2}/);
    await expect(page.getByRole("heading", { level: 1, name: "Deals" })).toBeVisible();
  });

  test("KPI cards drill down to the records behind them", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /Overdue tasks/ }).click();
    await expect(page).toHaveURL(/\/tasks\?status=overdue/);
    await page.goto("/");
    await page.getByRole("link", { name: /Outstanding receivables/ }).click();
    await expect(page).toHaveURL(/\/orders\?receivable=1/);
  });

  test("a sales rep cannot open Automation Studio or the security log", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("user-menu").click();
    await page.getByTestId("switch-user-sales_rep").first().click();
    await expect(page.getByTestId("current-role")).toHaveText("Sales Rep");
    for (const path of ["/automation", "/settings/security"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: "You don't have access to this page" })).toBeVisible();
    }
  });

  test("the security log shows an intact chain and records the role switch", async ({ page }) => {
    await page.goto("/settings/security");
    await expect(page.getByTestId("chain-status")).toContainText("Chain intact");
    await page.getByRole("button", { name: "Verify now" }).click();
    await expect(page.getByTestId("chain-status")).toContainText("Chain intact");
    await expect(page.getByText("auth.demo_user_switched").first()).toBeVisible();
  });
});
