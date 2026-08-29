import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { closePool } from "../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   CONCURRENCY — two clerks, one room, the same moment

   The schema has carried two EXCLUDE constraints since migrations 005
   and 011, and until now NOTHING had ever raced them. They were
   believed to work. That is a different thing from knowing.

   WHY A SEQUENTIAL TEST PROVES NOTHING HERE

   Insert two overlapping bookings one after another and the second
   fails — of course it does, the first is committed and visible. The
   only interesting case is the one that actually happens at a front
   desk: two clerks, two open transactions, neither able to see the
   other's uncommitted row. A plain unique index would let BOTH commit,
   because neither transaction can see what the other is doing.

   A GiST exclusion constraint takes a real lock. That is the whole
   reason it is used instead of a check in application code, and it is
   what these tests force it to demonstrate.

   WHAT IS RACED

     ra_no_double_booking   two room assignments, same room,
                            overlapping dates, neither released

   Only one, not two. `reservations_no_double_booking` does not survive
   a full migration run — see the note further down, which is what
   writing this file discovered.

   And one more guarantee that is not an EXCLUDE but has the same
   shape: a posting may be reversed ONCE. Migration 021 replaced a
   `FOR UPDATE` that pms_app is not permitted to run with a unique
   index on reverses_id, so two clerks pressing Reverse together hand
   the guest their money back once, not twice.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

interface PgClient {
  query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
  release: () => void;
}

async function makePool() {
  const pg = (await import("pg")).default;
  return new pg.Pool({ connectionString: SUPER, max: 6 });
}

let pool: Awaited<ReturnType<typeof makePool>>;
let puneId: string;
let roomId: string;
let roomTypeId: string;
let guestId: string;

const tag = `RACE-${process.pid}`;

beforeAll(async () => {
  pool = await makePool();

  const hotel = await pool.query<{ id: string }>(
    "select id from hotels where code = 'PUN'",
  );
  puneId = hotel.rows[0]!.id;

  const room = await pool.query<{ id: string; type_id: string }>(
    `select rm.id, rm.room_type_id as type_id from rooms rm
      where rm.hotel_id = $1 order by rm.number limit 1`,
    [puneId],
  );
  roomId = room.rows[0]!.id;
  roomTypeId = room.rows[0]!.type_id;

  const guest = await pool.query<{ id: string }>(
    `insert into guests (full_name, phone)
     values ($1, '+91 00000 00000') returning id`,
    [`${tag} guest`],
  );
  guestId = guest.rows[0]!.id;
});

afterAll(async () => {
  /* Reservations and assignments made here are removable — unlike the
     ledger, they are not append-only, and leaving overlapping bookings
     on a room would make every later run of this file race against its
     own history rather than against itself. */
  await pool.query(
    `delete from room_assignments where reservation_id in
       (select id from reservations where hotel_id = $1
         and reference like $2)`,
    [puneId, `${tag}%`],
  );
  await pool.query(
    "delete from reservations where hotel_id = $1 and reference like $2",
    [puneId, `${tag}%`],
  );
  /* The guest ROW stays. The schema refuses to remove one — "A guest is
     never deleted — stay history and the audit trail depend on the
     row" — and it is right: a guest is a person who was here, not a
     fixture. The bookings above are removable because they were never
     real; the person notionally attached to them is a row this test
     had no business creating and none removing.

     Third time this session the database has refused one of my writes,
     and third time it was correct. */
  await pool.end();
  await closePool();
});

/**
 * Run two units of work in two SIMULTANEOUS transactions.
 *
 * Both transactions are opened, both issue their statement, and only
 * then is either committed. That ordering is the whole point: if the
 * first committed before the second even ran, this would be a
 * sequential test wearing a costume.
 *
 * THE PART THAT TOOK A REWRITE
 *
 * An EXCLUDE constraint does not reject the second writer immediately.
 * It BLOCKS it, holding the statement open until the first transaction
 * commits or rolls back — which is exactly the guarantee being tested,
 * and which made the first version of this helper hang for twenty
 * seconds and fail on a timeout. `Promise.all` waits for both inserts
 * before committing either, so neither could ever finish.
 *
 * So: race them, commit whichever landed first, and only THEN await
 * the other — which unblocks the instant the winner commits, and comes
 * back with the exclusion violation. That sequence is what happens at
 * a real front desk, in the order it happens.
 */
async function race(
  work: (client: PgClient, which: 1 | 2) => Promise<void>,
): Promise<{ committed: number; errors: string[] }> {
  const a = (await pool.connect()) as unknown as PgClient;
  const b = (await pool.connect()) as unknown as PgClient;
  const errors: string[] = [];
  let committed = 0;

  const settle = async (c: PgClient, p: Promise<unknown>): Promise<boolean> => {
    try {
      await p;
      await c.query("commit");
      return true;
    } catch (e) {
      errors.push((e as Error).message);
      await c.query("rollback").catch(() => undefined);
      return false;
    }
  };

  try {
    await a.query("begin");
    await b.query("begin");

    /* A ceiling, so a genuine deadlock fails the test rather than
       hanging it. Long enough that normal lock waits are unaffected. */
    await a.query("set local lock_timeout = '10s'");
    await b.query("set local lock_timeout = '10s'");

    const pa = work(a, 1);
    const pb = work(b, 2);

    /* Do not let an unhandled rejection escape while we wait on the
       other one — node will kill the process for it. */
    pa.catch(() => undefined);
    pb.catch(() => undefined);

    /* Whichever statement returns first is the writer that got the
       lock. The other is blocked ON it, and cannot resolve until this
       one commits. */
    const winner = await Promise.race([
      pa.then(() => "a" as const),
      pb.then(() => "b" as const),
    ]);

    if (winner === "a") {
      if (await settle(a, pa)) committed += 1;
      if (await settle(b, pb)) committed += 1;
    } else {
      if (await settle(b, pb)) committed += 1;
      if (await settle(a, pa)) committed += 1;
    }
  } finally {
    a.release();
    b.release();
  }

  return { committed, errors };
}

