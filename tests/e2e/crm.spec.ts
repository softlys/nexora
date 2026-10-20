import { expect, test, type Locator, type Page } from "@playwright/test";

const stamp = Date.now().toString(36);
const COMPANY = `Kiln Ridge Ceramics ${stamp}`;
const DEAL = `Kiln Ridge kiln line ${stamp}`;

async function pickCombobox(page: Page, label: string, option: string) {
  await page.getByLabel(label, { exact: true }).click();
  await page.getByPlaceholder("Search…").fill(option.slice(0, 20));
  await page.getByRole("option", { name: option }).first().click();
}

async function dragTo(page: Page, handle: Locator, target: Locator) {
  const from = (await handle.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 20, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + 80, { steps: 20 });
  await page.mouse.up();
}

test.describe("CRM core", () => {
  test.use({ viewport: { width: 2400, height: 1000 } });

  test("company → contact → deal → won → exactly one order", async ({ page }) => {
    // Company
    await page.goto("/companies?new=1");
    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("Name", { exact: true }).fill(COMPANY);
    await sheet.getByLabel("Industry").fill("Manufacturing");
    await sheet.getByRole("button", { name: "Create company" }).click();
    await expect(page.getByRole("heading", { level: 1, name: COMPANY })).toBeVisible();

    // Contact
    await page.goto("/contacts?new=1");
    await page.getByLabel("First name").fill("Ines");
    await page.getByLabel("Last name").fill(`Varga ${stamp}`);
    await pickCombobox(page, "Company", COMPANY);
    await page.getByLabel("Email").fill(`ines.${stamp}@kilnridge.example`);
    await page.getByRole("button", { name: "Create contact" }).click();
    await expect(page.getByRole("heading", { level: 1, name: `Ines Varga ${stamp}` })).toBeVisible();

    // Deal
    await page.goto("/deals?new=1");
    await page.getByLabel("Deal name").fill(DEAL);
    await pickCombobox(page, "Company", COMPANY);
    await page.getByLabel("Amount").fill("48250");
    await page.getByRole("button", { name: "Create deal" }).click();
    await expect(page.getByRole("heading", { level: 1, name: DEAL })).toBeVisible();

    // Move it along the pipeline: keyboard-accessible menu first, then drag it to Won.
    await page.goto(`/pipeline?q=${encodeURIComponent(stamp)}`);
    await page.waitForLoadState("networkidle");
    const card = page.locator(`[data-testid="deal-card"][data-deal-name="${DEAL}"]`);
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: `Move ${DEAL} to another stage` }).click();
    await page.getByRole("menuitem", { name: "Commitment" }).click();
    await expect(page.getByTestId("stage-column-Commitment").locator(`[data-deal-name="${DEAL}"]`)).toBeVisible();

    // Both columns on screen so the drag does not trigger auto-scroll.
    const won = page.getByTestId("stage-column-Won");
    await won.scrollIntoViewIfNeeded();
    const moved = page.getByTestId("stage-column-Commitment").locator(`[data-deal-name="${DEAL}"]`);
    await moved.hover();
    await dragTo(page, moved.getByRole("button", { name: `Drag ${DEAL}` }), won);
    await expect(page.getByText(`${DEAL} won`)).toBeVisible();
    await expect(won.locator(`[data-deal-name="${DEAL}"]`)).toBeVisible();

    // The move persists across reload
    await page.reload();
    await expect(page.getByTestId("stage-column-Won").locator(`[data-deal-name="${DEAL}"]`)).toBeVisible();

    // The "Deal won" automation creates the order; the deal links to it and offers no second one.
    await page.locator(`[data-deal-name="${DEAL}"]`).getByRole("button", { name: `Open ${DEAL}` }).click();
    await page.getByRole("link", { name: "Open full deal page" }).click();
    await expect(page.getByRole("heading", { level: 1, name: DEAL })).toBeVisible();
    const orderLink = page.getByRole("link", { name: /^Order NX-\d{4}-\d{4}$/ });
    await expect(orderLink).toBeVisible();
    await expect(page.getByRole("button", { name: "Create order" })).toHaveCount(0);
    await orderLink.click();
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
    await expect(page.getByText("$48,250.00").first()).toBeVisible();

    await page.goto(`/orders?q=${encodeURIComponent(COMPANY)}`);
    await expect(page.getByRole("link", { name: /^NX-\d{4}-\d{4}$/ })).toHaveCount(1);
  });

  test("user text is rendered as text, never as HTML", async ({ page }) => {
    await page.goto("/companies");
    await page.locator('main a[href^="/companies/"]').first().click();
    await page.getByRole("tab", { name: /Notes/ }).click();
    const payload = `<script>window.__xss = 1</script><img src=x onerror="window.__xss = 2">${stamp}`;
    await page.getByRole("textbox", { name: "Comment" }).fill(payload);
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(page.getByText(payload)).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  });

  test("a sales rep cannot open another rep's record by URL", async ({ page }) => {
    // Find a deal owned by someone else while acting as admin.
    await page.goto("/deals?owner=00000000-0000-4000-8000-000000000104");
    const href = await page.locator('main a[href^="/deals/"]').first().getAttribute("href");
    expect(href).toBeTruthy();

    // Switch to Daniel (sales rep) and open it directly.
    await page.getByTestId("user-menu").click();
    await page.getByTestId("switch-user-sales_rep").first().click();
    await expect(page.getByTestId("current-role")).toHaveText("Sales Rep");
    await page.goto(href!);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  });

  test("global search finds visible records", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.keyboard.press("Control+k");
    await page.getByPlaceholder("Search records or go to page…").fill("Brennholt");
    await expect(page.getByRole("option", { name: /Brennholt Foundry Works/ }).first()).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/companies\/[0-9a-f-]{36}$/);
  });
});
