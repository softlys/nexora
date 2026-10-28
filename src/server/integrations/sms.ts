import "server-only";

/**
 * SMS through SMS.ru (SMSRU_API_ID from sms.ru → Программистам). Numbers are sent as digits;
 * Russian numbers starting with 8 are turned into 7….
 */
export type SmsSender = { readonly configured: boolean; send(to: string, text: string): Promise<{ id: string }> };

export function smsNumber(phone: string | null | undefined): string | null {
  let digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) digits = `7${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith("9")) digits = `7${digits}`;
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

export function smsSender(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): SmsSender {
  const apiId = env.SMSRU_API_ID?.trim();
  const from = env.SMSRU_FROM?.trim();
  return {
    configured: Boolean(apiId),
    async send(to, text) {
      if (!apiId) throw new Error("SMS is not configured.");
      const body = new URLSearchParams({ api_id: apiId, to, msg: text.slice(0, 1000), json: "1", ...(from && { from }) });
      const res = await fetchImpl("https://sms.ru/sms/send", { method: "POST", body, signal: AbortSignal.timeout(10_000) });
      const data = (await res.json().catch(() => ({}))) as { status?: string; status_text?: string; sms?: Record<string, { status?: string; sms_id?: string; status_text?: string }> };
      const item = data.sms?.[to];
      if (!res.ok || data.status !== "OK" || item?.status !== "OK") throw new Error(`SMS.ru: ${item?.status_text ?? data.status_text ?? `HTTP ${res.status}`}`);
      return { id: item.sms_id ?? "unknown" };
    },
  };
}
