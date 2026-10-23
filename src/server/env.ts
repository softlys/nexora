import "server-only";

export type DataMode = "demo" | "supabase";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function hasSupabaseEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/**
 * NEXORA_DATA_MODE=demo|supabase selects the repository adapter.
 * Without it, Supabase is used only when its env vars are present; otherwise demo.
 * On a production server the mode must be explicit: demo mode has no sign-in and starts every
 * visitor as an admin, so a forgotten variable must fail instead of silently serving the demo.
 * `next build` is exempt (nothing is served while building).
 */
export function getDataMode(env: NodeJS.ProcessEnv = process.env): DataMode {
  const explicit = env.NEXORA_DATA_MODE;
  if (!explicit && env.NODE_ENV === "production" && env.NEXT_PHASE !== "phase-production-build") {
    throw new ConfigError("NEXORA_DATA_MODE is not set. On a server set NEXORA_DATA_MODE=supabase (or NEXORA_DATA_MODE=demo for a demo installation). See docs/deployment.md.");
  }
  if (explicit === "demo") return "demo";
  if (explicit === "supabase") {
    if (!hasSupabaseEnv(env)) {
      throw new ConfigError(
        "NEXORA_DATA_MODE=supabase but NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are missing. See .env.example.",
      );
    }
    return "supabase";
  }
  if (explicit) throw new ConfigError(`Unknown NEXORA_DATA_MODE "${explicit}". Use demo or supabase.`);
  return hasSupabaseEnv(env) ? "supabase" : "demo";
}

/**
 * Supabase URL and anon key, read when the server runs. `process.env.NEXT_PUBLIC_*` written out
 * literally is replaced at build time, which would freeze a Docker image to one project; reading
 * through a variable keeps one image configurable by its environment.
 */
export function supabaseConfig(env: NodeJS.ProcessEnv = process.env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new ConfigError("Supabase is not configured.");
  return { url, anonKey };
}

export function demoDataPath(): string {
  return process.env.NEXORA_DEMO_DATA_PATH || ".data/demo.json";
}
