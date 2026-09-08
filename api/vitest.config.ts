import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/* The isolation tests run against the live local Postgres. They are
   deliberately not mocked — a mocked pool would pass while the real
   one leaked, which is the failure worth catching. */
export default defineConfig({
  /* `@` reaches the FRONTEND's source, so `padTotal.test.ts` can price
     lines with the very function the order pad uses rather than a
     reimplementation of it. A test that copies the formula it is
     checking proves only that the copy agrees with itself. */
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
