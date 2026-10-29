import "server-only";
import { tr } from "@/lib/i18n";
import { getServiceDb, listOrganizationIds } from "@/server/db";
import { serverSecret } from "@/server/session-signing";
import { userFromLinkToken } from "./personal-telegram";

/**
 * Handles /start <token> and /stop sent to the bot by a team member. Returns the bot's answer, or
 * null when the token is not a team member's link (then the message is a customer's, for the inbox).
 */
export async function linkPersonalChat(chatId: string, token: string | null): Promise<string | null> {
  const db = getServiceDb();
  const orgIds = await listOrganizationIds();
  if (token === null) {
    let unlinked = false;
    for (const orgId of orgIds) {
      await db.write(orgId, async (tx) => {
        for (const p of (await tx.find("profiles")).filter((x) => x.telegram_chat_id === chatId)) {
          await tx.update("profiles", p.id, { telegram_chat_id: null });
          unlinked = true;
        }
      });
    }
    return unlinked ? tr("NEXORA notifications are off. Link the bot again from your profile to turn them back on.") : null;
  }
  const userId = userFromLinkToken(token, await serverSecret());
  if (!userId) return null;
  for (const orgId of orgIds) {
    const name = await db.write(orgId, async (tx) => {
      const profile = await tx.get("profiles", userId);
      if (!profile || !profile.is_active) return null;
      await tx.update("profiles", profile.id, { telegram_chat_id: chatId });
      return profile.full_name;
    });
    if (name) return tr("{p0}, NEXORA notifications will now come here: new leads, overdue tasks and others. Send /stop to turn them off.", { p0: name });
  }
  return null;
}
