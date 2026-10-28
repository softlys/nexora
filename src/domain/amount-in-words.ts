/**
 * Сумма прописью for Russian invoices: 12345.6 → "Двенадцать тысяч триста сорок пять рублей 60 копеек".
 */

const ONES_M = ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
const ONES_F = ["", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
const TEENS = ["десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"];
const TENS = ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"];
const HUNDREDS = ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"];

/** The Russian word form for a count: forms = [1, 2–4, 5+] ("рубль", "рубля", "рублей"). */
export function ruPlural(n: number, forms: readonly [string, string, string]): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}

function triad(n: number, feminine: boolean): string[] {
  const words = [HUNDREDS[Math.floor(n / 100)]!];
  const rest = n % 100;
  if (rest >= 10 && rest < 20) words.push(TEENS[rest - 10]!);
  else words.push(TENS[Math.floor(rest / 10)]!, (feminine ? ONES_F : ONES_M)[rest % 10]!);
  return words.filter(Boolean);
}

const SCALES: Array<{ forms: readonly [string, string, string]; feminine: boolean }> = [
  { forms: ["", "", ""], feminine: false },
  { forms: ["тысяча", "тысячи", "тысяч"], feminine: true },
  { forms: ["миллион", "миллиона", "миллионов"], feminine: false },
  { forms: ["миллиард", "миллиарда", "миллиардов"], feminine: false },
];

/** Whole number in words (masculine), "ноль" for 0. */
export function numberInWords(value: number): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return "ноль";
  const parts: string[] = [];
  for (let scale = 0; n > 0 && scale < SCALES.length; scale++) {
    const chunk = n % 1000;
    n = Math.floor(n / 1000);
    if (chunk === 0) continue;
    const { forms, feminine } = SCALES[scale]!;
    const words = triad(chunk, feminine);
    if (scale > 0) words.push(ruPlural(chunk, forms));
    parts.unshift(words.join(" "));
  }
  return parts.join(" ");
}

/** "Двенадцать тысяч триста сорок пять рублей 60 копеек". */
export function rublesInWords(amount: number): string {
  const kopecks = Math.round(Math.abs(amount) * 100);
  const rubles = Math.floor(kopecks / 100);
  const k = kopecks % 100;
  const text = `${numberInWords(rubles)} ${ruPlural(rubles, ["рубль", "рубля", "рублей"])} ${String(k).padStart(2, "0")} ${ruPlural(k, ["копейка", "копейки", "копеек"])}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
