import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { closePool } from "../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   ONE BOOKING REFERENCE — migration 092, RES-2

   The owner's format, 16 September: FH-<hotel code>-<YYMM>-<number>,
   e.g. FH-5EL-2608-4858. Made in one place, `app.next_reference`, under
   a per-hotel lock.

   WHAT A SEQUENTIAL TEST CANNOT PROVE, and why the last two tests race
   two open transactions: ask for a number, insert, ask again — of course
   the second is higher, the first row is committed and visible. The
   fault was two bookings in the same second, neither able to see the
   other. So the race is run twice: once with the inline SQL both routes
   used, to show the fault is real, and once through the function.

   NOTHING HERE LEAVES A TRACE. Every test that could raise this hotel's
   highest number runs inside a transaction that is rolled back, and the
   two rows the race commits are deleted by id. Another file that books
   at PUN afterwards sees the same maximum it would have seen anyway.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

interface Client {
  query: <T = Record<string, unknown>>(text: string, values?: unknown[]) => Promise<{ rows: T[] }>;
  release: () => void;
}

let pool: {
  connect: () => Promise<Client>;
  query: <T = Record<string, unknown>>(text: string, values?: unknown[]) => Promise<{ rows: T[] }>;
  end: () => Promise<void>;
};
let pun: string;
let roomTypeId: string;
let guestId: string;
const tag = `REF-${process.pid}`;
const committed: string[] = [];

/** The number at the end of a reference. */
const numberOf = (ref: string) => Number(ref.match(/(\d+)$/)![1]);

const insert = (c: Client, reference: string) =>
  c.query<{ id: string }>(
    `insert into reservations
       (hotel_id, guest_id, room_type_id, reference,
        check_in, check_out, adults, status, source, agreed_rate)
     values ($1,$2,$3,$4,'2031-01-10','2031-01-11',1,'confirmed','direct',2000)
     returning id`,
    [pun, guestId, roomTypeId, reference],
  );

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  const pg = (await import("pg")).default;
  pool = new pg.Pool({ connectionString: SUPER, max: 6 }) as unknown as typeof pool;

  pun = (await pool.query<{ id: string }>(
    "select id from hotels where code = 'PUN'")).rows[0]!.id;
  roomTypeId = (await pool.query<{ id: string }>(
    "select id from room_types where hotel_id = $1 order by sort_order limit 1",
    [pun])).rows[0]!.id;
  guestId = (await pool.query<{ id: string }>(
    `insert into guests (full_name, phone) values ($1, '+91 00000 00000')
     returning id`, [`${tag} guest`])).rows[0]!.id;
});

afterAll(async () => {
  if (committed.length) {
    await pool.query("delete from reservations where id = any($1)", [committed]);
  }
  await pool.query("alter table guests disable trigger guests_no_delete");
  await pool.query("delete from guests where full_name like $1", [`${tag}%`]);
  await pool.query("alter table guests enable trigger guests_no_delete");
  await pool.end();
  await closePool();
});

