import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ConfigError, supabaseConfig } from "@/server/env";

let client: SupabaseClient | null = null;

/**
 * Service-role client for work that does not act as the signed-in user:
 * automations (they run as a service principal), the scheduler and cron endpoint,
 * and the security log (events such as a failed login have no session).
 * Server-only; the key is read from SUPABASE_SERVICE_ROLE_KEY and never sent to the browser.
 * It bypasses RLS, so every query through it must filter by organization explicitly
 * (the Tx adapter does this for every call).
 */
export function createSupabaseServiceClient(): SupabaseClient {
  if (client) return client;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new ConfigError("SUPABASE_SERVICE_ROLE_KEY is required in Supabase mode for automations and the security log. See .env.example.");
  client = createClient(supabaseConfig().url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}
