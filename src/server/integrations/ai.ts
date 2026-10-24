import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/**
 * AI assistant for deals: a short summary with next steps, or a draft email to the customer.
 * Providers, chosen with AI_PROVIDER (or the first one configured, in this order):
 * - yandex: YandexGPT in Yandex Cloud (YANDEX_GPT_API_KEY, YANDEX_FOLDER_ID), works from Russia;
 * - anthropic: Claude (ANTHROPIC_API_KEY; model ANTHROPIC_MODEL, default claude-opus-5-5).
 * Only the deal's own record data is sent; the answer is shown to the user, never saved automatically.
 */
export type AiProvider = "yandex" | "anthropic";

export function aiConfig(env: NodeJS.ProcessEnv = process.env): { provider: AiProvider | null; label: string; problem: string | null } {
  const yandex = Boolean(env.YANDEX_GPT_API_KEY?.trim() && env.YANDEX_FOLDER_ID?.trim());
  const anthropic = Boolean(env.ANTHROPIC_API_KEY?.trim());
  const wanted = env.AI_PROVIDER?.trim().toLowerCase();
  if (wanted === "yandex") return yandex ? { provider: "yandex", label: "YandexGPT", problem: null } : { provider: null, label: "", problem: "AI_PROVIDER=yandex needs YANDEX_GPT_API_KEY and YANDEX_FOLDER_ID." };
  if (wanted === "anthropic") return anthropic ? { provider: "anthropic", label: "Claude", problem: null } : { provider: null, label: "", problem: "AI_PROVIDER=anthropic needs ANTHROPIC_API_KEY." };
  if (yandex) return { provider: "yandex", label: "YandexGPT", problem: null };
  if (anthropic) return { provider: "anthropic", label: "Claude", problem: null };
  return { provider: null, label: "", problem: null };
}

export type Completion = (system: string, prompt: string) => Promise<string>;

