import { expect, test } from "@playwright/test";

test.describe("unified inbox", () => {
  test("a website visitor writes, a manager replies from the inbox, the visitor gets the reply", async ({ page, request }) => {
    const session = crypto.randomUUID();
    const sent = await request.post("/api/chat", { data: { session, text: "Do you deliver to Kazan?", name: "E2E Visitor" } });
    expect(sent.ok()).toBe(true);

    await page.goto("/inbox?channel=site");
    await page.getByTestId("conversations").getByText("E2E Visitor").click();
    const thread = page.getByTestId("conversation");
    await expect(thread.getByText("Do you deliver to Kazan?")).toBeVisible();
    await page.getByTestId("reply-text").fill("Yes, within three days.");
    await page.getByTestId("reply-send").click();
    await expect(thread.getByText("Yes, within three days.")).toBeVisible();

    const replies = await (await request.get(`/api/chat?session=${session}`)).json();
    expect(replies.messages.map((m: { direction: string; body: string }) => [m.direction, m.body])).toEqual([
      ["in", "Do you deliver to Kazan?"],
      ["out", "Yes, within three days."],
    ]);
  });
});
