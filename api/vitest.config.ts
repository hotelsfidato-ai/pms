import { defineConfig } from "vitest/config";

/* The isolation tests run against the live local Postgres. They are
   deliberately not mocked — a mocked pool would pass while the real
   one leaked, which is the failure worth catching. */
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
