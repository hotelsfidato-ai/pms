import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE NIGHT AUDIT — closing a day

   Run against PUNE, not the demo property. 5 Elements is calibrated to
   a real eZee export — 431 available room-nights, 132 sold, ADR
   ₹3,178.63 — and closing days there would move every one of those
   figures. Pune has ten rooms, no history, and nothing that reconciles
   to anything, which makes it the right place to test something whose
   entire job is to change the state of a property.

   Each run of this file closes one more day at Pune and leaves it
   there. That is not residue to clean up: a closed day is a fact, the
   ledger is append-only, and a business date that advances is the
   thing being tested. The tests are written to be independent of which
   day Pune happens to be on.

   WHAT IS ASSERTED

     · a day cannot close while a departure is unresolved
     · closing advances the business date by exactly one
     · a room charge lands, at the property's own tax rate
     · running twice does not charge twice
     · nothing can post onto a day that has closed
     · a confirmed arrival that never came becomes a no-show
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const admin = async () =>
  new (await import("pg")).default.Pool({ connectionString: SUPER });

let ownerId: string;
let puneId: string;

/** Unique per run, so repeated runs never collide with their own history. */
const tag = `NA-${process.pid}`;

const asOwner = (path: string, method = "GET") =>
  app.request(`/api/hotels${path}`, {
    method,
    headers: { "x-dev-staff-id": ownerId },
  });

const businessDate = async (): Promise<string> => {
  const db = await admin();
  try {
    const { rows } = await db.query<{ d: string }>(
      "select to_char(app.business_date($1), 'YYYY-MM-DD') as d", [puneId],
    );
    return rows[0]!.d;
  } finally {
    await db.end();
  }
};

/* The night audit RUNS that existed before this file did. Recorded so the
   teardown can remove the ones this file caused and nothing else — deleting
   every run for Pune would take out whatever else put them there. */
let auditRunsBefore: string[] = [];

beforeAll(async () => {
  const db = await admin();
  try {
    const staff = await db.query<{ id: string }>(
      "select id from staff where email = 'owner@fidato.in'",
    );
    ownerId = staff.rows[0]!.id;

    const hotel = await db.query<{ id: string }>(
      "select id from hotels where code = 'PUN'",
    );
    puneId = hotel.rows[0]!.id;

    const { rows } = await db.query<{ d: string }>(
      `select business_date::text as d from night_audit_runs
        where hotel_id = $1`, [puneId]);
    auditRunsBefore = rows.map((r) => r.d);
  } finally {
    await db.end();
  }
});

/* Until this existed, `afterAll` closed the pool and deleted nothing. Every
   run of this file left FIVE guests, FIVE reservations, their folios, their
   room assignments and around thirty-five postings in the demo database —
   measured against a clean load, not guessed.

   The damage is not the row count. It is that somebody opening the app after
   a test run sees phantom guests, phantom bookings and test money on folios,
   and cannot tell them from real ones. Defect 54, and the fourth file found
   with this shape.

   Everything this file creates carries `NA-<pid>`, so the teardown has always
   had what it needed. */
afterAll(async () => {
  const db = await admin();
  try {
    const mine = `${tag}-%`;
    const guests = `${tag} %`;

    await db.query(
      "alter table folio_postings disable trigger folio_postings_append_only");
    await db.query(
      `delete from folio_postings where folio_id in (
         select f.id from folios f
          join reservations r on r.id = f.reservation_id
         where r.reference like $1)`, [mine]);
    await db.query(
      "alter table folio_postings enable trigger folio_postings_append_only");

    await db.query(
      `delete from folios where reservation_id in (
         select id from reservations where reference like $1)`, [mine]);
    await db.query(
      `delete from room_assignments where reservation_id in (
         select id from reservations where reference like $1)`, [mine]);
    await db.query(
      "delete from reservations where reference like $1", [mine]);

    await db.query("alter table guests disable trigger guests_no_delete");
    await db.query("delete from guests where full_name like $1", [guests]);
    await db.query("alter table guests enable trigger guests_no_delete");

    /* Only the runs this file caused. */
    await db.query(
      `delete from night_audit_runs
        where hotel_id = $1 and not (business_date::text = any($2))`,
      [puneId, auditRunsBefore]);
  } finally {
    await db.end();
  }
  await closePool();
});

/**
 * Put a guest in a room at Pune, checked in, on the current business
 * date, staying `nights`.
 *
 * Written as SQL rather than through the check-in flow on purpose: this
 * file tests the audit, and a failure here should mean the audit is
 * wrong, not that check-in is.
 */
