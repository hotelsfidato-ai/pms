import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../src/server.ts";
import { withUser, closePool } from "../src/db.ts";
import { monthStart, monthEnd, businessDateFor } from "../src/businessDate.ts";
import { withDrawer } from "./drawer.ts";

/* ══════════════════════════════════════════════════════════════════
   THE BUSINESS DATE — CP11

   Two claims, and the second is the one that matters:

     1. Each property reports its OWN operating day.
     2. A write with no date supplied takes that day, NOT the server's
        wall clock.

   Before CP11, four write paths defaulted to
   `new Date().toISOString().slice(0, 10)`. A clerk settling a bill at
   00:40 — before the night audit for the 25th has run, so the hotel is
   still operating in the 25th — would have had the receipt filed under
   the 26th. The night audit closes the 25th without it and the day's
   cash never balances. Nobody can find the money, because it is under
   a day the hotel had not reached yet.

   These tests run against the demo property, which is pinned to
   2026-08-25 while the real calendar is elsewhere. That gap is what
   makes the second claim checkable at all: if any of this still read
   the clock, the dates below would be today's.
   ══════════════════════════════════════════════════════════════════ */

let ownerStaffId: string;
let demoHotelId: string;

/*
   hotels.business_date for 5EL, as the demo loader sets it.

   This is a literal on purpose — the figures these tests assert are
   calibrated to the real eZee export for 1–25 August 2026, and a test
   that read the date from the database would agree with whatever it
   found and prove nothing.

   It does mean the suite must start from a freshly loaded fixture.
   Since the night audit landed, 5EL can be MOVED — closing a day
   advances it — and running the audit against the demo property by
   hand once left seven tests failing here with `expected '2026-08-27'
   to be '2026-08-25'`. Nothing was broken; the fixture had simply been
   operated. `npm test` now loads the demo first for that reason;
   `npm run test:only` skips the load when you know the state is clean.
*/
const PINNED = "2026-08-25";

beforeAll(async () => {
  const admin = new (await import("pg")).default.Pool({
    connectionString:
      process.env["SUPER_DATABASE_URL"] ??
      "postgres://postgres:pw@127.0.0.1:55432/fidato",
  });
  const staff = await admin.query<{ id: string }>(
    "select id from staff where email = 'owner@fidato.in'",
  );
  ownerStaffId = staff.rows[0]!.id;

  const hotel = await admin.query<{ id: string }>(
    "select id from hotels where code = '5EL'",
  );
  demoHotelId = hotel.rows[0]!.id;
  await admin.end();
});

afterAll(async () => { await closePool(); });

const asOwner = (path: string) =>
  app.request(path, { headers: { "x-dev-staff-id": ownerStaffId } });

describe("the business date is the property's, not the server's", () => {
  it("is NOT today - which is the whole point", () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(
      today,
      "The demo property is pinned to 2026-08-25. If the real calendar " +
        "has reached it, every test in this file stops proving anything " +
        "and the pin needs moving.",
    ).not.toBe(PINNED);
  });

  it("comes back on each hotel, because two hotels differ", async () => {
    const res = await asOwner("/api/hotels");
    const body = (await res.json()) as {
      hotels: Array<{ code: string; businessDate: string }>;
    };

    const demo = body.hotels.find((h) => h.code === "5EL");
    expect(demo?.businessDate).toBe(PINNED);

    /* Per hotel, not once for the group. A single group-wide date is
       the thing CP11 removed. */
    for (const h of body.hotels) {
      expect(h.businessDate, `${h.code} has no business date`).toMatch(
        /^\d{4}-\d{2}-\d{2}$/,
      );
    }
  });

  it("advances only when a night audit COMPLETES", async () => {
    const before = await withUser(ownerStaffId, (c) =>
      businessDateFor(c, demoHotelId),
    );
    expect(before).toBe(PINNED);

    const admin = new (await import("pg")).default.Pool({
      connectionString:
        process.env["SUPER_DATABASE_URL"] ??
        "postgres://postgres:pw@127.0.0.1:55432/fidato",
    });
    try {
      /* A run that started but did not finish. The hotel has not
         reached tomorrow because somebody began an audit. */
      await admin.query(
        `insert into night_audit_runs (hotel_id, business_date, status)
         values ($1, $2, 'running')`,
        [demoHotelId, PINNED],
      );
      expect(
        await withUser(ownerStaffId, (c) => businessDateFor(c, demoHotelId)),
      ).toBe(PINNED);

      await admin.query(
        `update night_audit_runs set status = 'completed', completed_at = now()
          where hotel_id = $1 and business_date = $2`,
        [demoHotelId, PINNED],
      );
      expect(
        await withUser(ownerStaffId, (c) => businessDateFor(c, demoHotelId)),
      ).toBe("2026-08-26");
    } finally {
      await admin.query("delete from night_audit_runs where hotel_id = $1", [
        demoHotelId,
      ]);
      await admin.end();
    }
  });
});

