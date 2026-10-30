import { hasDemoAccess } from "@/server/auth";
import { siteChatEnabled } from "@/server/integrations/chat";
import { locale } from "@/lib/i18n";

/** A sample company website with the chat widget, to try the website chat (and to show it in demos). */
export async function GET() {
  if (!siteChatEnabled() || !(await hasDemoAccess())) return new Response("Not found", { status: 404 });
  const ru = locale() === "ru";
  const html = `<!doctype html>
<html lang="${ru ? "ru" : "en"}">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${ru ? "Сайт компании — демо чата" : "Company website — chat demo"}</title>
<style>body{margin:0;font:16px/1.6 system-ui,sans-serif;background:#f4f4f8;color:#1b1b24}header{background:#1b1b24;color:#fff;padding:20px 24px}main{max-width:720px;margin:40px auto;padding:0 20px}.card{background:#fff;border-radius:12px;padding:24px;box-shadow:0 2px 8px rgba(0,0,0,.06)}</style>
</head>
<body>
<header><strong>Atlasford Industrial Supply</strong></header>
<main><div class="card">
<h1>${ru ? "Промышленное оборудование и запчасти" : "Industrial equipment and spare parts"}</h1>
<p>${ru ? "Это пример сайта клиента NEXORA. Нажмите «Напишите нам» в правом нижнем углу: сообщение придёт во «Входящие» NEXORA, а ответ менеджера появится здесь." : "This is a sample customer website. Click “Chat with us” in the bottom right corner: the message arrives in the NEXORA Inbox, and the manager's reply appears here."}</p>
</div></main>
<script src="/api/chat/widget" async></script>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
