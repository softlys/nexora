import { createHash, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finishInbound, inboundContext, InboundConfigError } from "@/server/integrations/inbound";
import { applyOrderUpdates, markOrdersExported, onecConfig, ordersForOnec, parseCatalog, parseOffers, parseOrderUpdates, syncCatalog } from "@/server/integrations/onec";

/**
 * 1C "Обмен с сайтом" endpoint (CommerceML 2). In 1C: Администрирование → Обмен с сайтом →
 * address https://<host>/api/1c/exchange, user ONEC_LOGIN, password ONEC_PASSWORD.
 *
 *   type=catalog  checkauth → init → file (import.xml, offers.xml) → import
 *   type=sale     checkauth → init → query (orders for 1C) → success; file (documents from 1C)
 */

const COOKIE = "nexora_1c";
const reply = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** A session token derived from the credentials and the day, so no server-side session is needed. */
function sessionToken(login: string, password: string, day = new Date().toISOString().slice(0, 10)): string {
  return createHash("sha256").update(`${login}:${password}:${day}:nexora-1c`).digest("hex");
}

function authorized(request: Request): boolean {
  const { login, password, configured } = onecConfig();
  if (!configured || !login || !password) return false;
  const basic = request.headers.get("authorization") ?? "";
  if (basic.startsWith("Basic ")) {
    const [user, ...rest] = Buffer.from(basic.slice(6), "base64").toString("utf8").split(":");
    if (same(user ?? "", login) && same(rest.join(":"), password)) return true;
  }
  const cookie = (request.headers.get("cookie") ?? "").split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) ?? "";
  return cookie.length === 64 && same(cookie, sessionToken(login, password));
}

/** Uploaded files wait in the temp folder until 1C asks to import them. */
const fileDir = join(tmpdir(), "nexora-1c");
const safeName = (name: string | null) => (name ?? "").split(/[\\/]/).pop()!.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 100);

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  const mode = url.searchParams.get("mode");
  if (!onecConfig().configured) return reply("failure\n1C exchange is not configured (ONEC_LOGIN, ONEC_PASSWORD).", 503);
  if (!authorized(request)) return reply("failure\nWrong login or password.", 401);
  const { login, password } = onecConfig();

  if (mode === "checkauth") return reply(`success\n${COOKIE}\n${sessionToken(login!, password!)}\n`);
  if (mode === "init") return reply("zip=no\nfile_limit=50000000\n");

  try {
    const ctx = await inboundContext({ ip: null, user_agent: request.headers.get("user-agent")?.slice(0, 512) ?? "1C", request_id: crypto.randomUUID() });
    const org = await ctx.db.read(ctx.actor.organization_id, (tx) => tx.get("organizations", ctx.actor.organization_id));
    const currency = org?.currency ?? "RUB";

    if (type === "catalog" && mode === "file") {
      const name = safeName(url.searchParams.get("filename"));
      if (!name.endsWith(".xml")) return reply("success\n"); // pictures and other files are not used
      await mkdir(fileDir, { recursive: true });
      await writeFile(join(fileDir, name), Buffer.from(await request.arrayBuffer()), { flag: url.searchParams.get("append") ? "a" : "w" });
      return reply("success\n");
    }
    if (type === "catalog" && mode === "import") {
      const name = safeName(url.searchParams.get("filename"));
      const xml = await readFile(join(fileDir, name), "utf8").catch(() => null);
      if (xml === null) return reply(`failure\nFile ${name} was not uploaded.`);
      const result = name.startsWith("offers") ? await syncCatalog(ctx, [], parseOffers(xml), currency) : await syncCatalog(ctx, parseCatalog(xml), name.startsWith("import") ? [] : parseOffers(xml), currency);
      await finishInbound(ctx);
      return reply(`success\nProducts: ${result.created} created, ${result.updated} updated\n`);
    }
    if (type === "sale" && mode === "query") {
      const { xml, until } = await ordersForOnec(ctx);
      // The export point is remembered until 1C confirms it with mode=success.
      await mkdir(fileDir, { recursive: true });
      await writeFile(join(fileDir, "orders-until.txt"), until);
      return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" } });
    }
    if (type === "sale" && mode === "success") {
      const until = await readFile(join(fileDir, "orders-until.txt"), "utf8").catch(() => null);
      if (until) await markOrdersExported(ctx, until.trim());
      return reply("success\n");
    }
    if (type === "sale" && mode === "file") {
      const xml = Buffer.from(await request.arrayBuffer()).toString("utf8");
      const result = await applyOrderUpdates(ctx, parseOrderUpdates(xml));
      await finishInbound(ctx);
      return reply(`success\nOrders confirmed: ${result.confirmed}, payments: ${result.paid}\n`);
    }
    return reply("failure\nUnknown request.", 400);
  } catch (error) {
    if (error instanceof InboundConfigError) return reply(`failure\n${error.message}`, 503);
    console.error("[1c] exchange failed", error);
    return reply("failure\nThe exchange failed; see the NEXORA server log.", 500);
  }
}

export const GET = handle;
export const POST = handle;
