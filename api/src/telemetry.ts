import type { MiddlewareHandler } from "hono";
import { matchedRoutes } from "hono/route";
import { pool } from "./db.ts";
import { env } from "./env.ts";

/* ══════════════════════════════════════════════════════════════════
   TELEMETRY ON OUR OWN SERVER (the owner's D27-92, 28 September)

   Every request's time and result, server errors and slow queries,
   counted in memory and written ONE MINUTE AT A TIME to two small tables
   (the telemetry migration) through app.record_telemetry(), which also deletes
   anything older than 180 days. Read on System health (D27-91).

   ⚠ NO GUEST DATA, EVER. What is kept is built here, from nothing that
   can carry it:
     a route      its PATTERN, /api/hotels/:code/stays/:id - never the
                  address, which holds ids, a hotel code, and on the
                  guest's door the link that IS the guest's credential
     an error     its KIND: a database error code and the constraint it
                  broke, or the program error's name. Never the message:
                  a database function's message can name a guest.
     a slow query the start of its SQL with every literal taken out.
                  Values travel as $1, $2 and are never seen here.
   ══════════════════════════════════════════════════════════════════ */

/** The steps the 95% figure is read off, in ms; one more count is "over 10 s". */
export const STEPS_MS = [25, 50, 100, 250, 500, 1000, 2500, 5000, 10000] as const;
/** A query slower than this is counted by name (the plan the owner approved). */
export const SLOW_QUERY_MS = 1000;

type Requests = { count: number; total_ms: number; max_ms: number; buckets: number[] };
type Event = { count: number; max_ms: number | null };

let requests = new Map<string, Requests>();
let events = new Map<string, Event>();

const minuteOf = (at: number) => new Date(at - (at % 60_000)).toISOString();
const SEP = "\u0001";

function addRequest(key: string, r: Requests) {
  const was = requests.get(key);
  if (!was) { requests.set(key, r); return; }
  was.count += r.count;
  was.total_ms += r.total_ms;
  was.max_ms = Math.max(was.max_ms, r.max_ms);
  r.buckets.forEach((n, i) => { was.buckets[i] = (was.buckets[i] ?? 0) + n; });
}

function addEvent(key: string, e: Event) {
  const was = events.get(key);
  if (!was) { events.set(key, e); return; }
  was.count += e.count;
  was.max_ms = e.max_ms === null ? was.max_ms : Math.max(was.max_ms ?? 0, e.max_ms);
}

/** What went wrong, with nothing in it that came from a row or a person. */
export function errorKind(error: unknown): string {
  const e = error as { code?: unknown; constraint?: unknown; name?: unknown } | null;
  /* A Postgres error carries its SQLSTATE (five characters) and, for a broken
     rule, the rule's name - both written by us in a migration, never by a
     guest. Anything else is named by its class. */
  if (e && typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) {
    return typeof e.constraint === "string" ? `${e.code} ${e.constraint}` : e.code;
  }
  return e && typeof e.name === "string" ? e.name : "Error";
}

/** A query's name: its SQL with every literal out, spaces collapsed, cut short. */
export function queryName(text: string): string {
  return text
    .replace(/'(?:[^']|'')*'/g, "?")
    .replace(/\b\d+(?:\.\d+)?\b/g, "?")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/** The route that answered, as its pattern; "(no route)" for a 404 with none. */
export const routeOf = (c: Parameters<MiddlewareHandler>[0]): string =>
  matchedRoutes(c).find((r) => r.method === c.req.method)?.path ?? "(no route)";

/* ── The middleware: one line in server.ts, after CORS ───────────── */

export const telemetry: MiddlewareHandler = async (c, next) => {
  const started = performance.now();
  await next();
  const ms = Math.round(performance.now() - started);
  const route = routeOf(c);
  const minute = minuteOf(Date.now());
  const buckets = new Array<number>(STEPS_MS.length + 1).fill(0);
  const step = STEPS_MS.findIndex((limit) => ms <= limit);
  buckets[step === -1 ? STEPS_MS.length : step] = 1;
  const status = c.res.status;
  addRequest([minute, c.req.method, route, status].join(SEP),
    { count: 1, total_ms: ms, max_ms: ms, buckets });
  if (status >= 500) {
    addEvent([minute, "error", `${c.req.method} ${route}`, errorKind(c.error)].join(SEP),
      { count: 1, max_ms: null });
  }
};

/* ── Slow queries: every pool client's query, timed ──────────────
   pg has no hook for this, so each client the pool makes has its query
   wrapped once, here, rather than timing every call site. The caller
   gets pg's own promise back untouched; only a copy is watched. The
   LISTEN connection (realtime.ts) is not the pool's and is not timed. */
pool.on("connect", (client) => {
  const query = client.query.bind(client) as (...args: unknown[]) => unknown;
  (client as { query: unknown }).query = (...args: unknown[]) => {
    const started = performance.now();
    const result = query(...args);
    if (result && typeof (result as Promise<unknown>).then === "function") {
      const done = () => {
        const ms = Math.round(performance.now() - started);
        if (ms < SLOW_QUERY_MS) return;
        const first = args[0] as string | { text?: string };
        const text = typeof first === "string" ? first : first?.text ?? "";
        addEvent([minuteOf(Date.now()), "slow_query", "", queryName(text)].join(SEP),
          { count: 1, max_ms: ms });
      };
      (result as Promise<unknown>).then(done, done);
    }
    return result;
  };
});

/* ── Writing it down ─────────────────────────────────────────────── */

/** Writes what has been counted so far. A failure puts it back for next time.
    Called even with nothing counted: the 180 days are kept by this same call. */
export async function flush(): Promise<void> {
  const r = requests, e = events;
  requests = new Map();
  events = new Map();
  const rows = [...r].map(([key, v]) => {
    const [minute, method, route, status] = key.split(SEP);
    return { minute, method, route, status: Number(status), ...v };
  });
  const evs = [...e].map(([key, v]) => {
    const [minute, kind, place, what] = key.split(SEP);
    return { minute, kind, place, what, ...v };
  });
  try {
    const client = await pool.connect();
    try {
      await client.query("select app.record_telemetry($1::jsonb, $2::jsonb)",
        [JSON.stringify(rows), JSON.stringify(evs)]);
    } finally {
      client.release();
    }
  } catch (error) {
    r.forEach((v, k) => addRequest(k, v));
    e.forEach((v, k) => addEvent(k, v));
    console.error("[telemetry] could not write the last minute:", errorKind(error));
  }
}

/* Once a minute, from the first request on. Never under the tests, where
   nothing may run on a timer (they call flush() themselves), and unref'd so
   it never holds the process open.
   ponytail: the last minute's counts are lost on a restart; flush in
   server.ts's shutdown if that ever matters. */
if (env.nodeEnv !== "test") setInterval(() => void flush(), 60_000).unref();
