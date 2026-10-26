/**
 * Duplicate detection (дубли). Records are compared by match keys: a normalized company name
 * (legal forms and quotes dropped), the website host, the last 10 digits of a phone number and
 * the e-mail address. Two records sharing any key are possible duplicates.
 */

const LEGAL_FORMS = ["ооо", "оао", "зао", "пао", "ао", "ип", "нко", "llc", "inc", "ltd", "llp", "gmbh", "ag", "sa", "corp", "co", "plc", "bv", "srl", "oy", "ab"];

/** "ООО «Ромашка»" and "Ромашка, LLC" both become "ромашка". */
export function normalizeName(name: string | null | undefined): string {
  const words = (name ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter((w) => w && !LEGAL_FORMS.includes(w));
  return words.join(" ");
}

/** Last 10 digits, so +7 999 123-45-67, 8 (999) 123 45 67 and 9991234567 match. Short numbers are ignored. */
export function phoneKey(phone: string | null | undefined): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-10) : "";
}

export function emailKey(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/** "https://www.Example.ru/about" → "example.ru". */
export function websiteKey(website: string | null | undefined): string {
  const v = (website ?? "").trim().toLowerCase();
  if (!v) return "";
  try {
    return new URL(/^[a-z]+:\/\//.test(v) ? v : `https://${v}`).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export type MatchReason = "name" | "website" | "phone" | "email";

/** English UI texts (translated where shown). */
export const MATCH_REASON_LABELS: Record<MatchReason, string> = { name: "same name", website: "same website", phone: "same phone", email: "same e-mail" };

export type MatchProbe = { name?: string | null; website?: string | null; phone?: string | null; email?: string | null };

/** Match keys of a record, prefixed by kind so different kinds never collide. */
export function matchKeys(probe: MatchProbe): Array<{ reason: MatchReason; key: string }> {
  const keys: Array<{ reason: MatchReason; key: string }> = [];
  const name = normalizeName(probe.name);
  // Very short names ("ab", "1") match too much to be useful.
  if (name.length >= 3) keys.push({ reason: "name", key: `name:${name}` });
  const host = websiteKey(probe.website);
  if (host) keys.push({ reason: "website", key: `web:${host}` });
  const phone = phoneKey(probe.phone);
  if (phone) keys.push({ reason: "phone", key: `tel:${phone}` });
  const email = emailKey(probe.email);
  if (email) keys.push({ reason: "email", key: `mail:${email}` });
  return keys;
}

/** Groups of two or more items that share a match key, directly or through each other. */
export function groupDuplicates<T extends { id: string }>(items: T[], probe: (item: T) => MatchProbe): Array<{ items: T[]; reasons: MatchReason[] }> {
  const parent = new Map(items.map((i) => [i.id, i.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  const firstByKey = new Map<string, string>();
  const reasonsByRoot = new Map<string, Set<MatchReason>>();
  const linked: Array<[string, MatchReason]> = [];
  for (const item of items) {
    for (const { reason, key } of matchKeys(probe(item))) {
      const first = firstByKey.get(key);
      if (!first) {
        firstByKey.set(key, item.id);
        continue;
      }
      parent.set(find(item.id), find(first));
      linked.push([item.id, reason]);
    }
  }
  for (const [id, reason] of linked) {
    const root = find(id);
    if (!reasonsByRoot.has(root)) reasonsByRoot.set(root, new Set());
    reasonsByRoot.get(root)!.add(reason);
  }
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const root = find(item.id);
    groups.set(root, [...(groups.get(root) ?? []), item]);
  }
  return [...groups.entries()].filter(([, g]) => g.length > 1).map(([root, g]) => ({ items: g, reasons: [...(reasonsByRoot.get(root) ?? [])] }));
}
