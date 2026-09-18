import { describe, it, expect } from "vitest";
import { getStore, getStockHistory } from "@/modules/stores/data/stores";

/* ══════════════════════════════════════════════════════════════════
   A READ THAT FAILED IS NOT AN EMPTY STORE — STO-2

   Both reads ended in `catch { return [] }`, so an unreachable server drew
   "Nothing in the store yet — Add the first" over nine items. The screen's
   own test (`../stores.test.tsx`) replaces this file, so it cannot see that
   swallow come back; this can. The shared transport stub
   (`src/test/setup.ts`) answers the store's addresses with a 404, as an
   unknown address.
   ══════════════════════════════════════════════════════════════════ */

describe("the store's reads", () => {
  it("throw when the list could not be read, rather than answer empty", async () => {
    await expect(getStore("5EL")).rejects.toThrow();
  });

  it("throw when an item's history could not be read, rather than answer empty", async () => {
    await expect(getStockHistory("5EL", "any-item")).rejects.toThrow();
  });
});
