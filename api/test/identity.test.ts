import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../src/server.ts";
import { closePool } from "../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   IDENTITY CAPTURE AT CHECK-IN

   Run at PUNE, and each test creates the arrival it checks in.

   The demo property has exactly ONE confirmed arrival due today, so a
   file that consumed them ran out on its third test — and creating
   more at 5EL would break the calibrated counts that
   db/verify-backup.sh asserts (83 reservations, and the revenue that
   reconciles to the real eZee export). Pune has ten rooms and nothing
   that reconciles to anything.

   `guest_documents` has existed since migration 013 and nothing ever
   wrote to it. Check-in sent `idCaptured: true` — a boolean the CLIENT
   asserted — and the server filed the assertion into a note. A hotel
   could have ticked that box ten thousand times and had no passport
   number anywhere in the database.

   WHAT IS ASSERTED

     · capture is DERIVED from a document arriving, not asserted
     · a document type with no number is refused, in a sentence
     · what was captured actually reaches guest_documents
     · nationality reaches the GUEST, and the Form C register sees it
     · a returning guest's document can be CORRECTED — 013 had no
       UPDATE policy, so a renewed visa could not be recorded at all
     · a later capture does not blank fields an earlier one recorded
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const admin = async () =>
  new (await import("pg")).default.Pool({ connectionString: SUPER });

let ownerId: string;
let puneId: string;

const tag = `ID-${process.pid}`;

