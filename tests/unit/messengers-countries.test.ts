import { describe, expect, it } from "vitest";
import { contactInput } from "@/domain/inputs";
import { COUNTRY_CODES, COUNTRY_OPTIONS, countryName, isCountryCode } from "@/lib/countries";
import { messengerLinks, messengersInput } from "@/lib/messengers";
import { telegramConfig, telegramSender } from "@/server/integrations/telegram";

describe("countries", () => {
  it("offers every ISO 3166-1 country, Russia included", () => {
    expect(COUNTRY_CODES).toHaveLength(249);
    expect(new Set(COUNTRY_CODES).size).toBe(249);
    expect(COUNTRY_OPTIONS.find((o) => o.value === "RU")?.label).toBe("Russia");
    for (const code of ["RU", "KZ", "BY", "UA", "AE", "UZ", "AM"]) expect(isCountryCode(code), code).toBe(true);
    expect(countryName("RU")).toBe("Russia");
  });

  it("rejects codes that are not countries", () => {
    for (const bad of ["XX", "ru", "RUS", "", "ZZ"]) expect(isCountryCode(bad), bad).toBe(false);
  });
});

describe("messengers on contacts", () => {
  const parse = (m: Record<string, string>) => messengersInput.safeParse(m);

  it("normalizes handles and phone numbers", () => {
    const r = parse({ telegram: "@Ivan_Petrov", whatsapp: "+7 (999) 123-45-67", instagram: "https://instagram.com/ivan.petrov/", vk: "vk.com/id12345", linkedin: "https://www.linkedin.com/in/ivan-petrov", viber: "" });
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ telegram: "Ivan_Petrov", whatsapp: "+79991234567", instagram: "ivan.petrov", vk: "id12345", linkedin: "ivan-petrov" });
  });

  it("accepts a phone number for Telegram", () => {
    expect(parse({ telegram: "+7 999 123 45 67" }).data).toEqual({ telegram: "+79991234567" });
  });

  it("rejects values that cannot be a handle or number, naming the channel", () => {
    const r = parse({ telegram: "a b", whatsapp: "call me" });
    expect(r.success).toBe(false);
    const paths = r.error!.issues.map((i) => i.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["telegram", "whatsapp"]));
    expect(r.error!.issues[0]!.message).toMatch(/Telegram|WhatsApp/);
  });

  it("builds chat links for each channel", () => {
    const links = messengerLinks({ telegram: "ivan_petrov", whatsapp: "+79991234567", viber: "+79991234567", wechat: "ivan_wx1" });
    expect(links.map((l) => [l.channel, l.href])).toEqual([
      ["telegram", "https://t.me/ivan_petrov"],
      ["whatsapp", "https://wa.me/79991234567"],
      ["viber", "viber://chat?number=%2B79991234567"],
      ["wechat", null],
    ]);
    expect(links[0]!.value).toBe("@ivan_petrov");
  });

  it("is part of the contact form and API input, with unknown channels refused", () => {
    const base = { company_id: null, first_name: "Ivan", last_name: "Petrov", email: "", phone: "", job_title: "", tags: [] };
    expect(contactInput.parse({ ...base, messengers: { telegram: "@ivan_petrov" } }).messengers).toEqual({ telegram: "ivan_petrov" });
    expect(contactInput.parse(base).messengers).toEqual({});
    expect(contactInput.safeParse({ ...base, messengers: { icq: "123" } }).success).toBe(false);
  });
});

describe("Telegram bot", () => {
  const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;
  const TOKEN = "123456789:AAH" + "x".repeat(32);

  it("is off without configuration and explains a bad token or chat id", () => {
    expect(telegramSender(env({})).configured).toBe(false);
    expect(telegramConfig(env({ TELEGRAM_BOT_TOKEN: "nope", TELEGRAM_CHAT_ID: "-1001" })).problem).toMatch(/TELEGRAM_BOT_TOKEN/);
    expect(telegramConfig(env({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: "chat" })).problem).toMatch(/TELEGRAM_CHAT_ID/);
    expect(telegramSender(env({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: "-1001234567890" })).configured).toBe(true);
  });

  it("sends plain text to the configured chat and reports refusals without the token", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const ok = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), { status: 200 });
    }) as unknown as typeof fetch;
    const sender = telegramSender(env({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: "@sales_team" }), ok);
    expect(await sender.send("<b>New lead</b>")).toEqual({ message_id: 42 });
    expect(calls[0]!.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(calls[0]!.body).toMatchObject({ chat_id: "@sales_team", text: "<b>New lead</b>" });
    expect(calls[0]!.body).not.toHaveProperty("parse_mode");

    const refused = (async () => new Response(JSON.stringify({ ok: false, description: "Bad Request: chat not found" }), { status: 400 })) as unknown as typeof fetch;
    const error = await telegramSender(env({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: "-1001234567890" }), refused).send("x").catch((e: Error) => e.message);
    expect(error).toBe("Telegram refused the message: Bad Request: chat not found");
    expect(error).not.toContain(TOKEN);
  });
});
