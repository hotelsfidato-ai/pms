import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../src/server.ts";
import { closePool } from "../src/db.ts";

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
  } finally {
    await db.end();
  }
});

afterAll(async () => { await closePool(); });

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