describe("a booking reference", () => {
  /* BK-12, the owner's D27-123: the month is the hotel's BUSINESS date,
     not the wall clock. The QA made FH-5EL-2609-5032 in September while
     the hotel was still working 25 August. Moved inside a transaction
     that is rolled back, to a month no clock is in. */
  it("is FH, the hotel's code, the month of the hotel's business date, and a number", async () => {
    /* A hotel of its own, made and gone inside one rolled-back transaction:
       in the full suite PUN has closed days, and a closed day overrides the
       column (app.business_date, 023). */
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query(
        "select set_config('app.user_id', (select id::text from staff where email = 'owner@fidato.in'), true)");
      const { rows: made } = await c.query<{ id: string }>(
        "select app.provision_property_unchecked('BKR','Reference Month Test','Nowhere')::text as id");
      const bkr = made[0]!.id;
      await c.query("update hotels set business_date = '2031-03-15' where id = $1", [bkr]);
      const { rows } = await c.query<{ ref: string; today: string }>(
        "select app.next_reference($1) as ref, app.business_date($1)::text as today", [bkr]);
      const { ref, today } = rows[0]!;

      expect(today, "a hotel with no closed day is on its column's date").toBe("2031-03-15");
      expect(ref).toMatch(/^FH-BKR-\d{4}-\d{4,}$/);
      expect(ref.split("-")[2], "the business month, not the clock's").toBe("3103");
    } finally {
      await c.query("rollback");
      c.release();
    }
  });

  it("continues the hotel's own count, so no reference repeats across the change", async () => {
    const c = await pool.connect();
    try {
      await c.query("begin");
      const first = (await c.query<{ ref: string }>(
        "select app.next_reference($1) as ref", [pun])).rows[0]!.ref;
      await insert(c, first);
      const second = (await c.query<{ ref: string }>(
        "select app.next_reference($1) as ref", [pun])).rows[0]!.ref;

      expect(numberOf(second)).toBe(numberOf(first) + 1);
    } finally {
      await c.query("rollback");
      c.release();
    }
  });

  it("follows a number issued in the OLD format too", async () => {
    const c = await pool.connect();
    try {
      await c.query("begin");
      const before = numberOf((await c.query<{ ref: string }>(
        "select app.next_reference($1) as ref", [pun])).rows[0]!.ref);

      /* A reference the old walk-in route would have made. */
      await insert(c, `FH-2608-${before + 40}`);
      const after = (await c.query<{ ref: string }>(
        "select app.next_reference($1) as ref", [pun])).rows[0]!.ref;

      expect(numberOf(after)).toBe(before + 41);
    } finally {
      await c.query("rollback");
      c.release();
    }
  });

  it("is never cut short once the number passes four digits", async () => {
    /* THE HIDDEN FAULT in both inline copies: lpad(n, 4, '0') CUTS a
       longer string. Proven here against Postgres itself first, so the
       assertion below is known to be testing something real. */
    const lpad = (await pool.query<{ cut: string }>(
      "select lpad('100000', 4, '0') as cut")).rows[0]!.cut;
    expect(lpad, "Postgres lpad truncates - the old generators' bug").toBe("1000");

    const c = await pool.connect();
    try {
      await c.query("begin");
      await insert(c, `${tag}-99999`);
      const ref = (await c.query<{ ref: string }>(
        "select app.next_reference($1) as ref", [pun])).rows[0]!.ref;

      expect(ref.endsWith("-100000"), `got ${ref}`).toBe(true);
    } finally {
      await c.query("rollback");
      c.release();
    }
  });
});

describe("two bookings in the same second", () => {
  it("collide through the inline SQL both routes used - the fault is real", async () => {
    const OLD = `select 'FH-' || to_char(now(), 'YYMM') || '-' ||
                        lpad((coalesce(max(substring(reference from '[0-9]+$')::int), 5000) + 1)::text, 4, '0')
                        as ref
                   from reservations where hotel_id = $1`;
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query("begin");
      await b.query("begin");
      const [ra, rb] = await Promise.all([
        a.query<{ ref: string }>(OLD, [pun]),
        b.query<{ ref: string }>(OLD, [pun]),
      ]);
      expect(ra.rows[0]!.ref, "both read the same maximum").toBe(rb.rows[0]!.ref);
    } finally {
      await a.query("rollback");
      await b.query("rollback");
      a.release();
      b.release();
    }
  });

  it("do not collide through app.next_reference - the second waits for the first", async () => {
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query("begin");
      await b.query("begin");

      const refA = (await a.query<{ ref: string }>(
        "select app.next_reference($1) as ref", [pun])).rows[0]!.ref;
      const idA = (await insert(a, refA)).rows[0]!.id;

      /* B asks while A holds the lock and has not committed. */
      const askB = b.query<{ ref: string }>(
        "select app.next_reference($1) as ref", [pun]);
      const waited = await Promise.race([
        askB.then(() => false),
        sleep(400).then(() => true),
      ]);
      expect(waited, "the second caller must wait for the first").toBe(true);

      await a.query("commit");
      committed.push(idA);

      const refB = (await askB).rows[0]!.ref;
      const idB = (await insert(b, refB)).rows[0]!.id;
      await b.query("commit");
      committed.push(idB);

      expect(refB).not.toBe(refA);
      expect(numberOf(refB)).toBe(numberOf(refA) + 1);
    } finally {
      await a.query("rollback").catch(() => {});
      await b.query("rollback").catch(() => {});
      a.release();
      b.release();
    }
  });
});
