/**
 * npm run demo:seed   - create .data/demo.json if it does not exist (keeps existing data)
 * npm run demo:reset  - overwrite .data/demo.json with a fresh seed
 *
 * The running dev server notices the file change and reloads it.
 */
import { createSeededStore, readStoreFile, writeStoreFile } from "../src/server/demo/file-store";

async function main() {
  const path = process.env.NEXORA_DEMO_DATA_PATH || ".data/demo.json";
  const reset = process.argv.includes("--reset");
  const existing = await readStoreFile(path);
  if (existing && !reset) {
    console.log(`Demo data already exists at ${path}. Use npm run demo:reset to start over.`);
    return;
  }
  const store = createSeededStore();
  await writeStoreFile(path, store);
  const counts = Object.entries(store.data)
    .filter(([, rows]) => rows.length > 0)
    .map(([table, rows]) => `${table}: ${rows.length}`)
    .join(", ");
  console.log(`${reset ? "Reset" : "Seeded"} demo data at ${path}\n${counts}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
