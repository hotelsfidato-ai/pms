import { Hono } from "hono";
import { execFileSync } from "node:child_process";
import { readFile, stat, statfs } from "node:fs/promises";
import { withSession } from "../../auth.ts";
import { pool, type Client } from "../../db.ts";
import { STEPS_MS } from "../../telemetry.ts";
import { readBackupStatus, backupLog } from "../connections-health/index.ts";

/* ══════════════════════════════════════════════════════════════════
   SYSTEM HEALTH (the owner's D27-91, 28 September)

     GET /:code/system-health   the owner and an administrator

   What is going on on the server, from our own data - nothing leaves it:
   the API's version and uptime, the database's size and the pool, the
   disk, the requests of the last hour, day and week (api/src/telemetry.ts,
   the telemetry migration), each hotel's business date and last night audit, and
   the last nightly backup.

   WHO is the role gate's (roleGate.ts READ_RULES, SYSTEM_HEALTH) before
   this runs, and the database's behind it: the telemetry tables answer
   only app.reads_system_health(). The hotel in the address is only where
   the person is standing. The traffic is the whole server's, all hotels
   together and naming none; the hotels listed are the ones this person
   works at.
   ══════════════════════════════════════════════════════════════════ */

export const systemHealth = new Hono<{ Variables: { subject: string } }>();

/* What is RUNNING: read once, when this process started. "-" when the
   server's copy is not a git checkout or git is not there to ask. */
const VERSION = (() => {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8", timeout: 5000 }).trim();
  } catch {
    return "-";
  }
})();

export type BackupState = {
  state: "passed" | "failed" | "unknown" | "none" | "unreadable";
  at: string | null;
  offsite: "copied" | "failed" | "this disk only" | null;
};

/** The last night's run, from the nightly check's `backup-status` line, read by
    Connection health's reader (D27-279 (5), D27-284 (5)): one reader, one format.
    A log from before that line: "unknown", at the log's own time. A failed run
    that copied nothing leaves `offsite` blank: the line cannot tell a failed copy
    from a server with no bucket. `fileTime` is the log's last change. */
export function backupFromLog(text: string, fileTime: string): BackupState {
  const { last } = readBackupStatus(text);
  if (!last) return { state: "unknown", at: fileTime, offsite: null };
  return {
    state: last.ok ? "passed" : "failed",
    at: last.at,
    offsite: last.uploaded ? "copied" : last.ok ? "this disk only" : null,
  };
}

async function lastBackup(): Promise<BackupState> {
  try {
    const log = backupLog();
    const [text, info] = await Promise.all([readFile(log, "utf8"), stat(log)]);
    return backupFromLog(text, info.mtime.toISOString());
  } catch (error) {
    const code = (error as { code?: string }).code;
    return { state: code === "ENOENT" ? "none" : "unreadable", at: null, offsite: null };
  }
}

async function disk(): Promise<{ freeBytes: number; totalBytes: number } | null> {
  try {
    const s = await statfs("/");
    return { freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize };
  } catch {
    return null;
  }
}

/** The step 95% of these answered within, in ms; null for none, -1 for "over 10 s". */
export function p95(buckets: number[]): number | null {
  const total = buckets.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  let seen = 0;
  for (let i = 0; i < buckets.length; i++) {
    seen += buckets[i] ?? 0;
    if (seen >= total * 0.95) return STEPS_MS[i] ?? -1;
  }
  return -1;
}

/* Each period as a sparkline: its slots, oldest first. */
const PERIODS = {
  hour: { span: "1 hour", slotSeconds: 300, slots: 12 },
  day: { span: "1 day", slotSeconds: 3600, slots: 24 },
  week: { span: "7 days", slotSeconds: 21600, slots: 28 },
} as const;

async function traffic(client: Client, period: (typeof PERIODS)[keyof typeof PERIODS]) {
  /* The buckets of every row, summed by slot and step. A row's buckets add up
     to its count, so the 5xx rows' buckets add up to the errors. */
  const { rows } = await client.query<{ slot: number; step: number; n: number; errors: number | null }>(
    `select floor(extract(epoch from now() - minute) / $2)::int as slot, u.i::int as step,
            sum(u.v)::int as n, (sum(u.v) filter (where status >= 500))::int as errors
       from telemetry_requests, unnest(buckets) with ordinality as u(v, i)
      where minute > now() - $1::interval
      group by 1, 2`,
    [period.span, period.slotSeconds]);
  const width = STEPS_MS.length + 1;
  const slots = Array.from({ length: period.slots }, () => ({ requests: 0, errors: 0, buckets: new Array<number>(width).fill(0) }));
  const all = new Array<number>(width).fill(0);
  for (const r of rows) {
    const s = slots[period.slots - 1 - Math.min(r.slot, period.slots - 1)]!;
    s.requests += r.n;
    s.errors += r.errors ?? 0;
    s.buckets[r.step - 1]! += r.n;
    all[r.step - 1]! += r.n;
  }
  return {
    requests: slots.reduce((a, s) => a + s.requests, 0),
    errors: slots.reduce((a, s) => a + s.errors, 0),
    p95Ms: p95(all),
    series: slots.map((s) => ({ requests: s.requests, errors: s.errors, p95Ms: p95(s.buckets) })),
  };
}

