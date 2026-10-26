import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    // Tests assert English texts; Russian is covered by tests that switch the locale themselves.
    env: { NEXORA_LOCALE: "en" },
    // "server-only" throws outside React Server Components; tests import server modules directly.
    alias: { "server-only": fileURLToPath(new URL("./tests/unit/server-only-stub.ts", import.meta.url)) },
  },
});
