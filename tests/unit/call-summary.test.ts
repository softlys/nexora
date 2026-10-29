import { describe, expect, it } from "vitest";
import { audioContainer, recognitionText, speechkitTranscriber } from "@/server/integrations/speech";
import { recordingUrl, summarizeCall } from "@/server/services/call-summary";
import { createTestDb, ctxFor, DEMO_ORG_ID, DEMO_USER_IDS } from "./helpers/services";

describe("call recordings", () => {
  it("only fetches recordings from telephony providers over HTTPS", () => {
    expect(recordingUrl("Zadarma, line 100\nRecording: https://api.zadarma.com/rec/1.mp3")?.hostname).toBe("api.zadarma.com");
    expect(recordingUrl("Recording: http://api.zadarma.com/rec/1.mp3")).toBeNull();
    expect(recordingUrl("Recording: https://169.254.169.254/latest")).toBeNull();
    expect(recordingUrl("Recording: https://evil.com/zadarma.com")).toBeNull();
  });

  it("reads SpeechKit results", async () => {
    const lines = [
      JSON.stringify({ result: { channelTag: "0", partial: {} } }),
      JSON.stringify({ result: { channelTag: "0", finalRefinement: { normalizedText: { alternatives: [{ text: "Добрый день, компания Атласфорд." }] } } } }),
      JSON.stringify({ result: { channelTag: "1", finalRefinement: { normalizedText: { alternatives: [{ text: "Хочу заказать 20 станков." }] } } } }),
    ].join("\n");
    expect(recognitionText(lines)).toBe("Добрый день, компания Атласфорд.\n[2] Хочу заказать 20 станков.");
    expect(audioContainer("", new TextEncoder().encode("RIFF...."))).toBe("WAV");
    expect(audioContainer("audio/mpeg", new Uint8Array(4))).toBe("MP3");

    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      if (url.includes("recognizeFileAsync")) return Response.json({ id: "op1" });
      if (url.includes("/operations/")) return Response.json({ done: calls.filter((c) => c.includes("/operations/")).length > 1 });
      return new Response(lines);
    }) as unknown as typeof fetch;
    const transcribe = speechkitTranscriber({ YANDEX_GPT_API_KEY: "k", YANDEX_FOLDER_ID: "f" } as unknown as NodeJS.ProcessEnv, fetchImpl, async () => undefined)!;
    expect(await transcribe(new Uint8Array([1, 2, 3]), "audio/mpeg")).toContain("20 станков");
    expect(calls.at(-1)).toBe("https://stt.api.cloud.yandex.net/stt/v3/getRecognition?operationId=op1");
  });

  it("adds a summary note next to a recorded call", async () => {
    const { db, data } = createTestDb();
    const admin = ctxFor(db, data(), DEMO_USER_IDS.admin);
    const call = data().activities.find((a) => a.contact_id)!;
    await db.write(DEMO_ORG_ID, (tx) => tx.update("activities", call.id, { type: "call", subject: "Incoming call", body: "Zadarma, line 100\nRecording: https://api.zadarma.com/rec/1.mp3" }));
    const fetchImpl = (async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } })) as unknown as typeof fetch;
    const deps = { transcribe: async () => "Клиент: нужен счёт до пятницы.", complete: async () => "• Выставить счёт до пятницы", fetchImpl, language: "ru" as const };
    const note = await summarizeCall(admin, call.id, deps);
    expect(note).toMatchObject({ type: "note", contact_id: call.contact_id });
    expect(note.body).toContain("Выставить счёт до пятницы");
    expect(note.body).toContain("нужен счёт до пятницы");
    await expect(summarizeCall(admin, call.id, { ...deps, transcribe: null })).rejects.toThrow(/SpeechKit/);
    const plain = data().activities.find((a) => a.type === "note" && a.id !== note.id)!;
    await expect(summarizeCall(admin, plain.id, deps)).rejects.toThrow(/not found/);
  });
});
