import { get, set, del, keys, createStore } from "idb-keyval";

/* ══════════════════════════════════════════════════════════════════
   THE DRAFT — an order being taken, not yet sent

   A waiter builds a round at the table: six taps, no network. Between
   the first tap and Send there is work nobody has recorded anywhere,
   and a phone that sleeps, locks, runs out of battery or is simply put
   in a pocket loses all of it. Retaking an order in front of a guest is
   the thing this feature exists to avoid.

   So a half-taken order is written down as it grows.

   ⚠ THIS IS A SEPARATE STORE FROM THE OUTBOX, AND THAT IS THE POINT.

   Everything in the outbox is destined for the server; the drain sends
   it the moment signal returns, oldest first, without asking. A draft
   is the opposite — it may never be sent at all, and a waiter may
   abandon it. Putting the two in one store means a half-taken order
   leaves for the kitchen because the wifi came back, which is the
   sharpest version of the fault the outbox was built to prevent.

   It is also separate from the read cache (`persist.ts`). That one may
   be cleared to reclaim space; this one holds something a person did.

   ONE DRAFT PER TABLE, not per waiter. Two waiters at the same table
   are working on the same round, and the floor is the shared truth.

   PRICES ARE COPIED IN, not looked up again on read. The menu may be
   refreshed between a dish going on and the draft being reopened, and a
   total that silently changes under the waiter is worse than one that
   is a season out of date. What the pad shows is what the waiter saw
   when they said it aloud. The BILL is the server's, always.
   ══════════════════════════════════════════════════════════════════ */

const store = createStore("fidato-drafts", "drafts");

/** One dish on the pad. Carries both what the server needs to price it
    and what the pad needs to show it — the pad cannot look a name up
    from an id without the menu, and the menu may be absent. */
export interface DraftLine {
  /** Local only. Two identical dishes with different sides are two
      lines, and the pad needs to tell them apart before either has an
      id from the server. */
  uid: string;
  itemId: string;
  name: string;
  qty: number;
  note: string;

  variationId?: string;
  variationLabel?: string;
  addonIds: string[];
  addonLabels: string[];

  /** What one of this dish costs, sides included, AT THE MOMENT IT WENT
      ON. Display only — the server prices the bill from its own menu
      and its figure wins. */
  unitPrice: number;
}

export interface Draft {
  key: string;
  hotelId: string;
  outlet: string;
  tableId: string;
  tableLabel: string;
  /** Set when the table already had an open order, so the round joins
      that bill instead of starting a second one on the same table. */
  orderId?: string;
  lines: DraftLine[];
  /** So a draft from three days ago can be recognised as stale by
      whoever opens it. Not used to expire anything automatically —
      deleting a waiter's work on a timer is its own defect. */
  updatedAt: string;
}

export function draftKey(
  hotelId: string, outlet: string, tableId: string,
): string {
  return `${hotelId}:${outlet}:${tableId}`;
}

/* ── Is there anywhere to write? ──────────────────────────────────
   A private window, a browser told to block site data, a full disk.
   The pad still works — it just will not survive the app closing, and
   the waiter is told that once rather than discovering it.

   Answered by TRYING, not by feature-detecting: `indexedDB` exists in
   a private Firefox window and throws on open. */
let usable: boolean | null = null;

export async function draftsUsable(): Promise<boolean> {
  if (usable !== null) return usable;
  try {
    await get("__probe", store);
    usable = true;
  } catch {
    usable = false;
  }
  return usable;
}

export async function loadDraft(key: string): Promise<Draft | null> {
  try {
    return (await get<Draft>(key, store)) ?? null;
  } catch {
    return null;
  }
}

export async function saveDraft(draft: Draft): Promise<void> {
  try {
    await set(draft.key, { ...draft, updatedAt: new Date().toISOString() }, store);
  } catch {
    /* Nothing to do here that helps. The pad holds the same lines in
       memory and keeps working; `draftsUsable` is what tells the
       waiter, and it is asked once when the pad opens rather than
       shouting on every tap. */
  }
}

export async function clearDraft(key: string): Promise<void> {
  try {
    await del(key, store);
  } catch {
    /* A draft that cannot be deleted is a draft that was never
       written. */
  }
}

/**
 * Which tables in this hotel have an unsent round on them.
 *
 * The floor uses this to mark them. A round left on the pad is
 * invisible otherwise — the kitchen has nothing, the bill has nothing,
 * and only the phone in one waiter's pocket knows.
 */
export async function draftedTables(hotelId: string): Promise<Set<string>> {
  const found = new Set<string>();
  try {
    for (const k of await keys(store)) {
      if (typeof k !== "string") continue;
      const [hotel, , tableId] = k.split(":");
      if (hotel === hotelId && tableId) found.add(tableId);
    }
  } catch {
    /* No store, no marks. The floor is still correct about everything
       the server knows. */
  }
  return found;
}

/* ── What the pad's total is ──────────────────────────────────────
   ⚠ THIS ARITHMETIC ALSO EXISTS ON THE SERVER, and that is a rule
   written in two places — the defect shape this codebase produces more
   than any other. It is here deliberately, because the owner decided a
   waiter must be able to answer "how much is that?" at the table
   without a round trip.

   The guard is `api/test/padTotal.test.ts`: the same lines are priced
   here and by the server, and the two must agree. If you change how a
   dish is priced ANYWHERE, that test is the one that catches you.

   What this is NOT: the bill. No tax, no discount, no round-off, no
   service charge. Those are the server's and the pad never guesses at
   them. */
export function draftTotal(lines: DraftLine[]): number {
  return lines.reduce((sum, l) => sum + l.unitPrice * l.qty, 0);
}

export function draftCount(lines: DraftLine[]): number {
  return lines.reduce((n, l) => n + l.qty, 0);
}
