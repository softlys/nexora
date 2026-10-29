import "server-only";

/**
 * Avito Messenger and Instagram Direct for the unified inbox. Credentials come from the environment.
 *
 * Avito (business account, Messenger API):
 *   AVITO_CLIENT_ID, AVITO_CLIENT_SECRET  developer app (avito.ru/professionals/api)
 *   AVITO_USER_ID                         the account number (profile → "Номер профиля")
 *   AVITO_WEBHOOK_SECRET                  any random string; it is part of the webhook address
 * Instagram (professional account, Instagram API with Instagram Login):
 *   INSTAGRAM_ACCESS_TOKEN                long-lived token with instagram_business_manage_messages
 *   INSTAGRAM_APP_SECRET                  the Meta app secret, to check webhook signatures
 *   INSTAGRAM_VERIFY_TOKEN                any random string, entered when subscribing the webhook
 */

const timeout = (ms = 8000) => AbortSignal.timeout(ms);

export function avitoConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    clientId: env.AVITO_CLIENT_ID?.trim() || null,
    clientSecret: env.AVITO_CLIENT_SECRET?.trim() || null,
    userId: env.AVITO_USER_ID?.trim() && /^\d{1,20}$/.test(env.AVITO_USER_ID.trim()) ? env.AVITO_USER_ID.trim() : null,
    webhookSecret: env.AVITO_WEBHOOK_SECRET?.trim() || null,
  };
}

export function instagramConfig(env: NodeJS.ProcessEnv = process.env) {
  return { token: env.INSTAGRAM_ACCESS_TOKEN?.trim() || null, appSecret: env.INSTAGRAM_APP_SECRET?.trim() || null, verifyToken: env.INSTAGRAM_VERIFY_TOKEN?.trim() || null };
}

let avitoToken: { value: string; until: number } | null = null;

/** An Avito access token (client credentials, cached until a minute before it expires). */
export async function avitoAccessToken(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): Promise<string> {
  if (avitoToken && avitoToken.until > Date.now()) return avitoToken.value;
  const c = avitoConfig(env);
  if (!c.clientId || !c.clientSecret) throw new Error("Avito is not configured.");
  const res = await fetchImpl("https://api.avito.ru/token", { method: "POST", body: new URLSearchParams({ grant_type: "client_credentials", client_id: c.clientId, client_secret: c.clientSecret }), signal: timeout() });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !body.access_token) throw new Error(`Avito refused the credentials: ${body.error_description ?? `HTTP ${res.status}`}`);
  avitoToken = { value: body.access_token, until: Date.now() + Math.max(60, (body.expires_in ?? 3600) - 60) * 1000 };
  return avitoToken.value;
}

export async function avitoSend(chat: string, text: string, env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): Promise<{ id: string | null }> {
  const c = avitoConfig(env);
  if (!c.userId) throw new Error("AVITO_USER_ID is missing.");
  const token = await avitoAccessToken(env, fetchImpl);
  const res = await fetchImpl(`https://api.avito.ru/messenger/v1/accounts/${c.userId}/chats/${encodeURIComponent(chat)}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { text: text.slice(0, 1000) }, type: "text" }),
    signal: timeout(),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!res.ok) throw new Error(`Avito refused the message: ${body.error?.message ?? `HTTP ${res.status}`}`);
  return { id: body.id ?? null };
}

/** The customer's name and the listing the chat is about, when Avito tells us. */
export async function avitoChatInfo(chat: string, authorId: string, env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): Promise<{ name: string; item: string }> {
  try {
    const c = avitoConfig(env);
    const token = await avitoAccessToken(env, fetchImpl);
    const res = await fetchImpl(`https://api.avito.ru/messenger/v2/accounts/${c.userId}/chats/${encodeURIComponent(chat)}`, { headers: { Authorization: `Bearer ${token}` }, signal: timeout() });
    const body = (await res.json()) as { users?: Array<{ id?: number; name?: string }>; context?: { value?: { title?: string } } };
    return { name: body.users?.find((u) => String(u.id) === authorId)?.name ?? "", item: body.context?.value?.title ?? "" };
  } catch {
    return { name: "", item: "" };
  }
}

export async function instagramSend(recipient: string, text: string, env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): Promise<{ id: string | null }> {
  const c = instagramConfig(env);
  if (!c.token) throw new Error("Instagram is not configured.");
  const res = await fetchImpl("https://graph.instagram.com/v21.0/me/messages", {
    method: "POST",
    headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: recipient }, message: { text: text.slice(0, 1000) } }),
    signal: timeout(),
  });
  const body = (await res.json().catch(() => ({}))) as { message_id?: string; error?: { message?: string } };
  if (!res.ok || body.error) throw new Error(`Instagram refused the message: ${body.error?.message ?? `HTTP ${res.status}`}`);
  return { id: body.message_id ?? null };
}

/** The sender's @username, when the token may read it. */
export async function instagramName(userId: string, env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): Promise<{ name: string; username: string }> {
  try {
    const c = instagramConfig(env);
    const res = await fetchImpl(`https://graph.instagram.com/v21.0/${encodeURIComponent(userId)}?fields=name,username`, { headers: { Authorization: `Bearer ${c.token}` }, signal: timeout() });
    const body = (await res.json()) as { name?: string; username?: string };
    return { name: body.name ?? "", username: body.username ?? "" };
  } catch {
    return { name: "", username: "" };
  }
}
