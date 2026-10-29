import { ROLE_LABELS } from "@/lib/format";
import { requirePermission } from "@/server/guards";
import Link from "next/link";
import { SettingsCard } from "@/components/patterns/form-field";
import { ProfileForm } from "./profile-form";
import { tr } from "@/lib/i18n";
import { personalBotConfig, telegramLinkToken } from "@/server/integrations/personal-telegram";
import { serverSecret } from "@/server/session-signing";

export const metadata = { title: tr("Profile") };

export default async function ProfileSettingsPage() {
  const { user } = await requirePermission("update", "profile");
  const bot = personalBotConfig();
  const telegramLink = bot.token && bot.username ? `https://t.me/${bot.username}?start=${telegramLinkToken(user.profile.id, await serverSecret())}` : null;
  return (
    <div className="space-y-6">
    <ProfileForm
      defaults={{ full_name: user.profile.full_name, title: user.profile.title, phone_extension: user.profile.phone_extension ?? "" }}
      email={user.profile.email}
      roleLabel={ROLE_LABELS[user.profile.role]!}
    />
      <SettingsCard title={tr("Notifications in Telegram")} description={tr("New leads, overdue tasks and other notifications in your Telegram.")}>
        {user.profile.telegram_chat_id ? (
          <p className="text-sm" data-testid="telegram-linked">
            {tr("Linked. To turn notifications off, send /stop to the bot.")}
          </p>
        ) : telegramLink ? (
          <a href={telegramLink} target="_blank" rel="noreferrer" className="text-sm text-brand hover:underline" data-testid="telegram-link">
            {tr("Open the bot in Telegram and press Start")}
          </a>
        ) : (
          <p className="text-sm text-text-muted">{tr("An admin needs to connect the Telegram bot first (TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_USERNAME).")}</p>
        )}
      </SettingsCard>
      <SettingsCard title={tr("Two-factor sign-in")} description={tr("A code from an authenticator app after the password.")}>
        <Link href="/two-factor" className="text-sm text-brand hover:underline" data-testid="two-factor-link">
          {tr("Set up or change two-factor sign-in")}
        </Link>
      </SettingsCard>
    </div>
  );
}
