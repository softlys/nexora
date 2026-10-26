import { expect, test, type Page } from "@playwright/test";

const ROUTES: Array<[string, string]> = [
  ["Overview", "Overview"],
  ["Companies", "Companies"],
  ["Contacts", "Contacts"],
  ["Leads", "Leads"],
  ["Deals", "Deals"],
  ["Sales Pipeline", "Sales Pipeline"],
  ["Orders", "Orders"],
  ["Tasks & Activities", "Tasks & Activities"],
  ["Automation Studio", "Automation Studio"],
  ["Integrations", "Integrations"],
  ["Analytics", "Analytics"],
  ["Figma & UI Kit", "Figma & UI Kit"],
  ["Settings", "Settings"],
];

async function switchUser(page: Page, role: "admin" | "manager" | "sales_rep") {
  await page.getByTestId("user-menu").click();
  await page.getByTestId(`switch-user-${role}`).first().click();
  const label = { admin: "Admin", manager: "Manager", sales_rep: "Sales Rep" }[role];
  await expect(page.getByTestId("current-role")).toHaveText(label);
}

test.describe("foundation", () => {
  test.use({ viewport: { width: 1366, height: 900 } });

  test("the app loads in demo mode without configuration", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    await expect(page.getByText(/Demo mode: fictional data/)).toBeVisible();
    await expect(page.getByTestId("current-role")).toHaveText("Admin");
  });

  test("the sidebar reaches every route", async ({ page }) => {
    await page.goto("/");
    const sidebar = page.getByTestId("sidebar");
    for (const [link, heading] of ROUTES) {
      await sidebar.getByRole("link", { name: link, exact: true }).click();
      await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
    }
  });

  test("a sales rep cannot open admin settings, even by direct URL", async ({ page }) => {
    await page.goto("/");
    await switchUser(page, "sales_rep");

    const sidebar = page.getByTestId("sidebar");
    await expect(sidebar.getByRole("link", { name: "Automation Studio" })).toHaveCount(0);
    await expect(sidebar.getByRole("link", { name: "Integrations" })).toHaveCount(0);

    for (const path of ["/settings/pipeline", "/settings/demo", "/settings/organization", "/settings/team", "/automation", "/integrations"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: "You don't have access to this page" })).toBeVisible();
    }

    await page.goto("/settings/profile");
    await expect(page.getByRole("heading", { name: "Profile", exact: true })).toBeVisible();
  });

  test("switching roles changes both navigation and server-side data scope", async ({ page }) => {
    // The list footer ("1–25 of 25") counts the companies the server returned for this role.
    const total = async () => {
      await page.goto("/companies");
      return Number((await page.getByText(/^\d+–\d+ of \d+$/).innerText()).split(" of ")[1]);
    };
    const adminCount = await total();

    await switchUser(page, "sales_rep");
    const repCount = await total();
    expect(repCount).toBeGreaterThan(0);
    expect(repCount).toBeLessThan(adminCount);

    await switchUser(page, "admin");
    await page.goto("/settings/pipeline");
    await expect(page.getByRole("heading", { name: "Pipelines", exact: true })).toBeVisible();
  });

  test("the command palette navigates between pages", async ({ page }) => {
    await page.goto("/");
    // The shortcut listener is attached after hydration.
    await page.waitForLoadState("networkidle");
    await page.keyboard.press("Control+k");
    await page.getByPlaceholder("Go to page…").fill("pipeline");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: "Sales Pipeline" })).toBeVisible();

    await page.getByRole("button", { name: "Open command palette" }).click();
    await page.getByPlaceholder("Go to page…").fill("demo data");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/settings\/demo$/);
  });
});
