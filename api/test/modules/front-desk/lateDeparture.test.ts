import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE OWNER'S D27-314 (13 October) · A LATE DEPARTURE IS ASKED ONCE, AND
   ONLY ON OR AFTER THE DEPARTURE DATE

   (1) The desk recorded the reason, the late charge posted, the guest paid -
       and the next Check out asked for the reason again and posted the
       charge again: the route never looked at late_checkout_at. Recorded
       once, charged once, decided here whatever the body says.
   (2) A guest leaving BEFORE the departure date is leaving early, whatever
       the hour: never asked, never charged a late fee. The date is the
       hotel's business date (app.business_date), never the clock's - the A5
       script's early leaver departed after the business date.

   The rule itself is app.departure_is_late (db/tests/modules/front-desk.sql).
   No night audit has run here, so the business date is hotels.business_date
   and each test sets it.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const CODE = "FLD";
let hotelId = "";

const call = (path: string, method = "GET", body?: unknown) =>
  app.request(`/api/hotels/${CODE}${path}`, {
    method,
    headers: {
      "x-dev-staff-id": "dev-owner",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const businessDate = (d: string) =>
  sql("update hotels set business_date = $2::date where id = $1", [hotelId, d]);

/** Checked in on the 25th, leaving on `to`. */
async function stay(reference: string, to: string, roomNumber: string) {
  await businessDate("2026-08-25");
  const id = (await sql<{ id: string }>(
    `insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
                               agreed_rate, status)
     values ($1, $2, (select id from guests where full_name = 'Late departure guest' limit 1),
             (select id from room_types where hotel_id = $1 and code = 'STD'),
             date '2026-08-25', $3::date, 2000, 'confirmed')
     returning id::text`, [hotelId, reference, to]))[0]!.id;
  const res = await call(`/stays/${id}/check-in`, "POST",
    { roomNumber, adults: 1, idSkipReason: "Test" });
  expect(res.status, await res.clone().text()).toBe(200);
  return id;
}

const checkOut = async (id: string, body: object = {}) => {
  const res = await call(`/stays/${id}/check-out`, "POST", body);
  return { status: res.status, ...((await res.json()) as { reason?: string; needs?: string }) };
};

const lateLines = (id: string) => sql<{ amount: string; source: string | null }>(
  `select amount::text, source_type as source from folio_postings
    where reservation_id = $1 and description = 'Late check-out' and reverses_id is null`, [id]);

const recorded = async (id: string) => (await sql<{ at: string | null; reason: string | null }>(
  `select late_checkout_at::text as at, late_checkout_reason as reason
     from reservations where id = $1`, [id]))[0]!;

beforeAll(async () => {
  const owner = (await sql<{ id: string }>(
    "select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER, max: 1 });
  try {
    await db.query("select set_config('app.user_id', $1, false)", [owner]);
    hotelId = (await db.query<{ id: string }>(
      "select app.provision_property_unchecked($1,'Late Departure Test','Nowhere')::text as id",
      [CODE])).rows[0]!.id;
    /* Rooms from midnight, out by midnight: no hour is early, every hour
       is past check-out time - only the date decides. */
    await db.query(
      `update hotels set business_date = date '2026-08-25', check_in_time = '00:00',
                         check_out_time = '00:00', late_checkout_charge = 400
        where id = $1`, [hotelId]);
    await db.query("select app.bulk_create_rooms($1,'STD',1::smallint,101,104)", [hotelId]);
    await db.query(
      `insert into tax_rules (hotel_id, kind, over_amount, rate, note)
       values ($1, 'room', 0, 5, 'Test')`, [hotelId]);
    await db.query("insert into guests (full_name) values ('Late departure guest')");
  } finally { await db.end(); }
});

/* As perBill.test.ts: the app's pool first (an ALTER TABLE waits on every open
   connection), and the invoice a completed check-out made goes before the hotel. */
const TRIGGERS = ["folio_postings folio_postings_append_only", "invoices invoices_immutable",
                  "hotels hotels_no_delete"];
afterAll(async () => {
  await closePool();
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER, max: 1 });
  try {
    for (const t of TRIGGERS) await db.query(`alter table ${t.split(" ")[0]} disable trigger ${t.split(" ")[1]}`);
    await db.query("delete from invoices where hotel_id = $1", [hotelId]);
    await db.query("delete from hotels where id = $1", [hotelId]);
  } finally {
    for (const t of TRIGGERS) await db.query(`alter table ${t.split(" ")[0]} enable trigger ${t.split(" ")[1]}`);
    await db.end();
  }
}, 120_000);

describe("D27-314 (2) · only on or after the departure date", () => {
  it("an early leaver, after check-out time, is not asked and not charged", async () => {
    const id = await stay(`${CODE}-EARLY`, "2026-08-27", "101");
    const res = await checkOut(id);
    expect(res.needs, res.reason).toBeUndefined();
    /* A reason sent anyway (an old screen) records and charges nothing. */
    await checkOut(id, { lateReason: "Sent anyway" });
    expect(await lateLines(id)).toEqual([]);
    expect((await recorded(id)).at).toBeNull();
  });

  it("on the departure date it is still asked", async () => {
    const id = await stay(`${CODE}-ONDAY`, "2026-08-26", "102");
    await businessDate("2026-08-26");
    expect((await checkOut(id)).needs).toBe("late-reason");
  });
});

describe("D27-314 (1) · asked once, charged once", () => {
  it("the second check-out reuses the reason recorded and posts no second charge", async () => {
    const id = await stay(`${CODE}-TWICE`, "2026-08-26", "103");
    await businessDate("2026-08-26");
    expect((await checkOut(id)).needs).toBe("late-reason");
    expect((await checkOut(id, { lateReason: "Slept in" })).reason).toMatch(/still outstanding/);
    expect(await lateLines(id)).toEqual([{ amount: "400.00", source: "late_checkout" }]);

    /* The guest pays everything, the late charge with it. */
    const owed = (await sql<{ owed: string }>(
      "select sum(amount + tax_amount)::text as owed from folio_postings where reservation_id = $1",
      [id]))[0]!.owed;
    const paid = await call(`/stays/${id}/payments`, "POST", { method: "UPI", amount: Number(owed) });
    expect(paid.status, await paid.clone().text()).toBe(200);

    /* What the screen's Check out sends: no reason. Not asked again; out. */
    const again = await checkOut(id);
    expect(again.needs, again.reason).toBeUndefined();
    expect(again.status, again.reason).toBe(200);
    expect(await lateLines(id)).toHaveLength(1);
    expect((await recorded(id)).reason).toBe("Slept in");
  });

  it("after the date, a reason sent again changes nothing: one charge, the first reason", async () => {
    const id = await stay(`${CODE}-AGAIN`, "2026-08-26", "104");
    await businessDate("2026-08-27");
    await checkOut(id, { lateReason: "First time" });
    await checkOut(id, { lateReason: "A dialog left open" });
    expect(await lateLines(id)).toHaveLength(1);
    expect((await recorded(id)).reason).toBe("First time");
  });
});
