import { describe, expect, it } from "vitest";
import { createReminderNotifications, pushNotificationsToTelegram, telegramLinkToken, userFromLinkToken } from "@/server/integrations/personal-telegram";
import { createTestDb, DEMO_ORG_ID, DEMO_USER_IDS, NOW } from "./helpers/services";

describe("personal Telegram notifications", () => {
  it("signs the /start link for one user", () => {
    const token = telegramLinkToken(DEMO_USER_IDS.repDaniel, "s3cret");
    expect(token).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(userFromLinkToken(token, "s3cret")).toBe(DEMO_USER_IDS.repDaniel);
    expect(userFromLinkToken(token, "other")).toBeNull();
    expect(userFromLinkToken(token.replace(/.$/, (c) => (c === "0" ? "1" : "0")), "s3cret")).toBeNull();
  });

  it("reminds about new leads and overdue tasks once, then sends them to linked chats", async () => {
    const { db, data } = createTestDb();
    const lead = data().leads.find((l) => l.status === "new" && !l.archived_at)!;
    const task = data().tasks.find((t) => t.status === "todo" && !t.archived_at)!;
    const now = new Date(NOW.getTime() + 60_000);
    await db.write(DEMO_ORG_ID, async (tx) => {
      await tx.update("leads", lead.id, { created_at: NOW.toISOString(), owner_id: DEMO_USER_IDS.repDaniel });
      await tx.update("tasks", task.id, { due_at: NOW.toISOString(), assignee_id: DEMO_USER_IDS.repDaniel });
      await tx.update("profiles", DEMO_USER_IDS.repDaniel, { telegram_chat_id: "12345" });
    });
    const first = await createReminderNotifications(db, DEMO_ORG_ID, now);
    expect(first.leads).toBeGreaterThan(0);
    expect(first.tasks).toBeGreaterThan(0);
    expect(await createReminderNotifications(db, DEMO_ORG_ID, now)).toEqual({ leads: 0, tasks: 0 });
    const mine = data().notifications.filter((n) => n.recipient_id === DEMO_USER_IDS.repDaniel && (n.dedupe_key === `lead-new:${lead.id}:${DEMO_USER_IDS.repDaniel}` || n.dedupe_key === `task-overdue:${task.id}`));
    expect(mine).toHaveLength(2);

    const sent: Array<[string, string]> = [];
    const result = await pushNotificationsToTelegram(db, DEMO_ORG_ID, async (chat, text) => void sent.push([chat, text]), "https://crm.example", now);
    expect(result.failed).toBe(0);
    expect(sent.every(([chat]) => chat === "12345")).toBe(true);
    expect(sent.some(([, text]) => text.includes(lead.title) && text.includes(`https://crm.example/leads/${lead.id}`))).toBe(true);
    expect((await pushNotificationsToTelegram(db, DEMO_ORG_ID, async () => undefined, "https://crm.example")).sent).toBe(0);
  });
});