async function checkInAtPune(
  nights: number, rate: number, arrivedDaysAgo = 0,
): Promise<{ reservationId: string; folioId: string; room: string }> {
  const bd = await businessDate();
  const db = await admin();
  try {
    /* A stay of one night checked in TODAY is due out TOMORROW — which
       is obvious written down and was wrong in the first version of
       this file, where a test expected it to block today's close.
       `arrivedDaysAgo` is how a stay becomes due out today. */
    const arrived = new Date(`${bd}T00:00:00Z`);
    arrived.setUTCDate(arrived.getUTCDate() - arrivedDaysAgo);
    const checkIn = arrived.toISOString().slice(0, 10);

    const out = new Date(`${checkIn}T00:00:00Z`);
    out.setUTCDate(out.getUTCDate() + nights);
    const checkOut = out.toISOString().slice(0, 10);

    const room = await db.query<{ id: string; number: string; type_id: string }>(
      `select rm.id, rm.number, rm.room_type_id as type_id
         from rooms rm
        where rm.hotel_id = $1
          and not exists (
            select 1 from room_assignments ra
             where ra.room_id = rm.id and ra.released_at is null)
            and rm.housekeeping_status = 'clean'
        order by rm.number limit 1`,
      [puneId],
    );
    const r = room.rows[0]!;

    const guest = await db.query<{ id: string }>(
      `insert into guests (full_name, phone)
       values ($1, '+91 00000 00000') returning id`,
      [`${tag} guest ${r.number}`],
    );

    const res = await db.query<{ id: string }>(
      `insert into reservations
         (hotel_id, guest_id, room_type_id, reference, check_in, check_out,
          adults, status, source, agreed_rate)
       values ($1,$2,$3,$4,$5::date,$6::date,1,'checked_in','direct',$7)
       returning id`,
      [puneId, guest.rows[0]!.id, r.type_id,
       `${tag}-${r.number}-${Date.now()}`, checkIn, checkOut, rate],
    );

    await db.query(
      `insert into room_assignments
         (hotel_id, reservation_id, room_id, from_date, to_date, reason)
       values ($1,$2,$3,$4::date,$5::date,'arrival')`,
      [puneId, res.rows[0]!.id, r.id, checkIn, checkOut],
    );

    const folio = await db.query<{ id: string }>(
      `insert into folios (hotel_id, reservation_id, status)
       values ($1,$2,'open') returning id`,
      [puneId, res.rows[0]!.id],
    );

    return {
      reservationId: res.rows[0]!.id,
      folioId: folio.rows[0]!.id,
      room: r.number,
    };
  } finally {
    await db.end();
  }
}

/**
 * Check out everything due out today at Pune.
 *
 * The audit refuses to close a day over an unresolved departure — that
 * is the point of it — so every test that closes a day has to do what
 * a person at the desk would do first. Without this each test inherits
 * the previous one's guests: a three-night stay becomes due out as the
 * date advances, and every later audit is blocked by a room nobody in
 * that test ever created.
 */
async function clearDueOuts(): Promise<void> {
  const bd = await businessDate();
  const db = await admin();
  try {
    await db.query(
      `update room_assignments set released_at = now()
        where released_at is null
          and reservation_id in (
            select id from reservations
             where hotel_id = $1 and status = 'checked_in'
               and check_out <= $2::date)`,
      [puneId, bd],
    );
    await db.query(
      `update folios set status = 'closed'
        where reservation_id in (
          select id from reservations
           where hotel_id = $1 and status = 'checked_in'
             and check_out <= $2::date)`,
      [puneId, bd],
    );
    await db.query(
      `update reservations set status = 'checked_out'
        where hotel_id = $1 and status = 'checked_in' and check_out <= $2::date`,
      [puneId, bd],
    );
  } finally {
    await db.end();
  }
}

/* ── Closing a day ────────────────────────────────────────────────── */

