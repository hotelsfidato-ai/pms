import { it, expect } from "vitest";
import { poolSize } from "../src/env.ts";

/* DB_POOL_MAX (D27-278): several customers' APIs share one Postgres, so
   each pool is a setting. Unset keeps D27-165's 20; a typo refuses to start
   rather than open a pool of NaN or 0. */
it("sizes the database pool from DB_POOL_MAX", () => {
  expect(poolSize(undefined)).toBe(20);
  expect(poolSize("")).toBe(20);
  expect(poolSize("8")).toBe(8);
  for (const bad of ["0", "101", "7.5", "ten", "-3"]) {
    expect(() => poolSize(bad)).toThrow(/DB_POOL_MAX/);
  }
});
