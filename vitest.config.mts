import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

/** Unit tests: pure logic, no database or network. Integration tests have their own config. */
export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/*/src/**/*.test.ts", "apps/web/lib/**/*.test.ts", "apps/worker/src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/*.integration.test.ts"],
    setupFiles: ["./test/setup.ts"],
    pool: "threads",
  },
  resolve: {
    alias: [
      { find: "server-only", replacement: `${root}test/server-only.ts` },
      { find: /^@\/(.*)$/, replacement: `${root}apps/web/$1` },
    ],
  },
});
