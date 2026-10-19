import "server-only";

export type DataMode = "demo" | "supabase";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function hasSupabaseEnv(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/**
 * NEXORA_DATA_MODE=demo|supabase selects the repository adapter.
 * Without it, Supabase is used only when its env vars are present; otherwise demo.
 */
export function getDataMode(): DataMode {
  const explicit = process.env.NEXORA_DATA_MODE;
  if (explicit === "demo") return "demo";
  if (explicit === "supabase") {
    if (!hasSupabaseEnv()) {
      throw new ConfigError(
        "NEXORA_DATA_MODE=supabase but NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are missing. See .env.example.",
      );
    }
    return "supabase";
  }
  if (explicit) throw new ConfigError(`Unknown NEXORA_DATA_MODE "${explicit}". Use demo or supabase.`);
  return hasSupabaseEnv() ? "supabase" : "demo";
}

export function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new ConfigError("Supabase is not configured.");
  return { url, anonKey };
}

export function demoDataPath(): string {
  return process.env.NEXORA_DEMO_DATA_PATH || ".data/demo.json";
}