const call = (path: string, method = "GET", body?: unknown) =>
  app.request(`/api/hotels${path}`, {
    method,
    headers: { "x-dev-staff-id": ownerId, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

beforeAll(async () => {
  const db = await admin();
  try {
    ownerId = (await db.query<{ id: string }>(
      "select id from staff where email = 'owner@fidato.in'",
    )).rows[0]!.id;
    puneId = (await db.query<{ id: string }>(
      "select id from hotels where code = 'PUN'",
    )).rows[0]!.id;
  } finally {
    await db.end();
  }
});

/* Every fixture here is tagged `ID-<pid>`, and until this existed NONE of
   them were cleaned up: each run left reservations — several of them
   CHECKED IN — holding real rooms in the demo database. The damage is not
   the rows, it is that they hold inventory: a later amendment or move is
   then refused because a room is "taken", by a guest who does not exist.

   Same shape as defect 54. A test that writes to the demo owns putting it
   back. */
afterAll(async () => {
  const db = await admin();
  try {
    const mine = `${tag}-%`;
    const guests = `${tag} guest %`;

    await db.query("alter table folio_postings disable trigger folio_postings_append_only");
    await db.query(
      `delete from folio_postings where folio_id in (
         select f.id from folios f join reservations r on r.id = f.reservation_id
          where r.reference like $1)`, [mine]);
    await db.query("alter table folio_postings enable trigger folio_postings_append_only");

    await db.query(
      `delete from folios where reservation_id in (
         select id from reservations where reference like $1)`, [mine]);
    await db.query(
      `delete from room_assignments where reservation_id in (
         select id from reservations where reference like $1)`, [mine]);
    await db.query("delete from guest_documents where guest_id in (select id from guests where full_name like $1)", [guests])
      .catch(() => undefined);
    await db.query("delete from reservations where reference like $1", [mine]);

    await db.query("alter table guests disable trigger guests_no_delete");
    await db.query("delete from guests where full_name like $1", [guests]);
    await db.query("alter table guests enable trigger guests_no_delete");
  } finally {
    await db.end();
  }
  await closePool();
});

/**
 * Create a confirmed arrival at Pune for today, with a clean free room
 * of the type booked, and return both.
 *
 * Written as SQL rather than through the booking flow: this file tests
 * identity capture, and a failure here should mean capture is wrong,
 * not that making a reservation is.
 */
async function arrivalAndRoom(): Promise<{ stay: string; room: string; guest: string }> {
  const db = await admin();
  try {
    const bd = (await db.query<{ d: string }>(
      "select app.business_date($1)::text as d", [puneId],
    )).rows[0]!.d;

    /* A clean room nobody holds, and the type it belongs to — chosen
       together, so the reservation cannot be booked for a type with no
       room free. The first version picked any clean room and every
       check-in came back "That room is a different type from the one
       booked", which was the API being right about a wrong test. */
    const room = await db.query<{ id: string; number: string; type_id: string }>(
      `select rm.id::text, rm.number, rm.room_type_id::text as type_id
         from rooms rm
        where rm.hotel_id = $1 and rm.is_active
          and rm.housekeeping_status = 'clean'
          and not exists (select 1 from room_assignments ra
                           where ra.room_id = rm.id and ra.released_at is null)
            and rm.housekeeping_status = 'clean'
        order by rm.number
        limit 1`,
      [puneId],
    );
    if (!room.rows[0]) {
      throw new Error(
        "No clean, free room at Pune. This test cannot prove anything — " +
          "the night-audit tests may have filled it; rebuild the database.",
      );
    }
    const r = room.rows[0];

    const guest = await db.query<{ id: string }>(
      `insert into guests (full_name, phone) values ($1, '+91 00000 00000')
       returning id::text`,
      [`${tag} guest ${r.number} ${Date.now()}`],
    );

    const out = new Date(`${bd}T00:00:00Z`);
    out.setUTCDate(out.getUTCDate() + 2);

    const stay = await db.query<{ id: string }>(
      `insert into reservations
         (hotel_id, guest_id, room_type_id, reference, check_in, check_out,
          adults, status, source, agreed_rate)
       values ($1,$2,$3::uuid,$4,$5::date,$6::date,1,'confirmed','direct',2500)
       returning id::text`,
      [puneId, guest.rows[0]!.id, r.type_id,
       `${tag}-${Date.now()}`, bd, out.toISOString().slice(0, 10)],
    );

    return { stay: stay.rows[0]!.id, guest: guest.rows[0]!.id, room: r.number };
  } finally {
    await db.end();
  }
}

/* ── Capture is derived, not asserted ─────────────────────────────── */

/* WHY EVERY CHECK-IN HERE CARRIES AN ARRIVAL REASON

   These tests are about identity documents. The arrival hour is
   incidental to them — but 063 gave the front desk an opinion about it,
   and the fixture property opens at 14:00. Run the suite at 13:31 and
   every check-in below is an EARLY one, refused for want of a reason,
   and four tests about passports fail complaining about arrival times.

   Worse, one of them kept passing: it asserts the refusal mentions a
   "reason", and "an early arrival needs a reason" says exactly that. It
   was green for the wrong cause, which is the failure mode that hides.

   A test whose result depends on the wall clock is a test that will
   disagree with itself. The reason is stated here so the arrival hour
   stops being a variable — the property still refuses an unexplained
   early arrival, and `test/frontDesk.test.ts` is where that is proved. */
const EARLY = "Identity fixture — arrival hour is not what these test";

describe("check-in will not accept a claim in place of a document", () => {
  it("refuses a document type with no number", async () => {
    const { stay, room } = await arrivalAndRoom();
    const res = await call(`/PUN/stays/${stay}/check-in`, "POST", {
      roomNumber: room,
      earlyReason: EARLY,
      identity: { idType: "passport" },
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { reason: string };
    /* A sentence, not a constraint name. The database would also refuse
       this — gd_number_present, migration 026 — but a clerk cannot act
       on `23514`. */
    expect(body.reason).toMatch(/number/i);
  });

  it("refuses nothing at all, unless a reason is given", async () => {
    const { stay, room } = await arrivalAndRoom();
    const res = await call(`/PUN/stays/${stay}/check-in`, "POST", {
      roomNumber: room,
      earlyReason: EARLY,
    });
    expect(res.status).toBe(409);
    expect((await res.json() as { reason: string }).reason).toMatch(/reason/i);
  });

  it("accepts a skip WITH a reason, and records no document", async () => {
    /* A guest can always be checked in. A hotel does not refuse a room
       because a scanner is broken — it records why. */
    const { stay, room, guest } = await arrivalAndRoom();
    const res = await call(`/PUN/stays/${stay}/check-in`, "POST", {
      roomNumber: room,
      earlyReason: EARLY,
      idSkipReason: `${tag} scanner offline`,
    });
    expect(res.status).toBeLessThan(400);

    const db = await admin();
    try {
      const { rows } = await db.query<{ n: string; notes: string | null }>(
        `select (select count(*)::text from guest_documents where guest_id = $1) as n,
                (select notes from reservations where id = $2) as notes`,
        [guest, stay],
      );
      expect(Number(rows[0]!.n)).toBe(0);
      /* And the reason is on the record, not thrown away. */
      expect(rows[0]!.notes ?? "").toContain(tag);
    } finally {
      await db.end();
    }
  });
});

/* ── What was captured actually lands ─────────────────────────────── */

describe("a captured document reaches the database", () => {
  it("stores every field, with who saw it and when", async () => {
    const { stay, room, guest } = await arrivalAndRoom();

    const res = await call(`/PUN/stays/${stay}/check-in`, "POST", {
      roomNumber: room,
      earlyReason: EARLY,
      identity: {
        idType: "passport",
        idNumber: `P${process.pid}`,
        nationality: "GB",
        passportExpiry: "2031-04-12",
        visaNumber: `V-${process.pid}`,
        visaExpiry: "2027-01-05",
        addressLine: "14 Cranmer Road, London",
      },
    });
    expect(res.status, await res.text().catch(() => "")).toBeLessThan(400);

    const db = await admin();
    try {
      const { rows } = await db.query<{
        id_type: string; id_number: string; visa_number: string;
        visa_expiry: string; address_line: string;
        captured_by: string | null; captured_at: string | null;
        nationality: string;
      }>(
        `select gd.id_type, gd.id_number, gd.visa_number,
                gd.visa_expiry::text, gd.address_line,
                gd.captured_by::text, gd.captured_at::text, g.nationality
           from guest_documents gd
           join guests g on g.id = gd.guest_id
          where gd.guest_id = $1`,
        [guest],
      );

      const d = rows[0];
      expect(d, "nothing was written to guest_documents").toBeTruthy();
      expect(d!.id_type).toBe("passport");
      expect(d!.id_number).toBe(`P${process.pid}`);
      expect(d!.visa_number).toBe(`V-${process.pid}`);
      expect(d!.address_line).toContain("Cranmer");

      /* An FRRO inspection asks who checked, not only what was
         recorded. `updated_at` cannot answer that. */
      expect(d!.captured_by).toBeTruthy();
      expect(d!.captured_at).toBeTruthy();

      /* Nationality is a fact about the PERSON, so it lands on the
         guest — and it is what the Form C register filters on. */
      expect(d!.nationality).toBe("GB");
    } finally {
      await db.end();
    }
  });

  it("puts that guest on the Form C register with a real passport", async () => {
    /* The register printed "not on record" for every foreign national
       for the whole project, because nothing wrote a passport. */
    const body = (await (await call("/PUN/form-c")).json()) as {
      rows: Array<{ guest: string; nationality: string; passport: string | null }>;
    };

    const mine = body.rows.find((r) => r.passport === `P${process.pid}`);
    expect(
      mine,
      "the guest checked in above is not on the Form C register",
    ).toBeTruthy();
    expect(mine!.nationality).toBe("GB");
  });
});

/* ── A returning guest ────────────────────────────────────────────── */

describe("a document can be corrected", () => {
  it("records a renewed visa on a second stay", async () => {
    /* 013 created a SELECT policy and an INSERT policy and no UPDATE.
       guest_id is the primary key, so the second time a guest presented
       a document the insert conflicted and there was no other way in.
       A returning corporate guest with a renewed visa is not an edge
       case — it is the normal life of the account. */
    const { stay, room, guest } = await arrivalAndRoom();

    await call(`/PUN/stays/${stay}/check-in`, "POST", {
      roomNumber: room,
      earlyReason: EARLY,
      identity: {
        idType: "passport", idNumber: `R${process.pid}`,
        nationality: "US", visaNumber: "OLD-VISA",
        addressLine: "First address recorded",
      },
    });

    const db = await admin();
    try {
      /* Simulate the return visit: same guest, new visa, and NOTHING
         said about the address. */
      await db.query(
        `insert into guest_documents (guest_id, id_type, id_number, visa_number)
         values ($1,'passport',$2,'NEW-VISA')
         on conflict (guest_id) do update set
           visa_number = excluded.visa_number,
           address_line = coalesce(excluded.address_line,
                                   guest_documents.address_line)`,
        [guest, `R${process.pid}`],
      );

      const { rows } = await db.query<{
        visa_number: string; address_line: string | null;
      }>(
        "select visa_number, address_line from guest_documents where guest_id = $1",
        [guest],
      );
      expect(rows[0]!.visa_number).toBe("NEW-VISA");

      /* And the address recorded last year survived. A clerk capturing
         a visa number today must not silently blank a field somebody
         else filled in. */
      expect(
        rows[0]!.address_line,
        "a later capture blanked a field an earlier one recorded",
      ).toBe("First address recorded");
    } finally {
      await db.end();
    }
  });

  it("cannot be deleted by the application", async () => {
    /* Correct it; do not erase it. A compliance register with a hole in
       it is worse than one with a stale row. Checked as a PRIVILEGE,
       not by trusting the grant that was meant to set it. */
    const db = await admin();
    try {
      const { rows } = await db.query<{ del: boolean; upd: boolean }>(
        `select has_table_privilege('pms_app','guest_documents','delete') as del,
                has_table_privilege('pms_app','guest_documents','update') as upd`,
      );
      expect(rows[0]!.del).toBe(false);
      expect(rows[0]!.upd).toBe(true);
    } finally {
      await db.end();
    }
  });
});
