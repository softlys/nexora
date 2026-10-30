import { hasDemoAccess } from "@/server/auth";
import { siteChatEnabled } from "@/server/integrations/chat";
import { locale } from "@/lib/i18n";

/**
 * The website chat widget script. Embed on any site:
 *   <script src="https://<nexora-host>/api/chat/widget" async></script>
 * It talks to /api/chat on the same host the script came from. Plain DOM, no dependencies, text only
 * (messages are inserted with textContent, never as HTML).
 */

const TEXTS = {
  en: { open: "Chat with us", title: "Questions? Write to us", name: "Your name", contact: "E-mail or phone (optional)", placeholder: "Type a message…", send: "Send", hello: "Hello! How can we help?", error: "The message was not sent. Please try again.", consent: "By sending a message you agree to the processing of your personal data", policy: "policy" },
  ru: { open: "Напишите нам", title: "Есть вопрос? Напишите нам", name: "Ваше имя", contact: "E-mail или телефон (необязательно)", placeholder: "Введите сообщение…", send: "Отправить", hello: "Здравствуйте! Чем можем помочь?", error: "Сообщение не отправлено. Попробуйте ещё раз.", consent: "Отправляя сообщение, вы соглашаетесь на обработку персональных данных", policy: "политика" },
};

function script(texts: (typeof TEXTS)["en"], policyUrl: string | null): string {
  return `(() => {
  if (window.__nexoraChat) return; window.__nexoraChat = true;
  const T = ${JSON.stringify(texts)};
  const POLICY = ${JSON.stringify(policyUrl)};
  const src = (document.currentScript && document.currentScript.src) || "";
  const base = src ? new URL(src).origin : location.origin;
  const KEY = "nexora-chat-session";
  let session = null;
  try { session = localStorage.getItem(KEY); } catch (e) {}
  if (!session) { session = crypto.randomUUID(); try { localStorage.setItem(KEY, session); } catch (e) {} }
  // UTM tags of the visit that brought the visitor, kept for the first message (end-to-end analytics).
  let utm = null;
  try {
    const q = new URLSearchParams(location.search), found = {};
    for (const k of ["source", "medium", "campaign", "content", "term"]) { const v = q.get("utm_" + k); if (v) found[k] = v.slice(0, 200); }
    if (Object.keys(found).length) localStorage.setItem("nexora-chat-utm", JSON.stringify(found));
    utm = JSON.parse(localStorage.getItem("nexora-chat-utm") || "null");
  } catch (e) {}
  let after = "", sent = 0, timer = null;
  const css = "#nx-chat{position:fixed;right:20px;bottom:20px;z-index:2147483000;font:14px/1.4 system-ui,sans-serif;color:#111}"
    + "#nx-chat button{font:inherit;cursor:pointer}"
    + "#nx-open{background:#5b4bff;color:#fff;border:0;border-radius:999px;padding:12px 18px;box-shadow:0 6px 20px rgba(0,0,0,.2)}"
    + "#nx-panel{display:none;width:min(340px,calc(100vw - 40px));height:440px;background:#fff;border:1px solid #ddd;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.2);flex-direction:column;overflow:hidden}"
    + "#nx-head{background:#5b4bff;color:#fff;padding:12px 14px;display:flex;justify-content:space-between;align-items:center}"
    + "#nx-head button{background:none;border:0;color:#fff;font-size:18px}"
    + "#nx-list{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;background:#f7f7fb}"
    + ".nx-m{max-width:80%;padding:8px 10px;border-radius:10px;white-space:pre-wrap;word-wrap:break-word}"
    + ".nx-in{align-self:flex-end;background:#5b4bff;color:#fff}.nx-out{align-self:flex-start;background:#fff;border:1px solid #e3e3ea}"
    + "#nx-form{border-top:1px solid #eee;padding:8px;display:flex;flex-direction:column;gap:6px}"
    + "#nx-form input,#nx-form textarea{font:inherit;border:1px solid #ccc;border-radius:8px;padding:7px 9px;resize:none}"
    + "#nx-row{display:flex;gap:6px}#nx-row textarea{flex:1}#nx-send{background:#5b4bff;color:#fff;border:0;border-radius:8px;padding:0 12px}"
    + "#nx-err{color:#c00;font-size:12px;display:none}#nx-consent{color:#777;font-size:11px}#nx-consent a{color:#5b4bff}";
  const style = document.createElement("style"); style.textContent = css; document.head.appendChild(style);
  const root = document.createElement("div"); root.id = "nx-chat";
  root.innerHTML = '<div id="nx-panel" role="dialog"><div id="nx-head"><strong></strong><button type="button" aria-label="Close">×</button></div><div id="nx-list" aria-live="polite"></div>'
    + '<form id="nx-form"><input id="nx-name" maxlength="80"><input id="nx-contact" maxlength="120"><div id="nx-row"><textarea id="nx-text" rows="2" maxlength="2000" required></textarea><button id="nx-send" type="submit"></button></div><div id="nx-err"></div><div id="nx-consent"></div></form></div>'
    + '<button id="nx-open" type="button"></button>';
  document.body.appendChild(root);
  const $ = (id) => root.querySelector("#" + id);
  $("nx-head").querySelector("strong").textContent = T.title;
  $("nx-open").textContent = T.open; $("nx-send").textContent = T.send;
  $("nx-name").placeholder = T.name; $("nx-contact").placeholder = T.contact; $("nx-text").placeholder = T.placeholder;
  $("nx-err").textContent = T.error;
  // 152-FZ: consent to the processing of personal data, with a link to the policy when one is set.
  $("nx-consent").textContent = T.consent + (POLICY ? " (" : ".");
  if (POLICY) { const a = document.createElement("a"); a.href = POLICY; a.target = "_blank"; a.rel = "noopener"; a.textContent = T.policy; $("nx-consent").append(a, ")."); }
  const add = (direction, body) => { const m = document.createElement("div"); m.className = "nx-m " + (direction === "in" ? "nx-in" : "nx-out"); m.textContent = body; $("nx-list").appendChild(m); $("nx-list").scrollTop = 1e9; };
  add("out", T.hello);
  const poll = async () => {
    try {
      const r = await fetch(base + "/api/chat?session=" + encodeURIComponent(session) + "&after=" + encodeURIComponent(after));
      if (!r.ok) return;
      const data = await r.json();
      for (const m of data.messages || []) { after = m.created_at; if (m.direction === "in" && sent > 0) { sent--; continue; } add(m.direction, m.body); }
      if ((data.messages || []).some((m) => m.direction === "in")) { $("nx-name").style.display = "none"; $("nx-contact").style.display = "none"; }
    } catch (e) {}
  };
  const open = (yes) => { $("nx-panel").style.display = yes ? "flex" : "none"; $("nx-open").style.display = yes ? "none" : "inline-block"; if (yes) { poll(); timer = setInterval(poll, 4000); } else clearInterval(timer); };
  $("nx-open").addEventListener("click", () => open(true));
  $("nx-head").querySelector("button").addEventListener("click", () => open(false));
  $("nx-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = $("nx-text").value.trim(); if (!text) return;
    $("nx-err").style.display = "none";
    const body = { session, text };
    if (utm) body.utm = utm;
    if ($("nx-name").value.trim()) body.name = $("nx-name").value.trim();
    if ($("nx-contact").value.trim()) body.contact = $("nx-contact").value.trim();
    try {
      const r = await fetch(base + "/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error();
      add("in", text); sent++; $("nx-text").value = "";
      $("nx-name").style.display = "none"; $("nx-contact").style.display = "none";
    } catch (err) { $("nx-err").style.display = "block"; }
  });
})();`;
}

export async function GET() {
  if (!siteChatEnabled() || !(await hasDemoAccess())) return new Response("/* NEXORA website chat is not enabled (NEXORA_SITE_CHAT=on). */", { status: 404, headers: { "Content-Type": "text/javascript; charset=utf-8" } });
  const policy = process.env.NEXORA_PRIVACY_URL?.trim();
  return new Response(script(TEXTS[locale() === "ru" ? "ru" : "en"], policy && /^https:\/\//.test(policy) ? policy : null), { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } });
}