describe("reads default to the property's day, not the clock", () => {
  it("the night-audit checklist reports the pinned date", async () => {
    const res = await asOwner("/api/hotels/5EL/night-audit");
    const body = (await res.json()) as { businessDate: string };
    expect(body.businessDate).toBe(PINNED);
  });

  it("period-to-date starts at the property's month, not August 2026 forever", () => {
    /* These were literals — "2026-08-01" in five handlers. Every PTD
       figure in the system would have kept reporting August after the
       property moved into September. */
    expect(monthStart("2026-09-14")).toBe("2026-09-01");
    expect(monthEnd("2026-09-14")).toBe("2026-09-30");
    expect(monthEnd("2028-02-03")).toBe("2028-02-29");   // leap year
    expect(monthEnd("2026-12-31")).toBe("2026-12-31");
  });
});

describe("WRITES take the property's day - the 00:40 receipt", () => {
  it("a payment with no date supplied lands on the business date", async () => {
    const admin = new (await import("pg")).default.Pool({
      connectionString:
        process.env["SUPER_DATABASE_URL"] ??
        "postgres://postgres:pw@127.0.0.1:55432/fidato",
    });

    let stayId: string;
    try {
      const folio = await admin.query<{ stay: string }>(
        `select r.id as stay from folios f
           join reservations r on r.id = f.reservation_id
          where f.hotel_id = $1 and r.status = 'checked_in'
          limit 1`,
        [demoHotelId],
      );
      stayId = folio.rows[0]!.stay;
    } finally {
      await admin.end();
    }

    const res = await withDrawer("5EL", ownerStaffId, () => app.request(`/api/hotels/5EL/stays/${stayId}/payments`, {
      method: "POST",
      headers: {
        "x-dev-staff-id": ownerStaffId,
        "content-type": "application/json",
      },
      /* No businessDate. This is the 00:40 clerk. */
      /* Held as credit if the bill is paid already (D27-4): the date is the question. */
      body: JSON.stringify({ method: "Cash", amount: 100, heldAsCredit: true }),
    }));

    /* Read once. The first version passed `await res.text()` as the
       assertion message, which consumed the body, and the `res.json()`
       on the next line failed with "Body has already been read" — a
       test that could only ever report its own plumbing. */
    const posted = (await res.json()) as
      { ok?: boolean; reason?: string; data?: { id: string } };
    expect(res.status, JSON.stringify(posted)).toBeLessThan(400);
    const postingId = posted.data!.id;

    const admin2 = new (await import("pg")).default.Pool({
      connectionString:
        process.env["SUPER_DATABASE_URL"] ??
        "postgres://postgres:pw@127.0.0.1:55432/fidato",
    });
    try {
      const { rows } = await admin2.query<{ d: string }>(
        `select to_char(business_date, 'YYYY-MM-DD') as d
           from folio_postings where id = $1::bigint`,
        [postingId],
      );
      expect(
        rows[0]?.d,
        "The payment was dated from the server clock. A receipt taken " +
          "before the night audit belongs to the day the hotel is still " +
          "operating in, not to the calendar.",
      ).toBe(PINNED);
    } finally {
      await admin2.end();
    }

    /* ── Undo it the way the system actually undoes things ──────────
       The first version of this teardown ran `delete from
       folio_postings`. Two things were wrong with that, and the
       schema caught the second one:

         · A payment is a NEGATIVE posting. `amount = 100` matched no
           rows, so the delete ran clean and the test reported success
           while leaving a row behind every single run. Three had
           accumulated before a count noticed.
         · There is a trigger. `folio_postings is append-only. Post a
           reversing entry instead of DELETE.` It fires for the
           superuser too, so the grant was never the only guard.

       So the undo is a REVERSAL, which is the only undo this ledger
       has. Two rows now exist where there were none, and the totals
       are unchanged — that is the append-only ledger working, not a
       compromise. */
    const undo = await app.request(
      `/api/hotels/5EL/stays/${stayId}/charges/${postingId}/reverse`,
      { method: "POST",
        headers: { "x-dev-staff-id": ownerStaffId,
                   "content-type": "application/json" },
        body: JSON.stringify({ reason: "business-date test fixture" }) },
    );
    expect(undo.status, await undo.text()).toBeLessThan(400);
  });

  it("leaves the calibrated receipts total exactly where it found it", async () => {
    /* The check the teardown above lacked. A cleanup nobody measures is
       a cleanup nobody knows failed — which is precisely how three stray
       payments got into a dataset whose whole purpose is to reconcile
       to a real eZee export. */
    const admin = new (await import("pg")).default.Pool({
      connectionString:
        process.env["SUPER_DATABASE_URL"] ??
        "postgres://postgres:pw@127.0.0.1:55432/fidato",
    });
    try {
      /* Scoped to the demo property. The first version summed every
         payment posting in the database and picked up a -1000 row from
         db/tests/suite.sql — an Agra fixture dated 2027-01-01, in the
         same cluster and nothing to do with 5EL. The number looked
         wrong by exactly ₹1,000 and the cause was the missing WHERE. */
      const { rows } = await admin.query<{ total: string }>(
        `select coalesce(-sum(p.amount), 0)::text as total
           from folio_postings p
           join folios f on f.id = p.folio_id
          where f.hotel_id = $1 and p.category = 'payment'`,
        [demoHotelId],
      );

      /* ₹3,97,041.93 — the same figure the `payments` table reports,
         to the paisa, because every payment posting for this property
         has its receipt row. That equality is worth asserting on its
         own: they drifted apart once already, and the Manager Report
         showed ₹0 against a Monthly grid showing ₹3,97,042. */
      expect(Number(rows[0]!.total)).toBe(397041.93);

      /* The row COUNT is deliberately not asserted. It rises by two on
         every run of this file — the payment and its reversal — because
         the ledger is append-only and an undo is its own row. That is
         the ledger working. The SUM is the invariant; the count is not,
         and a test that pinned it would fail on its second run and look
         like a data defect. */

      /* The receipts side, read the way the Manager Report reads it.
         A naive `sum(amount) from payments` climbs by ₹100 every run of
         this file, and that is CORRECT: reversing a payment posts a
         cancelling entry in the ledger and leaves the receipt row
         alone, because a receipt that was issued was issued.

         Whether that was a defect was worth checking rather than
         assuming — it looked exactly like the ₹0-versus-₹3,97,042 split
         that bit this project once. It is not: manager.ts joins each
         receipt to its posting and drops any that a reversal points at.
         The application was already right; the naive sum was the wrong
         question. */
      const receipts = await admin.query<{ total: string }>(
        `select coalesce(sum(p.amount), 0)::text as total
           from payments p
           join folio_postings fp on fp.id = p.posting_id
          where p.hotel_id = $1
            and not exists (select 1 from folio_postings rev
                             where rev.reverses_id = fp.id)`,
        [demoHotelId],
      );
      expect(Number(receipts.rows[0]!.total)).toBe(397041.93);
    } finally {
      await admin.end();
    }
  });
});

export {};
