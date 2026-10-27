import { expect, test } from "@playwright/test";

test.describe("robots on pipeline stages", () => {
  test("an admin adds a task robot to a stage from the pipeline", async ({ page }) => {
    await page.goto("/pipeline");
    await page.getByTestId("robots-link").click();
    await expect(page).toHaveURL(/\/pipeline\/robots/);
    const stage = page.getByTestId("robot-stage-Proposal");
    await stage.getByRole("button", { name: "Robot" }).click();
    await page.getByRole("radio", { name: /Create a task/ }).click();
    await page.getByLabel("Task title").fill("Send the proposal to {{deal.company_name}}");
    await page.getByTestId("save-robot").click();
    await expect(page.getByText("Robot added to Proposal")).toBeVisible();
    await expect(stage.getByTestId("robot")).toContainText("Send the proposal to {{deal.company_name}}");
  });
});
