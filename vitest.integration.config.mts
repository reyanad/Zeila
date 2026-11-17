import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

/**
 * Integration tests run against a real PostgreSQL (with pgvector) whose schema
 * comes from the committed migrations. CI provides DATABASE_URL; locally use
 * `docker compose up -d postgres` and `npm run db:migrate`.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/*/src/**/*.integration.test.ts"],
    setupFiles: ["./test/setup.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: [{ find: "server-only", replacement: `${root}test/server-only.ts` }],
  },
});
