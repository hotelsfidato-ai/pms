/* ══════════════════════════════════════════════════════════════════
   THE OUTBOX — writes that have not reached the server yet

   Housekeeping has had a working offline queue since defect 49, and it
   is the right shape: a tap is held, the count is shown, and it drains
   in order when signal returns. It lives in `useState`.

   Which means a refresh loses it. A housekeeper's phone locking, the
   tab being closed, the browser reclaiming memory, a crash — every one
   of those silently discards work somebody believes they did. That is
   the same fault the queue was built to prevent, moved one layer out.

   So the queue lives in IndexedDB, and survives everything except
   somebody clearing site data.

   IT IS FIFO AND IT MATTERS. A check-in and the folio posting that
   follows it are not independent: sending the second first fails, and
   fails for a reason nobody reading the error would connect to
   ordering. Entries drain oldest first and a failure stops the drain
   rather than skipping past it.

   EVERY ENTRY CARRIES AN IDEMPOTENCY KEY, minted here, at the moment
   the person acted. `folio_postings.idempotency_key` has existed since
   migration 011 for exactly this — its comment reads "A POS terminal on
   dropping wifi WILL resend. Without a key the second write succeeds
   and a real guest is charged twice." The column and its unique index
   have been waiting; this is the client that was always meant to use
   them.

   The key is minted ONCE and reused on every retry. Minting a fresh one
   per attempt is the same as having none.
   ══════════════════════════════════════════════════════════════════ */

const DB_NAME = "fidato-outbox";
const DB_VERSION = 1;
const STORE = "mutations";

export type OutboxStatus = "waiting" | "rejected";

export interface OutboxEntry {
  id: string;
  /** What a person would call this. Shown in the pending list, so it
      says "Room 204 → clean", never "PATCH /api/hotels/5EL/rooms/…". */
  label: string;
  path: string;
  method: string;
  body?: string;
  /** Minted at enqueue, reused on every retry. The whole point. */
  idempotencyKey: string;
  hotelId: string;
  /** The person who ACTED, captured at the tap. A front desk is a
      shared machine, and an entry must not be sent as somebody else
      just because they are the one signed in when the line returns. */
  subject: string;
  queuedAt: number;
  attempts: number;
  status: OutboxStatus;
  /** The server's own sentence, when it refused. Kept verbatim: it
      names the conflict, and this project's rule is that a refusal
      says what to do about it. */
  error?: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

/** The one sentence for "this browser will not hold anything". Kept
    here so the bar and the queue say the same thing. */
export const NO_STORE =
  "This browser will not keep a queue - a private window, or site data "
  + "turned off. Work done here cannot be held until the line is back.";

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  /* ⚠ `indexedDB` IS NOT ALWAYS THERE. A private window refuses it, a
     browser set to block site data refuses it, and jsdom does not
     define the global at all — so the bare lookup below threw a
     ReferenceError rather than failing as a storage error.

     That reached `OfflineBar`, which read the queue on mount without a
     catch, as an unhandled rejection on EVERY mount. In a browser it
     was invisible; in the suite it landed inside whichever test was
     running when it fired, and `src/App.test.tsx` failed about one run
     in three — passing alone, failing in the full run. A gate that
     answers differently on the same code is not a gate.

     Named, so the refusal carries a sentence a person can act on. */
  if (typeof indexedDB === "undefined") {
    dbPromise = Promise.reject(new Error(NO_STORE));
    /* Nobody has attached a handler yet, and an unhandled rejection is
       precisely the thing being fixed. */
    dbPromise.catch(() => {});
    return dbPromise;
  }
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        /* Ordered by when the person acted, not by insertion order —
           they are the same today and would stop being the same the
           moment anything re-queues an entry. */
        store.createIndex("queuedAt", "queuedAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Is IndexedDB usable at all? Private windows and locked-down browsers
    both refuse it, and a queue that cannot persist must say so rather
    than pretend. */
export async function outboxAvailable(): Promise<boolean> {
  try {
    await open();
    return true;
  } catch {
    return false;
  }
}

export async function enqueue(
  entry: Omit<OutboxEntry, "id" | "queuedAt" | "attempts" | "status" | "idempotencyKey">,
): Promise<OutboxEntry> {
  const full: OutboxEntry = {
    ...entry,
    id: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    queuedAt: Date.now(),
    attempts: 0,
    status: "waiting",
  };
  await tx("readwrite", (s) => s.add(full));
  notify();
  return full;
}

/** Oldest first. The drain depends on this and so does the display. */
export async function list(): Promise<OutboxEntry[]> {
  const all = await tx<OutboxEntry[]>("readonly", (s) => s.getAll());
  return all.sort((a, b) => a.queuedAt - b.queuedAt);
}

export async function remove(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
  notify();
}

export async function update(entry: OutboxEntry): Promise<void> {
  await tx("readwrite", (s) => s.put(entry));
  notify();
}

/** Everything the server refused. These need a person: the server has
    already said no and retrying will get the same answer. */
export async function rejected(): Promise<OutboxEntry[]> {
  return (await list()).filter((e) => e.status === "rejected");
}

export async function waiting(): Promise<OutboxEntry[]> {
  return (await list()).filter((e) => e.status === "waiting");
}

export async function clearRejected(): Promise<void> {
  for (const e of await rejected()) await remove(e.id);
}

/* ── Telling the interface something changed ──────────────────────
   IndexedDB has no change events, so screens would poll or go stale.
   A plain listener set is enough and costs nothing. */
type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* One broken listener must not stop the others, and must not
         take down the write that triggered it. */
    }
  }
}
