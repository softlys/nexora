import { expect, test, type Page } from "@playwright/test";

const stamp = Date.now().toString(36);
const LEAD = `Packaging line retrofit ${stamp}`;
const COMPANY = `Nordvik Packaging ${stamp}`;
const CONTACT = `Mara Example ${stamp}`;
const AMOUNT = 73_500;

async function wonDealValue(page: Page): Promise<number> {
  await page.goto("/");
  const card = page.getByRole("link", { name: /Won deal value/ });
  const text = await card.innerText();
  return Number(text.match(/\$([\d,]+)/)![1]!.replace(/,/g, ""));
}

test.describe("main journey", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("lead via API → follow-up task → deal → Won → one order → dashboard updates", async ({ page, request }) => {
    // An admin creates an integration key in Settings; it is shown once.
    await page.goto("/settings/api-keys");
    await page.getByRole("button", { name: "Create API key" }).click();
    await page.getByLabel("Name").fill(`Website form ${stamp}`);
    await page.getByRole("button", { name: "Create key" }).click();
    const key = (await page.getByTestId("revealed-secret").innerText()).trim();
    expect(key).toMatch(/^nxk_int_/);
    await page.getByRole("button", { name: "I saved it" }).click();
    await expect(page.getByTestId("api-key-row").filter({ hasText: `Website form ${stamp}` })).toContainText("leads:write");

    const before = await wonDealValue(page);

    // A website form submits the lead through the public API, twice with the same Idempotency-Key.
    const body = { title: LEAD, company_name: COMPANY, contact_name: CONTACT, email: `mara.${stamp}@nordvik.example`, country: "NO", estimated_value: AMOUNT, message: "Wants a quote this month." };
    const headers = { Authorization: `Bearer ${key}`, "Idempotency-Key": `form-${stamp}` };
    const created = await request.post("/api/v1/leads", { data: body, headers });
    expect(created.status()).toBe(201);
    const lead = (await created.json()).data;
    expect(lead).toMatchObject({ title: LEAD, source: "api", status: "new" });
    const replay = await request.post("/api/v1/leads", { data: body, headers });
    expect(replay.headers()["idempotent-replayed"]).toBe("true");
    expect((await replay.json()).data.id).toBe(lead.id);
    expect((await request.post("/api/v1/leads", { data: body, headers: { Authorization: "Bearer nxk_int_aaaaaaaa_wrongwrongwrongwrongwrongwrongwrong1" } })).status()).toBe(401);

    // The New lead automation assigned an owner and created the follow-up task.
    await page.goto(`/tasks?q=${encodeURIComponent(CONTACT)}`);
    await expect(page.getByRole("link", { name: `Follow up with ${CONTACT} at ${COMPANY}` })).toBeVisible();

    // Convert the lead into a deal and move it to Won.
    await page.goto(`/leads/${lead.id}`);
    await expect(page.getByRole("heading", { level: 1, name: LEAD })).toBeVisible();
    await page.getByRole("button", { name: "Convert to deal" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue(COMPANY);
    await dialog.getByLabel("Industry").fill("Packaging");
    await dialog.getByLabel("Amount").fill(String(AMOUNT));
    await dialog.getByRole("button", { name: "Convert" }).click();
    await expect(page).toHaveURL(/\/deals\/[0-9a-f-]{36}$/);
    await page.getByLabel("Deal stage").click();
    await page.getByRole("option", { name: "Won" }).click();
    await expect(page.getByText("Moved to Won")).toBeVisible();

    // The Deal won automation created exactly one order.
    await page.reload();
    const orderLink = page.getByRole("link", { name: /^Order NX-\d{4}-\d{4}$/ });
    await expect(orderLink).toBeVisible();
    await page.goto(`/orders?q=${encodeURIComponent(COMPANY)}`);
    await expect(page.getByRole("link", { name: /^NX-\d{4}-\d{4}$/ })).toHaveCount(1);

    // The dashboard includes the new won deal.
    expect(await wonDealValue(page)).toBe(before + AMOUNT);
  });

  test("integrations show an honest status and the API reference is generated from the schema", async ({ page, request }) => {
    await page.goto("/integrations");
    await expect(page.getByTestId("integration-card-make")).toContainText("Not configured");
    await expect(page.getByTestId("integration-card-email")).toContainText("Not configured");
    await page.getByRole("link", { name: "API reference" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "API reference" })).toBeVisible();
    const spec = await request.get("/api/v1/openapi.json");
    expect((await spec.json()).openapi).toBe("3.1.0");

    // Production refuses plain-http and private webhook URLs before anything is sent.
    await page.goto("/integrations/webhooks");
    await page.getByLabel("Webhook URL").fill("http://169.254.169.254/latest/meta-data");
    await page.getByRole("button", { name: "Save and create secret" }).click();
    await expect(page.locator("#webhook-url-error")).toContainText("https");
  });

  test("the UI kit renders tokens and offers the Tokens Studio export", async ({ page, request }) => {
    await page.goto("/ui-kit");
    await expect(page.getByRole("heading", { name: "Color tokens" })).toBeVisible();
    const res = await request.get("/ui-kit/tokens-studio.json");
    const json = await res.json();
    expect(json.$metadata.tokenSetOrder).toEqual(["core", "light", "dark"]);
    expect(json.light.color.accent.value).toBe("{color.accent.600}");
  });
});
