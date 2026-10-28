import { finishInbound, inboundContext, InboundConfigError } from "@/server/integrations/inbound";
import { unsubscribe } from "@/server/services/campaigns";
import { serverSecret } from "@/server/session-signing";
import { locale } from "@/lib/i18n";

/** The unsubscribe link in mailings: no sign-in, a signed token per contact. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const ru = locale() === "ru";
  const page = (title: string, text: string, status = 200) =>
    new Response(`<!doctype html><html lang="${ru ? "ru" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#222"><h1 style="font-size:1.4rem">${title}</h1><p>${text}</p></body></html>`, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  try {
    const ctx = await inboundContext({ ip: null, user_agent: request.headers.get("user-agent")?.slice(0, 512) ?? null, request_id: crypto.randomUUID() });
    const ok = await unsubscribe(ctx, url.searchParams.get("c") ?? "", url.searchParams.get("t") ?? "", await serverSecret());
    await finishInbound(ctx);
    if (!ok) return page(ru ? "Ссылка недействительна" : "Invalid link", ru ? "Не удалось отписаться по этой ссылке." : "This unsubscribe link is not valid.", 400);
    return page(ru ? "Вы отписались" : "You are unsubscribed", ru ? "Мы больше не будем присылать вам рассылки." : "You will not receive our mailings any more.");
  } catch (error) {
    if (error instanceof InboundConfigError) return page("Error", "Not available.", 503);
    throw error;
  }
}
