import type { QueryClient } from "@tanstack/react-query";

/* ══════════════════════════════════════════════════════════════════
   MONEY IS RE-CHECKED — FIN-3, the owner's D17-58, 17 September

   Every query in this application is `staleTime: Infinity` and does not
   refetch on focus (App.tsx), which is right for rooms and menus and wrong
   for money: a payment taken at one desk left In house at another desk
   showing the balance from before it, until somebody reloaded. The owner's
   answer: a money figure is re-checked every time a screen is opened or
   brought back into view.

   So these keys are always stale. Opening a screen refetches them; coming
   back to the tab refetches them. Nothing else changes — a room list, a
   menu or a floor plan keeps the quiet it has.

   A PREFIX list, matched element by element (`["folio"]` does not match
   `["folio-balance", …]`), so every money key is named on its own.
   ══════════════════════════════════════════════════════════════════ */

export const MONEY_KEYS: readonly string[] = [
  "folio", "folio-postings", "folio-balance", "open-folios", "stay-folios",
  /* The Interim bill (29 September, the folio lane): opened once, it kept its
     first answer, and a restaurant, spa or laundry charge made since was not
     on it until a reload. */
  "stay-bill",
  "in-house", "departures",
  "payments", "payments-by-method", "city-ledger", "cashier-drawer",
  "billable", "invoice",
  "dashboard-manager", "dashboard",
  /* Close restaurant day (QA NA-3): opened before the evening's bills were
     settled, it went on saying "Settled ₹0" at the count. */
  "day-end",
];

export function reCheckMoney(client: QueryClient): void {
  for (const key of MONEY_KEYS) {
    client.setQueryDefaults([key], { staleTime: 0, refetchOnWindowFocus: true, refetchOnMount: true });
  }
}
