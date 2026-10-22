import "server-only";
import { getDataMode } from "@/server/env";
import { createSupabaseServiceClient } from "@/server/supabase/service";
import type { Counter } from "./rate-limit";

/** PostgreSQL-backed counter (public.hit_counter), shared by every instance. Null outside Supabase mode. */
export function supabaseCounter(): Counter | null {
  if (getDataMode() !== "supabase") return null;
  return async (id, windowSeconds, amount) => {
    const { data, error } = await createSupabaseServiceClient().rpc("hit_counter", { p_id: id, p_window_seconds: windowSeconds, p_amount: amount });
    if (error) throw new Error(`hit_counter: ${error.message}`);
    const row = (Array.isArray(data) ? data[0] : data) as { count: number | string } | undefined;
    return Number(row?.count ?? amount);
  };
}
