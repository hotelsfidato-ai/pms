import pg from "pg";
import { env } from "./env.ts";

/* ══════════════════════════════════════════════════════════════════
   LIVE ORDERS — one listening connection, many watching screens

   The kitchen polled every ten seconds and a background tab was
   throttled to about a minute. A waiter adds a dish; the pass sees it
   when it happens now.

   ONE CONNECTION FOR THE WHOLE PROCESS. `LISTEN` occupies a connection
   for as long as it is listening, so this must never come from the
   pool — ten kitchen screens would be ten pool clients held open
   forever and the eleventh request would hang. One dedicated client,
   outside the pool, fanning out in memory to however many screens are
   watching. Twenty tills and four pass screens cost one connection.

   WHAT CROSSES THIS CHANNEL: a hotel id. Nothing else.

   The screen is told only that something in its own property moved and
   then re-reads through the ordinary authenticated endpoint, where row
   level security decides what it may see exactly as it always did. So
   the worst a mistake in this file can do is cause a needless refetch.
   It cannot put one property's orders on another's screen, and it
   cannot show a price to somebody who may not see one.

   IT MUST SURVIVE THE DATABASE GOING AWAY. A restart, a failover, a
   dropped idle connection: the listener reconnects with a backoff and
   the screens keep their own streams open. And every screen still
   holds its slow poll as a floor — a live channel that fails quietly
   is worse than no live channel, because nobody goes looking.
   ══════════════════════════════════════════════════════════════════ */

const CHANNEL = "pos_changed";

/** Hotel id → the callbacks watching it. */
const watchers = new Map<string, Set<() => void>>();

let client: pg.Client | null = null;
let backoffMs = 1_000;
let stopping = false;

/** Whether the listener currently holds a live connection. Reported on
    the stream so a screen can say "live" or fall back to its poll. */
export function isListening(): boolean {
  return client !== null;
}

function fanOut(hotelId: string): void {
  const set = watchers.get(hotelId);
  if (!set) return;
  for (const fn of set) {
    try {
      fn();
    } catch (error) {
      /* One screen's handler throwing must not stop the others being
         told. A stale stream is exactly the failure this file exists
         to remove. */
      console.error("[realtime] watcher threw", error);
    }
  }
}

async function connect(): Promise<void> {
  if (stopping) return;

  const c = new pg.Client({ connectionString: env.databaseUrl });

  c.on("error", (error) => {
    console.error("[realtime] listener connection error", error);
    /* `end()` may itself throw on an already-dead socket. The retry is
       what matters. */
    c.end().catch(() => {});
    if (client === c) client = null;
    schedule();
  });

  c.on("notification", (msg) => {
    if (msg.channel !== CHANNEL || !msg.payload) return;
    fanOut(msg.payload);
  });

  try {
    await c.connect();
    await c.query(`listen ${CHANNEL}`);
    client = c;
    backoffMs = 1_000;
    console.log("[realtime] listening for order changes");
  } catch (error) {
    console.error("[realtime] could not start listening", error);
    c.end().catch(() => {});
    schedule();
  }
}

function schedule(): void {
  if (stopping) return;
  const wait = backoffMs;
  /* Capped. A database that is down for an hour must not have this
     process retrying every second for an hour, nor give up entirely —
     a kitchen that comes back up should reconnect on its own without
     anybody restarting anything. */
  backoffMs = Math.min(backoffMs * 2, 30_000);
  setTimeout(() => void connect(), wait).unref?.();
}

/** Started once from the server. Safe to call twice. */
export function startListening(): void {
  if (client || stopping) return;
  void connect();
}

export async function stopListening(): Promise<void> {
  stopping = true;
  const c = client;
  client = null;
  if (c) await c.end().catch(() => {});
}

/**
 * Watch one hotel. Returns the unsubscribe, which the caller MUST run
 * when the screen goes away — a set that only ever grows is a leak that
 * looks like a slow memory climb over a week of service.
 */
export function watch(hotelId: string, fn: () => void): () => void {
  let set = watchers.get(hotelId);
  if (!set) {
    set = new Set();
    watchers.set(hotelId, set);
  }
  set.add(fn);

  return () => {
    const s = watchers.get(hotelId);
    if (!s) return;
    s.delete(fn);
    if (s.size === 0) watchers.delete(hotelId);
  };
}

/** For the health endpoint: how many screens are attached, and to how
    many properties. Cheap, and the first thing worth knowing when
    somebody says the kitchen has stopped updating. */
export function watcherCount(): { hotels: number; screens: number } {
  let screens = 0;
  for (const s of watchers.values()) screens += s.size;
  return { hotels: watchers.size, screens };
}
