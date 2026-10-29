import "server-only";

/**
 * Speech to text for call recordings with Yandex SpeechKit (API v3, asynchronous recognition of a
 * whole file). Uses YANDEX_SPEECHKIT_API_KEY, or the YandexGPT key when the same service account
 * has the ai.speechkit-stt.user role, and YANDEX_FOLDER_ID.
 */
export type Transcribe = (audio: Uint8Array, contentType: string) => Promise<string>;

export function speechConfig(env: NodeJS.ProcessEnv = process.env): { key: string; folder: string } | null {
  const key = env.YANDEX_SPEECHKIT_API_KEY?.trim() || env.YANDEX_GPT_API_KEY?.trim();
  const folder = env.YANDEX_FOLDER_ID?.trim();
  return key && folder ? { key, folder } : null;
}

const CONTAINER: Record<string, string> = { "audio/mpeg": "MP3", "audio/mp3": "MP3", "audio/wav": "WAV", "audio/x-wav": "WAV", "audio/wave": "WAV", "audio/ogg": "OGG_OPUS", "audio/opus": "OGG_OPUS" };

/** Picks the container from the content type, then from the file's first bytes. */
export function audioContainer(contentType: string, audio: Uint8Array): string {
  const known = CONTAINER[contentType.split(";")[0]!.trim().toLowerCase()];
  if (known) return known;
  const head = new TextDecoder("latin1").decode(audio.slice(0, 4));
  if (head === "RIFF") return "WAV";
  if (head === "OggS") return "OGG_OPUS";
  return "MP3";
}

type RecognitionLine = { result?: { channelTag?: string; finalRefinement?: { normalizedText?: { alternatives?: Array<{ text?: string }> } } } };

/** Joins the final phrases of a recognition result (one JSON object per line), marking speakers by channel. */
export function recognitionText(raw: string): string {
  const phrases: string[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = (JSON.parse(line) as RecognitionLine).result;
      const text = r?.finalRefinement?.normalizedText?.alternatives?.[0]?.text?.trim();
      if (text) phrases.push(r?.channelTag && r.channelTag !== "0" ? `[${Number(r.channelTag) + 1}] ${text}` : text);
    } catch {
      // Not a result line.
    }
  }
  return phrases.join("\n");
}

export function speechkitTranscriber(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch, wait = (ms: number) => new Promise((r) => setTimeout(r, ms))): Transcribe | null {
  const c = speechConfig(env);
  if (!c) return null;
  const headers = { Authorization: `Api-Key ${c.key}`, "x-folder-id": c.folder };
  return async (audio, contentType) => {
    const start = await fetchImpl("https://stt.api.cloud.yandex.net/stt/v3/recognizeFileAsync", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        content: Buffer.from(audio).toString("base64"),
        recognitionModel: {
          model: "general",
          audioFormat: { containerAudio: { containerAudioType: audioContainer(contentType, audio) } },
          textNormalization: { textNormalization: "TEXT_NORMALIZATION_ENABLED", literatureText: true },
          languageRestriction: { restrictionType: "WHITELIST", languageCode: ["ru-RU"] },
        },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const op = (await start.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!start.ok || !op.id) throw new Error(`SpeechKit: ${op.message ?? `HTTP ${start.status}`}`);
    // Recognition takes roughly a tenth of the recording's length; give up after two minutes.
    for (let i = 0; i < 40; i++) {
      await wait(3000);
      const res = await fetchImpl(`https://operation.api.cloud.yandex.net/operations/${op.id}`, { headers, signal: AbortSignal.timeout(15_000) });
      const status = (await res.json().catch(() => ({}))) as { done?: boolean; error?: { message?: string } };
      if (status.error) throw new Error(`SpeechKit: ${status.error.message ?? "recognition failed"}`);
      if (status.done) {
        const result = await fetchImpl(`https://stt.api.cloud.yandex.net/stt/v3/getRecognition?operationId=${op.id}`, { headers, signal: AbortSignal.timeout(30_000) });
        if (!result.ok) throw new Error(`SpeechKit: HTTP ${result.status}`);
        return recognitionText(await result.text());
      }
    }
    throw new Error("SpeechKit did not finish in two minutes; try again later.");
  };
}
