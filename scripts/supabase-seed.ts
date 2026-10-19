/**
 * npm run supabase:seed
 *
 * Loads the same deterministic demo dataset used by demo mode into a Supabase project:
 * creates the five demo users in Supabase Auth (password from DEMO_USER_PASSWORD) and
 * upserts every table in foreign-key order. Safe to re-run: rows are upserted by id.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment
 * (for example `node --env-file=.env.local` or exported in your shell). The service-role
 * key bypasses RLS, so run this only from your machine against a project you own.
 */
import { createClient } from "@supabase/supabase-js";
import { generateSeed } from "../src/domain/seed/generate";
import { deferredLeadLinks, LOAD_ORDER, rowsForLoad } from "../src/domain/seed/load-order";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. See .env.example.`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const url = required("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const password = required("DEMO_USER_PASSWORD");
  if (password.length < 12) {
    console.error("DEMO_USER_PASSWORD must be at least 12 characters.");
    process.exit(1);
  }

  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const data = generateSeed(new Date());

  console.log("Creating demo users in Supabase Auth…");
  for (const profile of data.profiles) {
    const { error } = await db.auth.admin.createUser({
      id: profile.id,
      email: profile.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: profile.full_name },
    });
    if (error && !/already|exists|registered/i.test(error.message)) throw new Error(`Auth user ${profile.email}: ${error.message}`);
    if (error) await db.auth.admin.updateUserById(profile.id, { password });
  }

  for (const table of LOAD_ORDER) {
    const rows = rowsForLoad(data, table);
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from(table).upsert(rows.slice(i, i + 500), { onConflict: "id" });
      if (error) throw new Error(`${table}: ${error.message}`);
    }
    if (rows.length) console.log(`  ${table}: ${rows.length}`);
  }
  for (const link of deferredLeadLinks(data)) {
    const { error } = await db.from("leads").update({ converted_deal_id: link.converted_deal_id }).eq("id", link.id);
    if (error) throw new Error(`leads link: ${error.message}`);
  }

  console.log("\nDone. Sign in with any of these accounts and the DEMO_USER_PASSWORD you set:");
  for (const p of data.profiles) console.log(`  ${p.email.padEnd(32)} ${p.role}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
