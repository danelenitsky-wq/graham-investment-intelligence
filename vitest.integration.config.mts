import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Integration tests: need a migrated PostgreSQL at DATABASE_URL (see README). No network access. */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
