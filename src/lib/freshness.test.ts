import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { MONEY_KEYS, reCheckMoney } from "./freshness";

/* FIN-3, the owner's D17-58: a money figure is re-checked every time a screen
   opens or comes back into view. Everything else keeps the quiet default. */

const fresh = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, refetchOnWindowFocus: false } },
  });
  reCheckMoney(client);
  return client;
};

describe("money is re-checked", () => {
  it("makes every money key stale and refetched on focus", () => {
    const client = fresh();
    for (const key of MONEY_KEYS) {
      const d = client.getQueryDefaults([key, "5EL", "stay-1"]);
      expect(d.staleTime, key).toBe(0);
      expect(d.refetchOnWindowFocus, key).toBe(true);
    }
  });

  it("covers the bill, the balances, In house and Due out", () => {
    for (const key of ["folio", "folio-balance", "open-folios", "in-house", "departures", "stay-bill"]) {
      expect(MONEY_KEYS).toContain(key);
    }
  });

  it("covers Close restaurant day's figures (QA NA-3)", () => {
    expect(MONEY_KEYS).toContain("day-end");
  });

  it("leaves rooms, menus and the floor as they were", () => {
    const client = fresh();
    for (const key of ["rooms", "floor", "till-menu", "housekeeping"]) {
      expect(client.getQueryDefaults([key]).staleTime, key).toBeUndefined();
    }
  });
});