systemHealth.get("/:code/system-health", async (c) => {
  const code = c.req.param("code");
  const [found, backup, space] = await Promise.all([
    withSession(c.get("subject"), async (client) => {
      const here = await client.query(
        "select 1 from hotels where code = upper($1) and id in (select app.auth_hotel_ids())", [code]);
      if (here.rowCount !== 1) return null;

      const size = await client.query<{ bytes: string }>(
        "select pg_database_size(current_database())::text as bytes");
      const hour = await traffic(client, PERIODS.hour);
      const day = await traffic(client, PERIODS.day);
      const week = await traffic(client, PERIODS.week);
      const slowest = await client.query<{ method: string; route: string; requests: number; avg_ms: number; max_ms: number }>(
        `select method, route, sum(count)::int as requests,
                round(sum(total_ms)::numeric / sum(count))::int as avg_ms, max(max_ms) as max_ms
           from telemetry_requests
          where minute > now() - interval '1 day' and route <> '(no route)'
          group by method, route
          order by avg_ms desc limit 5`);
      const events = await client.query<{ kind: string; place: string; what: string; count: number; max_ms: number | null; last: string }>(
        `select kind, place, what, sum(count)::int as count, max(max_ms) as max_ms, max(minute) as last
           from telemetry_events
          where minute > now() - interval '7 days'
          group by kind, place, what
          order by last desc limit 20`);
      const hotels = await client.query<{
        code: string; name: string; business_date: string; today: string;
        last_audit_at: string | null; last_run: string | null;
      }>(
        `select h.code, h.name,
                to_char(app.business_date(h.id), 'YYYY-MM-DD') as business_date,
                to_char((now() at time zone h.timezone)::date, 'YYYY-MM-DD') as today,
                (select max(na.completed_at) from night_audit_runs na
                  where na.hotel_id = h.id and na.status = 'completed') as last_audit_at,
                (select na.status from night_audit_runs na
                  where na.hotel_id = h.id order by na.started_at desc limit 1) as last_run
           from hotels h
          where h.id in (select app.auth_hotel_ids()) and h.is_active
            /* D27-296: kept apart from everything real. */
            and h.test_of is null
          order by h.code`);

      /* The leads app's reads (D27-168, D27-170), by Google's own day: the
         free allowance resets at midnight Pacific. Group-wide, no guest. */
      const reads = await client.query<{ day: string; reads: number }>(
        `select to_char((minute at time zone 'America/Los_Angeles')::date, 'YYYY-MM-DD') as day,
                sum(count)::int as reads
           from telemetry_events
          where kind = 'firestore_read' and minute > now() - interval '7 days'
          group by 1 order by 1 desc`);
      const cap = Math.floor(Number(process.env["M2R_DAILY_READS"]));

      return {
        leadsReads: { cap: cap > 0 ? cap : null, days: reads.rows },
        databaseBytes: Number(size.rows[0]?.bytes ?? 0),
        traffic: { hour, day, week },
        slowest: slowest.rows.map((r) => ({ method: r.method, route: r.route, requests: r.requests, avgMs: r.avg_ms, maxMs: r.max_ms })),
        errors: events.rows.filter((e) => e.kind === "error")
          .map((e) => ({ place: e.place, what: e.what, count: e.count, last: e.last })),
        slowQueries: events.rows.filter((e) => e.kind === "slow_query")
          .map((e) => ({ what: e.what, count: e.count, maxMs: e.max_ms, last: e.last })),
        hotels: hotels.rows.map((h) => ({
          code: h.code, name: h.name, businessDate: h.business_date, today: h.today,
          lastAuditAt: h.last_audit_at, lastRun: h.last_run,
        })),
      };
    }),
    lastBackup(),
    disk(),
  ]);
  if (!found) return c.json({ error: "No such property." }, 404);

  return c.json({
    version: VERSION,
    startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    pool: {
      inUse: pool.totalCount - pool.idleCount,
      waiting: pool.waitingCount,
      max: pool.options.max ?? 20,
    },
    disk: space,
    backup,
    ...found,
  });
});
