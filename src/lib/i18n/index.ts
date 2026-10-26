import { RU } from "./ru";

/**
 * Interface language. The English text is the key: tr("Companies") returns "Компании" in Russian and
 * the text itself in English, so a missing translation shows English instead of breaking.
 *
 * The language is a deployment setting, NEXORA_LOCALE (ru by default, or en). On the server it is read
 * from the environment; in the browser from <html lang>, which the root layout sets from the same
 * setting. tr() is synchronous, so it works in server and client components and in plain helpers.
 */
export type Locale = "ru" | "en";

export function locale(): Locale {
  if (typeof window === "undefined") {
    const env = process.env;
    return env.NEXORA_LOCALE?.trim().toLowerCase() === "en" ? "en" : "ru";
  }
  return document.documentElement.lang === "en" ? "en" : "ru";
}

/** BCP 47 tag for Intl formatting. */
export const intlLocale = (): string => (locale() === "ru" ? "ru-RU" : "en-US");

/** Translates an English UI text; {name} placeholders are filled from vars after translation. */
export function tr(text: string, vars?: Record<string, unknown>): string {
  const out = locale() === "ru" ? (RU[text] ?? text) : text;
  return vars ? out.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : out;
}

/**
 * Count with the right word form: plural(5, "task") → "5 задач" / "5 tasks". Russian forms come
 * from RU_PLURALS (one / few / many); English adds "s" unless an explicit plural is given.
 */
export function plural(n: number, word: string, enPlural?: string): string {
  if (locale() === "en") return `${n} ${n === 1 ? word : (enPlural ?? `${word}s`)}`;
  const forms = RU_PLURALS[word];
  if (!forms) return `${n} ${tr(word)}`;
  const mod10 = Math.abs(n) % 10;
  const mod100 = Math.abs(n) % 100;
  const form = mod10 === 1 && mod100 !== 11 ? forms[0] : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? forms[1] : forms[2];
  return `${n} ${form}`;
}

const RU_PLURALS: Record<string, [string, string, string]> = {
  task: ["задача", "задачи", "задач"],
  deal: ["сделка", "сделки", "сделок"],
  lead: ["лид", "лида", "лидов"],
  company: ["компания", "компании", "компаний"],
  contact: ["контакт", "контакта", "контактов"],
  order: ["заказ", "заказа", "заказов"],
  day: ["день", "дня", "дней"],
  hour: ["час", "часа", "часов"],
  minute: ["минута", "минуты", "минут"],
  event: ["событие", "события", "событий"],
  row: ["строка", "строки", "строк"],
  record: ["запись", "записи", "записей"],
  result: ["результат", "результата", "результатов"],
  step: ["шаг", "шага", "шагов"],
  run: ["запуск", "запуска", "запусков"],
  message: ["сообщение", "сообщения", "сообщений"],
  item: ["позиция", "позиции", "позиций"],
  user: ["пользователь", "пользователя", "пользователей"],
  note: ["заметка", "заметки", "заметок"],
  condition: ["условие", "условия", "условий"],
  duplicate: ["дубль", "дубля", "дублей"],
  "recovery code": ["код восстановления", "кода восстановления", "кодов восстановления"],
};

/** tr() for values that may be text or already-built elements (labels passed through props). */
export function trNode<T>(value: T): T {
  return (typeof value === "string" ? tr(value) : value) as T;
}