const isoDay = (offset: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

/* ══════════════════════════════════════════════════════════════════
   A NOTE ON `reservations_no_double_booking`

   There is no test for it here, because after a full migration run it
   DOES NOT EXIST. 005_reservations.sql creates it; 011 drops
   `reservations.room_id`, and dropping a column drops the constraints
   that depend on it.

   That is correct — a single room_id could not record a room move —
   and the protection moved to room_assignments, which is what actually
   holds a room. But 005 still lectures for fifteen lines about a
   guarantee that is gone by the end of the run, and anyone reading it
   would believe reservations are protected. A note now says so, and
   this was found by writing a test against a constraint pg_constraint
   had never heard of.

   **Testing a thing is how you discover whether it is there.**
   ══════════════════════════════════════════════════════════════════ */

/* ── The same room, assigned twice ────────────────────────────────── */

describe("ra_no_double_booking", () => {
  it("lets exactly one of two simultaneous overlapping assignments through", async () => {
    const from = isoDay(1000 + (process.pid % 200));
    const to = isoDay(1003 + (process.pid % 200));

    /* Two reservations that do NOT clash on the reservations table —
       no room_id — so the only thing that can stop the second
       assignment is the constraint on room_assignments itself. */
    const made: string[] = [];
    for (const n of [1, 2]) {
      const r = await pool.query<{ id: string }>(
        `insert into reservations
           (hotel_id, guest_id, room_type_id, reference,
            check_in, check_out, adults, status, source, agreed_rate)
         values ($1,$2,$3,$4,$5::date,$6::date,1,'confirmed','direct',2000)
         returning id`,
        [puneId, guestId, roomTypeId, `${tag}-ra-${n}`, from, to],
      );
      made.push(r.rows[0]!.id);
    }

    const { committed, errors } = await race(async (client, which) => {
      await client.query(
        `insert into room_assignments
           (hotel_id, reservation_id, room_id, from_date, to_date, reason)
         values ($1,$2,$3,$4::date,$5::date,'arrival')`,
        [puneId, made[which - 1], roomId, from, to],
      );
    });

    expect(
      committed,
      committed === 2
        ? "The same room was assigned to two guests for the same nights. " +
          "Both will be given a key to it."
        : `Neither assignment succeeded: ${errors.join(" ")}`,
    ).toBe(1);
    expect(errors.join(" ")).toMatch(/no_double_booking|exclusion/i);
  });
});

/* ── Reversed once, not twice ─────────────────────────────────────── */

describe("a posting can be reversed once", () => {
  it("refuses a second reversal raced against the first", async () => {
    /* Migration 021 exists because the obvious guard — SELECT ... FOR
       UPDATE on the posting — is a privilege pms_app does not hold on
       an append-only table. A unique index on reverses_id does the
       same job without one. */
    const folio = await pool.query<{ id: string }>(
      `select f.id from folios f where f.hotel_id = $1 limit 1`, [puneId],
    );
    if (!folio.rows[0]) {
      throw new Error(
        "No folio at Pune to reverse against. This test cannot prove " +
          "anything — run the night audit tests first, which create one.",
      );
    }

    const original = await pool.query<{ id: string }>(
      /* The property's OWN operating day, not current_date. Pune's
         business date runs ahead of the calendar — the night audit
         tests close a day on every run — and posting onto a closed
         date is refused by a trigger, correctly. The first version of
         this test used current_date and was rejected with
         "Business date 2026-08-29 is closed for this property". */
      `insert into folio_postings
         (hotel_id, folio_id, business_date, category, description, amount)
       values ($1,$2,app.business_date($1),'misc',$3,500)
       returning id::text`,
      [puneId, folio.rows[0].id, `${tag} to be reversed`],
    );
    const target = original.rows[0]!.id;

    const { committed, errors } = await race(async (client) => {
      await client.query(
        `insert into folio_postings
           (hotel_id, folio_id, business_date, category, description,
            amount, reverses_id)
         select $1, folio_id, business_date, category,
                'Reversal — ' || description, -amount, id
           from folio_postings where id = $2::bigint`,
        [puneId, target],
      );
    });

    expect(
      committed,
      committed === 2
        ? "The posting was reversed TWICE. The guest has been credited " +
          "the amount twice over and the folio is short by it."
        : `Neither reversal committed: ${errors.join(" ")}`,
    ).toBe(1);
    expect(errors.join(" ")).toMatch(/reverses|unique|duplicate/i);

    /* Count it, rather than trusting the commit count. */
    const check = await pool.query<{ n: string }>(
      `select count(*)::text as n from folio_postings
        where reverses_id = $1::bigint`,
      [target],
    );
    expect(Number(check.rows[0]!.n)).toBe(1);
  });
});
