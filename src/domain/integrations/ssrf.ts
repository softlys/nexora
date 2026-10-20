/**
 * SSRF policy for outbound requests (webhooks). Pure: the delivery code resolves DNS and
 * calls `blockedAddressReason` for every address it would connect to, at connect time
 * (so DNS rebinding cannot swap in a private address after the check).
 */
import { isIP } from "node:net";

type Bytes = number[];
type Range = { bytes: Bytes; bits: number; reason: string };

function v4Bytes(ip: string): Bytes {
  return ip.split(".").map((p) => Number(p));
}

function v6Bytes(ip: string): Bytes {
  let addr = ip.toLowerCase();
  const zone = addr.indexOf("%");
  if (zone >= 0) addr = addr.slice(0, zone);
  // Embedded IPv4 (::ffff:1.2.3.4) becomes two hextets.
  const lastColon = addr.lastIndexOf(":");
  const tail = addr.slice(lastColon + 1);
  if (tail.includes(".")) {
    const b = v4Bytes(tail);
    addr = `${addr.slice(0, lastColon + 1)}${((b[0]! << 8) | b[1]!).toString(16)}:${((b[2]! << 8) | b[3]!).toString(16)}`;
  }
  const [head, rest] = addr.split("::");
  const headParts = head ? head.split(":") : [];
  const restParts = rest ? rest.split(":") : [];
  const hextets = rest === undefined ? headParts : [...headParts, ...Array<string>(8 - headParts.length - restParts.length).fill("0"), ...restParts];
  return hextets.flatMap((h) => {
    const n = parseInt(h || "0", 16);
    return [(n >> 8) & 0xff, n & 0xff];
  });
}

function range(cidr: string, reason: string): Range {
  const [base, bits] = cidr.split("/");
  return { bytes: isIP(base!) === 4 ? v4Bytes(base!) : v6Bytes(base!), bits: Number(bits), reason };
}

function inRange(bytes: Bytes, r: Range): boolean {
  if (bytes.length !== r.bytes.length) return false;
  let remaining = r.bits;
  for (let i = 0; i < bytes.length && remaining > 0; i++) {
    const take = Math.min(8, remaining);
    const mask = (0xff << (8 - take)) & 0xff;
    if ((bytes[i]! & mask) !== (r.bytes[i]! & mask)) return false;
    remaining -= take;
  }
  return true;
}

/** Address ranges an outbound request may never reach. */
export const BLOCKED_RANGES: Range[] = [
  range("0.0.0.0/8", "unspecified"),
  range("10.0.0.0/8", "private"),
  range("100.64.0.0/10", "carrier-grade NAT"),
  range("127.0.0.0/8", "loopback"),
  range("169.254.0.0/16", "link-local (includes cloud metadata 169.254.169.254)"),
  range("172.16.0.0/12", "private"),
  range("192.0.0.0/24", "IETF protocol assignments"),
  range("192.0.2.0/24", "documentation"),
  range("192.88.99.0/24", "6to4 relay"),
  range("192.168.0.0/16", "private"),
  range("198.18.0.0/15", "benchmarking"),
  range("198.51.100.0/24", "documentation"),
  range("203.0.113.0/24", "documentation"),
  range("224.0.0.0/4", "multicast"),
  range("240.0.0.0/4", "reserved"),
  range("::/128", "unspecified"),
  range("::1/128", "loopback"),
  range("64:ff9b::/96", "NAT64"),
  range("100::/64", "discard"),
  range("2001:db8::/32", "documentation"),
  range("fc00::/7", "unique local (private)"),
  range("fe80::/10", "link-local"),
  range("ff00::/8", "multicast"),
  range("fd00:ec2::254/128", "cloud metadata"),
];

/** Why an address must not be contacted, or null when it is a public address. */
export function blockedAddressReason(address: string): string | null {
  const family = isIP(address);
  if (family === 0) return "not an IP address";
  const bytes = family === 4 ? v4Bytes(address) : v6Bytes(address);
  if (family === 6) {
    const firstTenZero = bytes.slice(0, 10).every((b) => b === 0);
    const mapped = firstTenZero && bytes[10] === 0xff && bytes[11] === 0xff;
    const compatible = firstTenZero && bytes[10] === 0 && bytes[11] === 0 && bytes.slice(12).some((b, i) => (i < 3 ? b !== 0 : b > 1));
    // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) addresses are judged as IPv4.
    if (mapped || compatible) return blockedAddressReason(bytes.slice(12).join("."));
  }
  return BLOCKED_RANGES.find((r) => inRange(bytes, r))?.reason ?? null;
}

const BLOCKED_HOSTNAMES = [/^localhost$/i, /\.localhost$/i, /\.internal$/i, /\.local$/i, /^metadata$/i];

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

/**
 * Static checks before any DNS lookup: scheme, credentials, port and well-known internal
 * hostnames. `allowHttp` is true only outside production (local testing).
 */
export function checkOutboundUrl(raw: string, options: { allowHttp: boolean; allowPrivate?: boolean }): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "The URL is not valid." };
  }
  if (url.protocol !== "https:" && !(options.allowHttp && url.protocol === "http:")) {
    return { ok: false, reason: options.allowHttp ? "Only http and https URLs are allowed." : "Webhook URLs must use https." };
  }
  if (url.username || url.password) return { ok: false, reason: "URLs with embedded credentials are not allowed." };
  if (options.allowPrivate) return { ok: true, url };
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.some((re) => re.test(host))) return { ok: false, reason: "Internal hostnames are not allowed." };
  if (isIP(host)) {
    const reason = blockedAddressReason(host);
    if (reason) return { ok: false, reason: `The address is ${reason}.` };
  }
  return { ok: true, url };
}