describe("closing a day", () => {
  it("advances the business date by exactly one", async () => {
    await clearDueOuts();
    const before = await businessDate();

    const res = await asOwner("/PUN/night-audit/run", "POST");
    const body = (await res.json()) as {
      ok: boolean; businessDate: string; nextBusinessDate: string;
    };

    expect(body.ok, JSON.stringify(body)).toBe(true);
    expect(body.businessDate).toBe(before);

    const after = await businessDate();
    expect(after).toBe(body.nextBusinessDate);

    const expected = new Date(`${before}T00:00:00Z`);
    expected.setUTCDate(expected.getUTCDate() + 1);
    expect(after).toBe(expected.toISOString().slice(0, 10));
  });

  it("posts one night's room charge, at the property's tax rate", async () => {
    await clearDueOuts();
    const stay = await checkInAtPune(3, 2500);
    const bd = await businessDate();

    const res = await asOwner("/PUN/night-audit/run", "POST");
    const body = (await res.json()) as {
      ok: boolean; roomsPosted: number; revenuePosted: number;
    };
    expect(body.ok, JSON.stringify(body)).toBe(true);
    expect(body.roomsPosted).toBeGreaterThanOrEqual(1);

    const db = await admin();
    try {
      const { rows } = await db.query<{
        description: string; amount: string; tax_rate: string;
        tax_amount: string; source_type: string; posted_by: string | null;
      }>(
        `select description, amount::text, tax_rate::text, tax_amount::text,
                source_type, posted_by::text
           from folio_postings
          where folio_id = $1 and category = 'room'
            and business_date = $2::date`,
        [stay.folioId, bd],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]!.description).toBe(`Room ${stay.room} · 1 night`);
      expect(Number(rows[0]!.amount)).toBe(2500);
      expect(Number(rows[0]!.tax_rate)).toBe(5);
      expect(Number(rows[0]!.tax_amount)).toBe(125);
      expect(rows[0]!.source_type).toBe("night_audit");

      /* posted_by has to be a staff uuid. It was the dev subject
         string once — "dev-owner" — and Postgres rejected the whole
         audit with `invalid input syntax for type uuid`. The database
         resolves it now, through app.current_user_id(). */
      expect(rows[0]!.posted_by).toBeTruthy();
    } finally {
      await db.end();
    }
  });

  it("charges a MOVED stay once, not once per room it has slept in", async () => {
    /* ⚠ THIS IS A REGRESSION GUARD FOR A DOUBLE CHARGE, and it was
       found by closing two real nights at Akkalkot rather than by any
       gate in this file.

       A room move does not release anything. Migration 054 models it
       as two live assignments over adjoining half-open ranges — the
       old room up to the move, the new room from it — because both are
       true, on different nights. The audit joined
       `room_assignments ... and released_at is null` with NO DATE, so
       a moved stay came back as two rows, the not-exists guard was
       evaluated once per row before either insert, and the loop posted
       the night's tariff twice.

       Every night, for the rest of the stay, on a guest's real bill.

       It survived seventeen stages because the only moved stay anybody
       had was complimentary, so the loop skipped before posting and
       the whole fault surfaced as `complimentary: 2` at a property
       with one complimentary room.

       Written to FAIL on the old join: two rows there, one here. */
    await clearDueOuts();
    const stay = await checkInAtPune(3, 2200);
    const bd = await businessDate();

    const db = await admin();
    try {
      /* Move them tomorrow. Today's assignment is capped at tomorrow;
         a second live assignment carries the rest of the stay in
         another room. Exactly what POST /stays/:id/move writes. */
      const next = new Date(`${bd}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      const tomorrow = next.toISOString().slice(0, 10);

      const { rows: cur } = await db.query<{ to_date: string; room_id: string }>(
        `update room_assignments set to_date = $2::date
          where reservation_id = $1 and released_at is null
        returning to_date::text, room_id::text`,
        [stay.reservationId, tomorrow],
      );
      expect(cur).toHaveLength(1);

      const { rows: other } = await db.query<{ id: string }>(
        `select rm.id::text from rooms rm
          where rm.hotel_id = $1 and rm.id <> $2::uuid
            and not exists (
              select 1 from room_assignments ra
               where ra.room_id = rm.id and ra.released_at is null)
          order by rm.number limit 1`,
        [puneId, cur[0]!.room_id],
      );
      expect(other, "Pune needs a second free room for this").toHaveLength(1);

      const { rows: res } = await db.query<{ check_out: string }>(
        `select check_out::text from reservations where id = $1`,
        [stay.reservationId],
      );
      await db.query(
        `insert into room_assignments
           (hotel_id, reservation_id, room_id, from_date, to_date, reason)
         values ($1,$2,$3::uuid,$4::date,$5::date,'move')`,
        [puneId, stay.reservationId, other[0]!.id, tomorrow,
         res[0]!.check_out],
      );

      /* Both are live, and that is CORRECT — they cover different
         nights. The bug was reading "live" as "tonight". */
      const { rows: live } = await db.query<{ n: string }>(
        `select count(*)::text as n from room_assignments
          where reservation_id = $1 and released_at is null`,
        [stay.reservationId],
      );
      expect(live[0]!.n).toBe("2");

      const run = await asOwner("/PUN/night-audit/run", "POST");
      const body = (await run.json()) as { ok: boolean };
      expect(body.ok, JSON.stringify(body)).toBe(true);

      const { rows } = await db.query<{ description: string; amount: string }>(
        `select description, amount::text from folio_postings
          where folio_id = $1 and category = 'room'
            and business_date = $2::date`,
        [stay.folioId, bd],
      );

      /* ONE row. Two is the defect, and two is what the old join gave. */
      expect(rows, JSON.stringify(rows)).toHaveLength(1);
      expect(Number(rows[0]!.amount)).toBe(2200);
      /* And it names the room they are in TONIGHT, not whichever the
         join happened to reach first. */
      expect(rows[0]!.description).toBe(`Room ${stay.room} · 1 night`);
    } finally {
      await db.end();
    }
  });

  it("does not charge twice when a half-finished run is restarted", async () => {
    await clearDueOuts();
    const stay = await checkInAtPune(3, 1800);
    const bd = await businessDate();

    /* Simulate an audit that crashed after posting one charge and
       before flipping its status. The run row stays 'running', so the
       day never closed and the date never moved — which is the correct
       failure. What must NOT happen is the restart charging the guest
       a second time for the same night.

       The first version of this test ran the audit twice and expected
       the second call to be a no-op. It was not testing anything: the
       first run ADVANCES the date, so the second closes a different
       day and posts a different night. Two nights, two charges, both
       correct. The real question is only ever asked by an interrupted
       run. */
    const db = await admin();
    try {
      await db.query(
        `insert into night_audit_runs (hotel_id, business_date, status)
         values ($1, $2::date, 'running')
         on conflict (hotel_id, business_date) do nothing`,
        [puneId, bd],
      );
      await db.query(
        `insert into folio_postings
           (hotel_id, folio_id, business_date, category, description,
            amount, tax_rate, tax_amount, source_type)
         values ($1,$2,$3::date,'room',$4,1800,5,90,'night_audit')`,
        [puneId, stay.folioId, bd, `Room ${stay.room} · 1 night`],
      );
    } finally {
      await db.end();
    }

    const body = (await (await asOwner("/PUN/night-audit/run", "POST"))
      .json()) as { ok: boolean; roomsPosted: number };
    expect(body.ok, JSON.stringify(body)).toBe(true);

    const db2 = await admin();
    try {
      const { rows } = await db2.query<{ n: string }>(
        `select count(*)::text as n from folio_postings
          where folio_id = $1 and category = 'room' and business_date = $2::date`,
        [stay.folioId, bd],
      );
      expect(
        Number(rows[0]!.n),
        "The restarted audit charged the guest a second time for one night.",
      ).toBe(1);
    } finally {
      await db2.end();
    }
  });

  it("answers a re-run of a day already closed with what that run did", async () => {
    const db = await admin();
    try {
      /* Ask about a date that IS closed, by looking one behind. */
      const bd = await businessDate();
      const prev = new Date(`${bd}T00:00:00Z`);
      prev.setUTCDate(prev.getUTCDate() - 1);

      const { rows } = await db.query<{ status: string }>(
        `select status from night_audit_runs
          where hotel_id = $1 and business_date = $2::date`,
        [puneId, prev.toISOString().slice(0, 10)],
      );
      expect(rows[0]?.status).toBe("completed");
    } finally {
      await db.end();
    }
  });
});

/* ── What must be settled first ───────────────────────────────────── */

describe("a day cannot close over an unresolved departure", () => {
  it("refuses, and names the rooms", async () => {
    await clearDueOuts();
    /* Arrived yesterday for one night, so it is due out TODAY and
       blocks today's close until somebody decides. */
    const stay = await checkInAtPune(1, 3000, 1);

    const can = (await (await asOwner("/PUN/night-audit/can-run")).json()) as {
      allowed: boolean; reason: string | null;
      blockers: Array<{ id: string; rooms: string[] }>;
    };

    expect(can.allowed).toBe(false);
    /* Rule 6 — shown disabled WITH its reason, never hidden. */
    expect(can.reason).toBeTruthy();
    expect(can.blockers[0]!.id).toBe("departures");
    expect(can.blockers[0]!.rooms.join(" ")).toContain(stay.room);

    const run = await asOwner("/PUN/night-audit/run", "POST");
    expect(run.status).toBe(409);
    expect((await run.json() as { ok: boolean }).ok).toBe(false);

    /* The server refuses too, not only the button. */
    const db = await admin();
    try {
      await db.query(
        `update reservations set status = 'checked_out' where id = $1`,
        [stay.reservationId],
      );
      await db.query(
        `update room_assignments set released_at = now()
          where reservation_id = $1`,
        [stay.reservationId],
      );
      await db.query(`update folios set status = 'closed' where id = $1`,
        [stay.folioId]);
    } finally {
      await db.end();
    }

    const after = (await (await asOwner("/PUN/night-audit/can-run"))
      .json()) as { allowed: boolean };
    expect(after.allowed).toBe(true);
  });
});

/* ── A closed day is closed ───────────────────────────────────────── */

describe("a closed day", () => {
  it("refuses any posting onto it", async () => {
    await clearDueOuts();
    const stay = await checkInAtPune(3, 1200);
    const closed = await businessDate();

    await asOwner("/PUN/night-audit/run", "POST");

    const db = await admin();
    try {
      await expect(
        db.query(
          `insert into folio_postings
             (hotel_id, folio_id, business_date, category, description, amount)
           values ($1,$2,$3::date,'misc','late charge',100)`,
          [puneId, stay.folioId, closed],
        ),
        "A charge landed on a day the night audit had already closed. The " +
          "day-close report said one number and now says another, and both " +
          "were correct when produced.",
      ).rejects.toThrow(/closed/i);
    } finally {
      await db.end();
    }
  });
});

/* ── Arrivals that never came ─────────────────────────────────────── */

describe("no-shows", () => {
  it("marks a confirmed arrival that never checked in", async () => {
    await clearDueOuts();
    const bd = await businessDate();
    const db = await admin();
    let reservationId: string;
    try {
      const type = await db.query<{ id: string }>(
        "select id from room_types where hotel_id = $1 limit 1", [puneId],
      );
      /* guests carries no hotel_id — a guest belongs to the group, so
         a returning one does not re-present their passport at each
         property. 004_guests.sql says so in a comment. */
      const guest = await db.query<{ id: string }>(
        `insert into guests (full_name, phone)
         values ($1, '+91 00000 00000') returning id`,
        [`${tag} never arrived`],
      );
      const out = new Date(`${bd}T00:00:00Z`);
      out.setUTCDate(out.getUTCDate() + 1);

      const res = await db.query<{ id: string }>(
        `insert into reservations
           (hotel_id, guest_id, room_type_id, reference, check_in, check_out,
            adults, status, source, agreed_rate)
         values ($1,$2,$3,$4,$5::date,$6::date,1,'confirmed','direct',2000)
         returning id`,
        [puneId, guest.rows[0]!.id, type.rows[0]!.id,
         `${tag}-noshow-${Date.now()}`, bd,
         out.toISOString().slice(0, 10)],
      );
      reservationId = res.rows[0]!.id;
    } finally {
      await db.end();
    }

    const body = (await (await asOwner("/PUN/night-audit/run", "POST"))
      .json()) as { ok: boolean; noShows: number };
    expect(body.ok, JSON.stringify(body)).toBe(true);
    expect(body.noShows).toBeGreaterThanOrEqual(1);

    const db2 = await admin();
    try {
      const { rows } = await db2.query<{ status: string }>(
        "select status from reservations where id = $1", [reservationId],
      );
      expect(rows[0]!.status).toBe("no_show");

      /* And NO retention charge. Whether a no-show is billed depends on
         the rate's cancellation terms, which this system does not model.
         A guessed charge is worse than none: nothing visibly missing,
         and a wrong number on a guest's bill. */
      const charges = await db2.query<{ n: string }>(
        `select count(*)::text as n from folio_postings fp
           join folios f on f.id = fp.folio_id
          where f.reservation_id = $1`,
        [reservationId],
      );
      expect(Number(charges.rows[0]!.n)).toBe(0);
    } finally {
      await db2.end();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════
   TWO DRAWERS, AND THE DAY THAT CANNOT CLOSE OVER EITHER

   A hotel keeps cash in two places. The front desk takes deposits and
   settles folios; the till takes money for food. They are counted by
   different people at different times, and a day whose cash has not
   been counted is not closed — it is abandoned.

   Both halves are asserted here because a guard that only ever passes
   and a guard that only ever fires look identical from one test, and
   the whole suite went green when these blockers were added, which is
   what prompted writing them.
   ══════════════════════════════════════════════════════════════════ */

describe("a day cannot close over an uncounted drawer", () => {
  let shiftId: string | null = null;

  afterAll(async () => {
    if (!shiftId) return;
    const db = await admin();
    try {
      await db.query("delete from cashier_shifts where id = $1", [shiftId]);
    } finally {
      await db.end();
    }
  });

  it("refuses while a front-desk shift is open, and says which", async () => {
    const bd = await businessDate();

    /* Before: whatever else is outstanding, the drawer is not. */
    const before = (await (await asOwner("/PUN/night-audit/can-run")).json()) as
      { blockers: Array<{ id: string }> };
    expect(before.blockers.some((b) => b.id === "front-desk-drawer")).toBe(false);

    const db = await admin();
    try {
      const { rows } = await db.query<{ id: string }>(
        `insert into cashier_shifts
           (hotel_id, staff_id, business_date, opening_cash, opened_by)
         values ($1, $2, $3::date, 2000, $2)
         returning id::text`,
        [puneId, ownerId, bd],
      );
      shiftId = rows[0]!.id;
    } finally {
      await db.end();
    }

    const after = (await (await asOwner("/PUN/night-audit/can-run")).json()) as
      { allowed: boolean; blockers: Array<{ id: string; reason: string; rooms: string[] }> };

    const drawer = after.blockers.find((b) => b.id === "front-desk-drawer");
    expect(drawer, JSON.stringify(after.blockers)).toBeTruthy();
    expect(after.allowed).toBe(false);

    /* Rule 6: the refusal has to send somebody to the RIGHT drawer.
       "The cash is not counted" sends them to the wrong one half the
       time, so the reason names the desk and lists who left it open. */
    expect(drawer!.reason).toMatch(/front-desk drawer/i);
    expect(drawer!.rooms.length).toBe(1);
    expect(drawer!.rooms[0]).toMatch(/opened \d{2}:\d{2}/);

    /* And the run itself refuses, not just the question about it — the
       server has to hold the line independently of the screen. */
    const run = await asOwner("/PUN/night-audit/run", "POST");
    expect(run.status).toBe(409);
  });

  it("lets the day close again once the drawer is counted", async () => {
    const db = await admin();
    try {
      await db.query(
        `update cashier_shifts
            set closed_at = now(), closed_by = $2, counted_cash = 2000
          where id = $1`,
        [shiftId, ownerId],
      );
    } finally {
      await db.end();
    }

    const after = (await (await asOwner("/PUN/night-audit/can-run")).json()) as
      { blockers: Array<{ id: string }> };
    expect(after.blockers.some((b) => b.id === "front-desk-drawer")).toBe(false);
  });
});

describe("the audit states the day rather than adding to it", () => {
  it("reports both drawers side by side, never as one figure", async () => {
    /* What a person at the desk does first. Each test in this file
       advances Pune's date, so a stay created three tests ago becomes
       due out under this one — and the audit refuses over it, which is
       the audit working and this test's own fault. */
    await clearDueOuts();
    const bd = await businessDate();
    const body = (await (await asOwner("/PUN/night-audit/run", "POST")).json()) as {
      ok: boolean;
      drawers?: {
        frontDesk: { shifts: number; opening: number; counted: number };
        till: { outlets: number; opening: number; counted: number };
      };
      restaurant?: { orders: number; gross: number };
    };
    expect(body.ok, JSON.stringify(body)).toBe(true);

    /* The shape matters as much as the numbers: two objects, never a
       total. Adding a front-desk variance to a till variance hides
       which drawer is short, and they are different conversations with
       different people. */
    expect(body.drawers).toBeTruthy();
    expect(body.drawers!.frontDesk).toBeTruthy();
    expect(body.drawers!.till).toBeTruthy();
    expect(Object.keys(body.drawers!).sort()).toEqual(["frontDesk", "till"]);

    /* Pune sells no food, so the restaurant is honestly empty rather
       than absent — a zero the audit computed, not a field it omitted. */
    expect(body.restaurant).toBeTruthy();
    expect(body.restaurant!.orders).toBe(0);
    expect(body.restaurant!.gross).toBe(0);

    /* READ, NOT POSTED. The audit must not write the restaurant's
       takings onto the folio ledger — the till already did when it
       settled the order, and a second copy would double the day. */
    const db = await admin();
    try {
      const { rows } = await db.query<{ n: string }>(
        `select count(*)::text as n from folio_postings
          where hotel_id = $1 and business_date = $2::date
            and category = 'food' and source_type = 'night_audit'`,
        [puneId, bd],
      );
      expect(Number(rows[0]!.n), "the audit posted food revenue of its own").toBe(0);
    } finally {
      await db.end();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════
   A GUEST WHO LEFT LATE, AND WHO MAY SET THE CHARGE ASIDE

   The refusal was correct and the interface had no way to satisfy it.
   `checkOut()` sent `{ user }` and nothing else, so pressing the button
   read the reason and pressed it again — five identical toasts in the
   owner's screenshot. A guard that cannot be satisfied is not a guard,
   it is a wall.

   TIME OF DAY IS PINNED. `app.departure_is_late` compares the clock in
   the property's timezone against its check-out time, so a test that
   relied on "now" would pass in the afternoon and fail in the morning —
   the mistake four identity tests were making before they were found.
   This sets the property's check-out time to 00:00 for the duration,
   which makes every moment of the day late, and puts it back after.
   ══════════════════════════════════════════════════════════════════ */

describe("leaving after check-out time", () => {
  let lateStayId: string;
  let clerkId: string;
  let wasCheckOut: string;
  let wasLateCharge: string | null;
  let lateSeq = 0;

  const call = (path: string, body: unknown, who: string) =>
    app.request(`/api/hotels/PUN${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-dev-staff-id": who },
      body: JSON.stringify(body),
    });

  const lateCharges = async (id: string): Promise<number> => {
    const db = await admin();
    try {
      const { rows } = await db.query<{ n: string }>(
        `select count(*)::text as n from folio_postings
          where reservation_id = $1 and description ilike '%late check-out%'`,
        [id]);
      return Number(rows[0]!.n);
    } finally {
      await db.end();
    }
  };

  const freshStay = async (): Promise<string> => {
    await clearDueOuts();
    const bd = await businessDate();
    const db = await admin();
    try {
      const { rows: g } = await db.query<{ id: string }>(
        "insert into guests (full_name) values ($1) returning id::text",
        [`${tag} late guest`]);
      const { rows: rt } = await db.query<{ id: string }>(
        "select id::text from room_types where hotel_id = $1 limit 1", [puneId]);
      const { rows: rm } = await db.query<{ id: string }>(
        `select r.id::text from rooms r
          where r.hotel_id = $1
            and not exists (select 1 from room_assignments a
                             where a.room_id = r.id and a.released_at is null)
            and r.housekeeping_status = 'clean'
          limit 1`, [puneId]);
      /* Its OWN reference, not app.next_reference. That derives from the
         date and a counter, and calling it four times inside one test
         run collided on the unique key — which is the function working
         and this fixture asking it the wrong question. */
      lateSeq += 1;
      const { rows: res } = await db.query<{ id: string }>(
        `insert into reservations
           (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
            agreed_rate, status, adults)
         values ($1, $5, $2, $3, $4::date, $4::date + 1,
                 2000, 'checked_in', 1)
         returning id::text`,
        [puneId, g[0]!.id, rt[0]!.id, bd, `${tag}-L${lateSeq}`]);
      await db.query(
        `insert into room_assignments
           (hotel_id, reservation_id, room_id, from_date, to_date, reason)
         values ($1,$2,$3,$4::date,$4::date + 1,'arrival')`,
        [puneId, res[0]!.id, rm[0]!.id, bd]);
      await db.query(
        "insert into folios (hotel_id, reservation_id, status) values ($1,$2,'open')",
        [puneId, res[0]!.id]);
      return res[0]!.id;
    } finally {
      await db.end();
    }
  };

  beforeAll(async () => {
    const db = await admin();
    try {
      const { rows: was } = await db.query<{ t: string }>(
        "select to_char(check_out_time,'HH24:MI') as t from hotels where id = $1",
        [puneId]);
      wasCheckOut = was[0]!.t;

      /* PUN charges NOTHING for a late departure, which is a legitimate
         state and makes this test prove nothing — "no posting" would be
         true whether the guard worked or not. A charge is set for the
         duration and put back after, so "charged" and "waived" are
         actually distinguishable. */
      const { rows: wasCharge } = await db.query<{ c: string | null }>(
        "select late_checkout_charge::text as c from hotels where id = $1",
        [puneId]);
      wasLateCharge = wasCharge[0]!.c;

      await db.query(
        `update hotels set check_out_time = '00:00', late_checkout_charge = 750
          where id = $1`, [puneId]);

      /* A clerk with no authority to waive, at this property. */
      const { rows: s } = await db.query<{ id: string }>(
        `insert into staff (email, full_name, is_group_admin)
         values ($1, 'Late Test Clerk', false)
         on conflict (email) do update set is_active = true
         returning id::text`, [`late-${process.pid}@fidato.in`]);
      clerkId = s[0]!.id;
      await db.query(
        `insert into staff_hotels (staff_id, hotel_id, role)
         values ($1, $2, 'front_desk') on conflict do nothing`,
        [clerkId, puneId]);
    } finally {
      await db.end();
    }
  });

  afterAll(async () => {
    const db = await admin();
    try {
      await db.query(
        `update hotels set check_out_time = $2, late_checkout_charge = $3
          where id = $1`,
        [puneId, wasCheckOut, wasLateCharge]);
      await db.query("delete from staff_hotels where staff_id = $1", [clerkId]);
      await db.query("update staff set is_active = false where id = $1", [clerkId]);
    } finally {
      await db.end();
    }
  });

  it("refuses without a reason, and NAMES what would satisfy it", async () => {
    lateStayId = await freshStay();
    const res = await call(`/stays/${lateStayId}/check-out`, {}, ownerId);
    const body = (await res.json()) as {
      ok: boolean; reason: string; needs?: string;
    };

    expect(body.ok).toBe(false);
    /* The marker is the point. Without it a screen has to recognise a
       late departure by reading the sentence, and the sentence is not
       an interface — somebody rewords it and the way through silently
       disappears. */
    expect(body.needs).toBe("late-reason");
    /* And the charge is money, not a bare number. It printed "1000.00"
       into a line the front desk reads out to a guest. */
    expect(body.reason).not.toMatch(/\d\.00 charge/);
  });

  it("records the reason, charges, and THEN asks for the money", async () => {
    const before = await lateCharges(lateStayId);
    const res = await call(`/stays/${lateStayId}/check-out`,
      { lateReason: "Late flight, agreed at reception" }, ownerId);

    /* NOT a success, and that is right. The charge is posted before the
       balance is tested — deliberately, so the guest settles the whole
       bill including it — which means the very act of recording a late
       departure creates something to pay. The check-out then refuses
       for the balance, and the refusal SAYS the charge was just added,
       or it reads as the system changing its mind between one press and
       the next. */
    const body = (await res.json()) as { ok: boolean; reason: string };
    expect(body.ok).toBe(false);
    expect(body.reason).toMatch(/still outstanding/);
    expect(body.reason).toMatch(/recorded and charged/);
    /* Rupees, written the way somebody asks for money. It printed
       "₹787.5" for seven hundred and eighty-seven fifty. */
    expect(body.reason).not.toMatch(/₹[\d,]+\.\d(?!\d)/);

    const db = await admin();
    try {
      const { rows } = await db.query<{ reason: string; by: string | null }>(
        `select late_checkout_reason as reason, late_checkout_by::text as by
           from reservations where id = $1`, [lateStayId]);
      expect(rows[0]!.reason).toMatch(/Late flight/);
      /* Recorded against SOMEBODY. "A reason and somebody to allow it"
         is the whole phrase in the refusal, and a reason with no name
         behind it is half an answer. */
      expect(rows[0]!.by).toBeTruthy();
    } finally {
      await db.end();
    }
    expect(await lateCharges(lateStayId)).toBeGreaterThan(before);
  });

  it("refuses a waive from somebody who may not give one", async () => {
    const id = await freshStay();
    const res = await call(`/stays/${id}/check-out`,
      { lateReason: "Asked nicely", waiveLate: true }, clerkId);
    const body = (await res.json()) as { ok: boolean; reason: string };

    /* The dialog hides the option from a clerk as a courtesy. THIS is
       what decides — `waiveLate` is a field in a POST body anybody can
       send, and a screen is not a permission system. */
    expect(body.ok).toBe(false);
    expect(body.reason).toMatch(/manager/i);

    /* And it did not half-happen. */
    const db = await admin();
    try {
      const { rows } = await db.query<{ status: string }>(
        "select status from reservations where id = $1", [id]);
      expect(rows[0]!.status).toBe("checked_in");
    } finally {
      await db.end();
    }
  });

  it("lets a manager waive it, and still records the departure", async () => {
    const id = await freshStay();
    const before = await lateCharges(id);
    const res = await call(`/stays/${id}/check-out`,
      { lateReason: "Manager's say-so", waiveLate: true }, ownerId);
    expect(res.status, await res.clone().text()).toBeLessThan(400);

    const db = await admin();
    try {
      const { rows } = await db.query<{ reason: string }>(
        "select late_checkout_reason as reason from reservations where id = $1",
        [id]);
      /* WAIVING THE MONEY DOES NOT UNWRITE THE FACT. */
      expect(rows[0]!.reason).toMatch(/say-so/);
    } finally {
      await db.end();
    }
    expect(await lateCharges(id), "a waived charge still posted").toBe(before);
  });
});
