import { get, set, del } from "idb-keyval";
import type { Persister, PersistedClient } from "@tanstack/react-query-persist-client";

/* ══════════════════════════════════════════════════════════════════
   THE READ CACHE, WRITTEN DOWN

   TanStack Query already caches every read. In memory — so a reload
   with no connection is a blank application, which is exactly the
   moment somebody needs it most: the housekeeper on a stairwell
   landing, the clerk whose tablet slept.

   IndexedDB rather than localStorage, and that is not a preference.
   localStorage is synchronous and caps around 5 MB; a tape chart and a
   floor plan for three properties go past that, and the write blocks
   the main thread on the way. `idb-keyval` is a thin wrapper over the
   same IndexedDB the outbox uses.

   IT IS A SEPARATE STORE FROM THE OUTBOX, deliberately. Reads are
   disposable — wrong, stale or absent, nobody loses work. The outbox
   holds things a person DID, and losing one of those is the fault this
   whole feature exists to prevent. Clearing the read cache to reclaim
   space must never be able to take the queue with it.
   ══════════════════════════════════════════════════════════════════ */

const KEY = "fidato-query-cache";

export const queryPersister: Persister = {
  persistClient: async (client: PersistedClient) => {
    try {
      await set(KEY, client);
    } catch {
      /* A full disk, a private window, a browser told to block site
         data. The application keeps working — it just will not open
         offline. Failing the render over a cache write would trade a
         convenience for the whole product. */
    }
  },

  restoreClient: async () => {
    try {
      return await get<PersistedClient>(KEY);
    } catch {
      return undefined;
    }
  },

  removeClient: async () => {
    try {
      await del(KEY);
    } catch {
      /* Nothing to do about it, and nothing depends on it. */
    }
  },
};
