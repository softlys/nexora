import { describe, expect, it } from "vitest";
import { receiveMessage } from "@/server/integrations/chat";
import { handleHook } from "@/server/integrations/hooks";
import { avitoSend, instagramSend } from "@/server/integrations/marketplaces";
import { createTestDb, ctxFor, DEMO_ORG_ID, DEMO_USER_IDS } from "./helpers/services";

const env = { AVITO_CLIENT_ID: "id", AVITO_CLIENT_SECRET: "secret", AVITO_USER_ID: "12345", AVITO_WEBHOOK_SECRET: "hook-secret", INSTAGRAM_ACCESS_TOKEN: "ig-token" } as unknown as NodeJS.ProcessEnv;

function fakeFetch(responses: Record<string, unknown>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const key = Object.keys(responses).find((k) => url.includes(k));
    return new Response(JSON.stringify(key ? responses[key] : {}), { status: key ? 200 : 404 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("Avito and Instagram", () => {
  it("sends Avito replies with a client-credentials token", async () => {
    const f = fakeFetch({ "/token": { access_token: "tok", expires_in: 86400 }, "/messages": { id: "m1" } });
    expect(await avitoSend("u2i-abc", "Здравствуйте!", env, f.impl)).toEqual({ id: "m1" });
    const send = f.calls.find((c) => c.url.includes("/messages"))!;
    expect(send.url).toBe("https://api.avito.ru/messenger/v1/accounts/12345/chats/u2i-abc/messages");
    expect(JSON.parse(String(send.init!.body))).toEqual({ message: { text: "Здравствуйте!" }, type: "text" });
    expect((send.init!.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("sends Instagram replies to the sender id", async () => {
    const f = fakeFetch({ "/me/messages": { message_id: "ig1" } });
    expect(await instagramSend("178414", "Hi", env, f.impl)).toEqual({ id: "ig1" });
    expect(JSON.parse(String(f.calls[0]!.init!.body))).toEqual({ recipient: { id: "178414" }, message: { text: "Hi" } });
  });

  it("rejects webhooks without the secret or signature", async () => {
    Object.assign(process.env, env, { INSTAGRAM_APP_SECRET: "app-secret" });
    const avito = await handleHook("POST", new Request("https://crm.example/api/hooks/avito?secret=wrong", { method: "POST", body: "{}" }), "avito", []);
    expect(avito.status).toBe(401);
    const ig = await handleHook("POST", new Request("https://crm.example/api/hooks/instagram", { method: "POST", body: "{}", headers: { "x-hub-signature-256": "sha256=00" } }), "instagram", []);
    expect(ig.status).toBe(401);
  });

  it("files Avito chats in the inbox as leads", async () => {
    const { db, data } = createTestDb();
    const got = await db.write(DEMO_ORG_ID, (tx) => receiveMessage(tx, ctxFor(db, data(), DEMO_USER_IDS.admin), { channel: "avito", chat: "u2i-xyz", name: "Сергей", text: "Ещё продаёте?", messageId: "av-1" }));
    expect(got!.conversation).toMatchObject({ channel: "avito", title: "Сергей" });
    expect(data().leads.find((l) => l.id === got!.conversation.lead_id)?.title).toMatch(/^Avito: Сергей/);
  });
});