function yandexCompletion(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch): Completion {
  const folder = env.YANDEX_FOLDER_ID!.trim();
  const model = env.YANDEX_GPT_MODEL?.trim() || "yandexgpt/latest";
  return async (system, prompt) => {
    const response = await fetchImpl("https://llm.api.cloud.yandex.net/foundationModels/v1/completion", {
      method: "POST",
      headers: { Authorization: `Api-Key ${env.YANDEX_GPT_API_KEY!.trim()}`, "x-folder-id": folder, "Content-Type": "application/json" },
      body: JSON.stringify({
        modelUri: `gpt://${folder}/${model}`,
        completionOptions: { stream: false, temperature: 0.3, maxTokens: "2000" },
        messages: [
          { role: "system", text: system },
          { role: "user", text: prompt },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const body = (await response.json().catch(() => ({}))) as { result?: { alternatives?: Array<{ message?: { text?: string } }> }; error?: { message?: string }; message?: string };
    const text = body.result?.alternatives?.[0]?.message?.text;
    if (!response.ok || !text) throw new Error(`YandexGPT: ${body.error?.message ?? body.message ?? `HTTP ${response.status}`}`);
    return text.trim();
  };
}

function anthropicCompletion(env: NodeJS.ProcessEnv): Completion {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY!.trim(), timeout: 90_000, maxRetries: 2 });
  const model = env.ANTHROPIC_MODEL?.trim() || "claude-opus-5-5";
  return async (system, prompt) => {
    const response = await client.beta.messages.create({
      model,
      max_tokens: 4000,
      system,
      // A short business summary: low effort keeps it fast and inexpensive.
      output_config: { effort: "low" },
      // If a safety classifier declines, the API retries on a suitable model within the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content: prompt }],
    });
    if (response.stop_reason === "refusal") throw new Error("Claude declined to answer this request.");
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
    if (!text) throw new Error("Claude returned no text.");
    return text;
  };
}

export function aiCompletion(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): { complete: Completion; label: string } | null {
  const c = aiConfig(env);
  if (c.provider === "yandex") return { complete: yandexCompletion(env, fetchImpl), label: c.label };
  if (c.provider === "anthropic") return { complete: anthropicCompletion(env), label: c.label };
  return null;
}

export type DealBrief = {
  deal: { name: string; stage: string; amount: number; currency: string; probability: number; expected_close: string | null; next_activity: string; notes: string; days_in_stage: number };
  company: { name: string; industry: string; country: string; city: string } | null;
  contact: { name: string; job_title: string; email: string | null } | null;
  owner: string;
  activities: Array<{ when: string; type: string; subject: string; body: string }>;
  tasks: Array<{ title: string; due: string | null; status: string }>;
  comments: string[];
};

const SYSTEM = {
  ru: "Ты помощник менеджера по продажам в B2B CRM. Пиши по-русски, коротко и по делу, без выдумок: опирайся только на данные сделки. Если данных мало, так и скажи.",
  en: "You assist a B2B sales rep in a CRM. Be brief and concrete and invent nothing: use only the deal data. If data is thin, say so.",
} as const;

export function briefText(b: DealBrief): string {
  const lines = [
    `Deal: ${b.deal.name}`,
    `Stage: ${b.deal.stage} (${b.deal.days_in_stage} days in stage), amount ${b.deal.amount} ${b.deal.currency}, probability ${b.deal.probability}%, expected close ${b.deal.expected_close ?? "not set"}`,
    `Owner: ${b.owner}`,
    b.company ? `Company: ${b.company.name}, ${b.company.industry}, ${b.company.city ? `${b.company.city}, ` : ""}${b.company.country}` : "Company: —",
    b.contact ? `Contact: ${b.contact.name}${b.contact.job_title ? `, ${b.contact.job_title}` : ""}` : "Contact: —",
    b.deal.next_activity ? `Planned next activity: ${b.deal.next_activity}` : "",
    b.deal.notes ? `Notes: ${b.deal.notes.slice(0, 1500)}` : "",
    "",
    "Recent activity (newest first):",
    ...(b.activities.length ? b.activities.map((a) => `- ${a.when} ${a.type}: ${a.subject}${a.body ? ` — ${a.body.slice(0, 300)}` : ""}`) : ["- none"]),
    "",
    "Open tasks:",
    ...(b.tasks.length ? b.tasks.map((t) => `- ${t.title}${t.due ? ` (due ${t.due})` : ""}`) : ["- none"]),
    ...(b.comments.length ? ["", "Comments:", ...b.comments.map((c) => `- ${c.slice(0, 300)}`)] : []),
  ];
  return lines.filter((l) => l !== "").join("\n");
}

export async function dealAssist(complete: Completion, brief: DealBrief, kind: "summary" | "email", language: "ru" | "en"): Promise<string> {
  const data = briefText(brief);
  const prompt =
    kind === "summary"
      ? language === "ru"
        ? `Данные сделки:\n${data}\n\nСделай: 1) сводку в 3–5 предложениях: где сделка, что известно о клиенте, риски; 2) 3 конкретных следующих шага с ответственным действием и сроком. Без вступлений.`
        : `Deal data:\n${data}\n\nWrite: 1) a 3–5 sentence summary: where the deal stands, what we know about the customer, risks; 2) three concrete next steps with an action and a timeframe. No preamble.`
      : language === "ru"
        ? `Данные сделки:\n${data}\n\nНапиши черновик письма контакту клиента от имени ${brief.owner}: тема и текст до 150 слов, вежливо, с одним понятным следующим шагом (например, созвон). Не обещай того, чего нет в данных.`
        : `Deal data:\n${data}\n\nDraft an email to the customer's contact from ${brief.owner}: a subject line and a body under 150 words, polite, with one clear next step (for example a call). Promise nothing that is not in the data.`;
  return complete(SYSTEM[language], prompt);
}
