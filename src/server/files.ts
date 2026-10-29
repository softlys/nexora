import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDataMode } from "@/server/env";
import { createSupabaseServiceClient } from "@/server/supabase/service";

/**
 * Where file bytes live. Demo mode keeps them on disk next to the demo data (NEXORA_FILES_DIR,
 * default .data/files, the Docker volume); Supabase mode uses the private Storage bucket
 * "attachments", created on first use. Access is checked by the attachments table, never here.
 */
export type FileStore = {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
};

const SAFE_KEY = /^[0-9a-f-]{36}\/[0-9a-f-]{36}$/;

export function diskFileStore(root = process.env.NEXORA_FILES_DIR?.trim() || path.join(process.cwd(), ".data", "files")): FileStore {
  const file = (key: string) => {
    if (!SAFE_KEY.test(key)) throw new Error("Bad file key.");
    return path.join(root, ...key.split("/"));
  };
  return {
    async put(key, bytes) {
      await mkdir(path.dirname(file(key)), { recursive: true });
      await writeFile(file(key), bytes);
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(file(key)));
      } catch {
        return null;
      }
    },
  };
}

const BUCKET = "attachments";

function storageFileStore(): FileStore {
  const storage = () => createSupabaseServiceClient().storage;
  let bucketReady = false;
  return {
    async put(key, bytes, contentType) {
      if (!bucketReady) {
        const { error } = await storage().getBucket(BUCKET);
        if (error) await storage().createBucket(BUCKET, { public: false });
        bucketReady = true;
      }
      const { error } = await storage().from(BUCKET).upload(key, bytes, { contentType, upsert: false });
      if (error) throw new Error(`The file was not stored: ${error.message}`);
    },
    async get(key) {
      const { data, error } = await storage().from(BUCKET).download(key);
      return error || !data ? null : new Uint8Array(await data.arrayBuffer());
    },
  };
}

let store: FileStore | null = null;
export function fileStore(): FileStore {
  return (store ??= getDataMode() === "supabase" ? storageFileStore() : diskFileStore());
}
