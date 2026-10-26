import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Dataset } from "@/domain/entities";
import type { Db } from "@/server/db/types";
import { dialable, processRinging, startCallback, zadarmaAuthorization, zadarmaSignature } from "@/server/integrations/telephony";
import { callSetup, currentIncomingCall, simulateIncomingCall, startCall } from "@/server/services/calls";
import { createTestDb, ctxFor, DEMO_USER_IDS } from "./helpers/services";

type Sent = { url: string; init?: RequestInit };
function fakeFetch(response: unknown = {}, ok = true) {
  const sent: Sent[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    sent.push({ url: String(url), init });
    return new Response(JSON.stringify(response), { status: ok ? 200 : 500 });
  }) as unknown as typeof fetch;
  return { fetchImpl, sent };
}

const MANGO = { mango: { key: "mkey", salt: "msalt" }, zadarma: null };
const ZADARMA = { mango: null, zadarma: { key: "zkey", secret: "zsecret" } };

describe("click-to-call through the PBX", () => {
  it("asks Mango Office to call the extension, then the number, with a signed command", async () => {
    const { fetchImpl, sent } = fakeFetch();
    await startCallback(MANGO, "101", "+7 (999) 123-45-67", fetchImpl);
    expect(sent[0]!.url).toBe("https://app.mango-office.ru/vpbx/commands/callback");
    const form = new URLSearchParams(String(sent[0]!.init!.body));
    const json = form.get("json")!;
    expect(JSON.parse(json)).toMatchObject({ from: { extension: "101" }, to_number: "79991234567" });
    expect(form.get("sign")).toBe(createHash("sha256").update("mkey" + json + "msalt").digest("hex"));
  });

  it("signs Zadarma's callback request as its API expects", async () => {
    const { fetchImpl, sent } = fakeFetch({ status: "success" });
    await startCallback(ZADARMA, "100", "8 999 123 45 67", fetchImpl);
    expect(sent[0]!.url).toBe("https://api.zadarma.com/v1/request/callback/?from=100&to=89991234567");
    const query = "from=100&to=89991234567";
    expect((sent[0]!.init!.headers as Record<string, string>).Authorization).toBe(`zkey:${zadarmaSignature("zsecret", "/v1/request/callback/" + query + createHash("md5").update(query).digest("hex"))}`);
    expect(zadarmaAuthorization("zkey", "zsecret", "/v1/request/callback/", { to: "89991234567", from: "100" })).toBe((sent[0]!.init!.headers as Record<string, string>).Authorization);
    await expect(startCallback(ZADARMA, "100", "8 999 123 45 67", fakeFetch({ status: "error", message: "wrong number" }).fetchImpl)).rejects.toThrow(/wrong number/);
    expect(dialable("+1 (555) 010-0200")).toBe("15550100200");
  });
});

describe("calls in the CRM", () => {
  let db: Db;
  let data: () => Dataset;
  beforeEach(() => {
    ({ db, data } = createTestDb());
  });
  const rep = () => ctxFor(db, data(), DEMO_USER_IDS.repDaniel);
  const admin = () => ctxFor(db, data(), DEMO_USER_IDS.admin);
  const setExtension = (userId: string, ext: string) => db.write(data().organizations[0]!.id, (tx) => tx.update("profiles", userId, { phone_extension: ext }));
  const repContact = () => data().contacts.find((c) => c.owner_id === DEMO_USER_IDS.repDaniel && c.phone && !c.archived_at)!;

  it("needs a provider and the user's internal number before calling", async () => {
    const contact = repContact();
    expect(await callSetup(rep(), { mango: null, zadarma: null })).toEqual({ callback: false, reason: "no_provider" });
    expect(await callSetup(rep(), MANGO)).toEqual({ callback: false, reason: "no_extension" });
    await expect(startCall(rep(), { entity: "contact", id: contact.id }, MANGO, fakeFetch().fetchImpl)).rejects.toThrow(/internal phone number/);
    await setExtension(DEMO_USER_IDS.repDaniel, "103");
    expect(await callSetup(rep(), MANGO)).toEqual({ callback: true, reason: "ready" });
    const { fetchImpl, sent } = fakeFetch();
    expect(await startCall(rep(), { entity: "contact", id: contact.id }, MANGO, fetchImpl)).toEqual({ provider: "mango", phone: contact.phone });
    expect(JSON.parse(new URLSearchParams(String(sent[0]!.init!.body)).get("json")!).from.extension).toBe("103");
    // Records the user cannot see cannot be called.
    const hidden = data().contacts.find((c) => c.owner_id === DEMO_USER_IDS.repSofia && c.phone)!;
    await expect(startCall(rep(), { entity: "contact", id: hidden.id }, MANGO, fetchImpl)).rejects.toThrow();
  });

  it("shows the caller's card to the user whose extension rings, else to the record's owner", async () => {
    const contact = repContact();
    await setExtension(DEMO_USER_IDS.manager, "200");
    await processRinging(admin(), { provider: "mango", id: "c1", customer: contact.phone!, extension: "200" });
    const toManager = data().notifications.filter((n) => n.type === "incoming_call");
    expect(toManager.map((n) => n.recipient_id)).toEqual([DEMO_USER_IDS.manager]);
    expect(toManager[0]).toMatchObject({ title: `Incoming call: ${contact.first_name} ${contact.last_name}`, link: `/contacts/${contact.id}` });

    // The same call again (a retried notification) adds nothing.
    await processRinging(admin(), { provider: "mango", id: "c1", customer: contact.phone!, extension: "200" });
    expect(data().notifications.filter((n) => n.type === "incoming_call")).toHaveLength(1);

    await processRinging(admin(), { provider: "zadarma", id: "c2", customer: contact.phone!, extension: null });
    expect(data().notifications.filter((n) => n.type === "incoming_call").at(-1)?.recipient_id).toBe(DEMO_USER_IDS.repDaniel);
    const card = await currentIncomingCall(rep());
    expect(card?.link).toBe(`/contacts/${contact.id}`);
  });

  it("simulates a call in demo mode for the current user", async () => {
    const { contact_id } = await simulateIncomingCall(rep());
    const card = await currentIncomingCall(rep());
    expect(card?.title).toMatch(/^Incoming call: /);
    expect(data().contacts.find((c) => c.id === contact_id)?.phone).toBeTruthy();
  });
});
