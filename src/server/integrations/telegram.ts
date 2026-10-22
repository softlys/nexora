import "server-only";

/**
 * Telegram bot for team notifications (the "Send to Telegram" workflow step and the test button).
 *
 * Configured like email, through the environment, so the bot token never enters the database:
 *   TELEGRAM_BOT_TOKEN  token from @BotFather, e.g. 123456789:AA…
 *   TELEGRAM_CHAT_ID    the group, channel or user the bot writes to (e.g. -1001234567890 or @channel)
 * Messages are sent as plain text (no parse mode), so record data cannot inject markup.
 */
export type TelegramSender = {
  readonly configured: boolean;
  /** Where messages go, for display; never the token. */
  readonly chat: string | null;
  send(text: string): Promise<{ message_id: number }>;
};

const TOKEN = /^\d{5,12}:[A-Za-z0-9_-]{30,64}$/;
const CHAT = /^(-?\d{5,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$/;
export const TELEGRAM_MAX_TEXT = 4096;

export function telegramConfig(env: NodeJS.ProcessEnv = process.env): { token: string | null; chat: string | null; problem: string | null } {
  const token = env.TELEGRAM_BOT_TOKEN?.trim() || null;
  const chat = env.TELEGRAM_CHAT_ID?.trim() || null;
  if (!token && !chat) return { token: null, chat: null, problem: null };
  if (!token || !TOKEN.test(token)) return { token: null, chat, problem: "TELEGRAM_BOT_TOKEN is missing or does not look like a bot token (digits:letters)." };
  if (!chat || !CHAT.test(chat)) return { token, chat: null, problem: "TELEGRAM_CHAT_ID is missing or invalid: use a numeric chat id (groups start with -100) or @channelname." };
  return { token, chat, problem: null };
}

export function telegramSender(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): TelegramSender {
  const { token, chat, problem } = telegramConfig(env);
  return {
    configured: Boolean(token && chat && !problem),
    chat,
    async send(text: string) {
      if (!token || !chat) throw new Error(problem ?? "Telegram is not configured.");
      const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text: text.slice(0, TELEGRAM_MAX_TEXT), disable_web_page_preview: true }),
        signal: AbortSignal.timeout(5_000),
      });
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: { message_id?: number } };
      // Telegram's error descriptions never contain the token; still, never echo the URL.
      if (!response.ok || !body.ok) throw new Error(`Telegram refused the message: ${body.description ?? `HTTP ${response.status}`}`);
      return { message_id: body.result?.message_id ?? 0 };
    },
  };
}
