import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getDataMode } from "@/server/env";

/**
 * Encrypts integration signing secrets at rest (AES-256-GCM).
 *
 * The key comes from NEXORA_ENCRYPTION_KEY (at least 32 characters; required in Supabase
 * mode). In demo mode without it, a random key is generated once into
 * .data/encryption-key (git-ignored), like the session secret.
 * Format: v1.<iv base64url>.<tag base64url>.<ciphertext base64url>
 */
let cached: Promise<Buffer> | null = null;

async function loadKey(): Promise<Buffer> {
  const fromEnv = process.env.NEXORA_ENCRYPTION_KEY;
  if (fromEnv) {
    if (fromEnv.length < 32) throw new Error("NEXORA_ENCRYPTION_KEY must be at least 32 characters.");
    return createHash("sha256").update(fromEnv, "utf8").digest();
  }
  if (getDataMode() === "supabase") throw new Error("NEXORA_ENCRYPTION_KEY is required in Supabase mode to store integration secrets.");
  const path = resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.NEXORA_ENCRYPTION_KEY_PATH || ".data/encryption-key");
  try {
    const existing = (await readFile(/*turbopackIgnore: true*/ path, "utf8")).trim();
    if (/^[a-f0-9]{64}$/.test(existing)) return Buffer.from(existing, "hex");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const key = randomBytes(32).toString("hex");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, key, { encoding: "utf8", mode: 0o600 });
  return Buffer.from(key, "hex");
}

function getKey(): Promise<Buffer> {
  cached ??= loadKey().catch((error) => {
    cached = null;
    throw error;
  });
  return cached;
}

export async function encryptSecret(plain: string): Promise<string> {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", await getKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export async function decryptSecret(box: string): Promise<string> {
  const [version, iv, tag, data] = box.split(".");
  if (version !== "v1" || !iv || !tag || data === undefined) throw new Error("Unsupported secret format.");
  const decipher = createDecipheriv("aes-256-gcm", await getKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

/** A new signing secret: shown once, then only its last four characters. */
export function newSigningSecret(): string {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

export function secretHash(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}
