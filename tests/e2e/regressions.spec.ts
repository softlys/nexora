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

  test("the create API key dialog starts from the defaults every time", async ({ page }) => {
    await page.goto("/settings/api-keys");
    await page.getByRole("button", { name: "Create API key" }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill(`Reset check ${stamp}`);
    await dialog.getByRole("checkbox", { name: "leads:write" }).click();
    await dialog.getByRole("checkbox", { name: "records:read" }).click();
    await dialog.getByRole("button", { name: "Create key" }).click();
    await page.getByRole("button", { name: "I saved it" }).click();

    await page.getByRole("button", { name: "Create API key" }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Name")).toHaveValue("");
    await expect(dialog.getByRole("checkbox", { name: "leads:write" })).toBeChecked();
    await expect(dialog.getByRole("checkbox", { name: "records:read" })).not.toBeChecked();
  });

  test("contacts keep messenger handles and show chat links", async ({ page }) => {
    await page.goto("/contacts");
    await page.locator('main a[href^="/contacts/"]').first().click();
    await page.getByRole("button", { name: "Edit" }).first().click();
    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("Telegram").fill("@qa_contact_tg");
    await sheet.getByLabel("WhatsApp").fill("+7 (999) 123-45-67");
    await sheet.getByLabel("Instagram").fill("not a handle!!");
    await sheet.getByRole("button", { name: "Save changes" }).click();
    await expect(sheet.getByText(/Not a valid Instagram value/)).toBeVisible();
    await sheet.getByLabel("Instagram").fill("");
    await sheet.getByRole("button", { name: "Save changes" }).click();
    const links = page.getByTestId("messenger-links");
    await expect(links).toContainText("@qa_contact_tg");
    await expect(links.getByRole("link", { name: "Write on Telegram" })).toHaveAttribute("href", "https://t.me/qa_contact_tg");
    await expect(links.getByRole("link", { name: "Write on WhatsApp" })).toHaveAttribute("href", "https://wa.me/79991234567");
  });

  test("every country can be chosen, Russia included", async ({ page }) => {
    await page.goto("/companies?new=1");
    const sheet = page.getByRole("dialog");
    await sheet.getByRole("combobox", { name: "Country" }).click();
    await page.getByPlaceholder("Search…", { exact: true }).fill("Russ");
    await expect(page.getByRole("option", { name: "Russia" })).toBeVisible();
  });

  test("integrations list Telegram and messenger channels", async ({ page }) => {
    await page.goto("/integrations");
    await expect(page.getByTestId("integration-card-telegram")).toContainText("Not configured");
    await page.getByTestId("integration-card-messengers").click();
    await expect(page.getByRole("heading", { level: 1, name: "Messengers and social" })).toBeVisible();
    for (const c of ["whatsapp", "instagram", "viber", "vk", "facebook", "wechat"]) await expect(page.getByTestId(`messenger-guide-${c}`)).toBeVisible();
  });
});

