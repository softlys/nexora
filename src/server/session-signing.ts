import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/**
 * Secret used to sign the demo-user cookie.
 * Uses NEXORA_SESSION_SECRET when set; otherwise generates a random secret once and keeps it
 * in .data/session-secret (git-ignored), so demo mode works with no configuration and the
 * cookie still cannot be forged by editing it in the browser.
 */
let cached: Promise<Buffer> | null = null;

async function loadSecret(): Promise<Buffer> {
  const fromEnv = process.env.NEXORA_SESSION_SECRET;
  if (fromEnv) {
    if (fromEnv.length < 32) throw new Error("NEXORA_SESSION_SECRET must be at least 32 characters.");
    return Buffer.from(fromEnv, "utf8");
  }
  // Runtime data file, not a build input.
  const path = resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.NEXORA_SESSION_SECRET_PATH || ".data/session-secret");
  try {
    const existing = (await readFile(/*turbopackIgnore: true*/ path, "utf8")).trim();
    if (existing.length >= 64) return Buffer.from(existing, "hex");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const secret = randomBytes(32).toString("hex");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, secret, { encoding: "utf8", mode: 0o600 });
  return Buffer.from(secret, "hex");
}

function getSecret(): Promise<Buffer> {
  cached ??= loadSecret().catch((error) => {
    cached = null;
    throw error;
  });
  return cached;
}

function hmac(secret: Buffer, value: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export async function signValue(value: string): Promise<string> {
  return `${value}.${hmac(await getSecret(), value)}`;
}

/** Returns the original value if the signature is valid, otherwise null. */
export async function verifySignedValue(signed: string | undefined | null): Promise<string | null> {
  if (!signed) return null;
  const dot = signed.lastIndexOf(".");
  if (dot <= 0) return null;
  const value = signed.slice(0, dot);
  const given = Buffer.from(signed.slice(dot + 1));
  const expected = Buffer.from(hmac(await getSecret(), value));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return value;
}

/** The same server secret as text, for other signed links (for example unsubscribe links). */
export async function serverSecret(): Promise<string> {
  return (await getSecret()).toString("hex");
}
