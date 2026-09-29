import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { closePool } from "../../../src/db.ts";
import { runOnce } from "../../../src/modules/crs/index.ts";
import { useFetchForTests } from "../../../src/modules/crs/firestore.ts";
import { useSenderForTests, type CrsAnswer } from "../../../src/modules/crs/tell.ts";
import { bookingFrom } from "../../../src/modules/crs/reader.ts";

/* ══════════════════════════════════════════════════════════════════
   THE CRS BRIDGE - bookings read from the CRS (D27-168)

   What must hold, each proved against the database afterwards:
   1. A CRS booking becomes ONE waiting booking with the room held, and
      the same CRS id read again makes nothing more.
   2. A full hotel makes nothing, and the salesperson's answer "full" goes
      to the CRS register on the same run.
   3. A change in the CRS after the booking arrived is a note for the desk;
      the booking is not touched.
   4. The desk's Confirm is told to the CRS register once, with the PMS's
      reference as the hotel's confirmation number.
   5. A booking made in the CRS before the hotel was connected, or for
      another hotel, is not taken.
   6. A booking deleted in the CRS is a note, found by the daily check.
   7. Nothing is read without the four settings.

   The CRS is a faked fetch answering in Firestore's REST shapes, with
   made-up bookings shaped like the CRS's own (its src/data/types.ts).
   ══════════════════════════════════════════════════════════════════ */

const SUPER = process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, params)).rows as Record<string, unknown>[]; }
  finally { await db.end(); }
};

const CRS_HOTEL = "crsHotel5EL";
const SETTINGS = {
  CRS_PROJECT_ID: "test-project",
  CRS_API_KEY: "test-web-key",
  CRS_AUTOMATION_EMAIL: "automation@example.com",
  CRS_AUTOMATION_PASSWORD: "not-a-real-password",
};

let hotelId: string;
let serviceId: string;
let first: string;
let clock = Date.parse("2026-09-29T06:00:00Z");

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/* ── A fake CRS: Firestore's REST answers over an in-memory store ── */

const store = new Map<string, Record<string, unknown>>();
const reads: string[] = [];

const enc = (v: unknown): Record<string, unknown> => {
  if (v === null) return { nullValue: null };
  if (typeof v === "string") {
    return /^\d{4}-\d\d-\d\dT/.test(v) ? { timestampValue: v } : { stringValue: v };
  }
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, enc(x)])) } };
};
const NAME = `projects/test-project/databases/(default)/documents/reservations/`;
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

const fakeCrs: typeof fetch = async (input, init) => {
  const url = String(input);
  const body = JSON.parse(String(init?.body ?? "{}"));
  if (url.includes("accounts:signInWithPassword")) {
    expect(body.password).toBe(SETTINGS.CRS_AUTOMATION_PASSWORD);
    return json({ idToken: "fake-id-token", expiresIn: "3600" });
  }
  expect((init?.headers as Record<string, string>)["authorization"]).toBe("Bearer fake-id-token");
  if (url.endsWith(":runQuery")) {
    const q = body.structuredQuery;
    reads.push(q.where.fieldFilter.value.timestampValue);
    const since = Date.parse(q.where.fieldFilter.value.timestampValue);
    const rows = [...store.entries()]
      .filter(([, d]) => Date.parse(String(d["updatedAt"])) >= since)
      .sort(([a, x], [b, y]) => String(x["updatedAt"]).localeCompare(String(y["updatedAt"])) || a.localeCompare(b));
    return json(rows.map(([id, d]) => ({
      document: { name: NAME + id, fields: (enc(d) as { mapValue: { fields: unknown } }).mapValue.fields },
    })));
  }
  if (url.endsWith(":batchGet")) {
    return json((body.documents as string[]).map((n) => {
      const id = n.slice(n.lastIndexOf("/") + 1);
      return store.has(id) ? { found: { name: n, fields: {} } } : { missing: n };
    }));
  }
  throw new Error(`The fake CRS was asked ${url}`);
};

/** A made-up CRS booking, in the CRS's own shape. */
const crsBooking = (over: Record<string, unknown> = {}, room: Record<string, unknown> = {}) => {
  clock += 1000;
  const at = new Date(clock).toISOString();
  return {
    reference: "FH-2026-00042",
    status: "confirmed",
    channel: "direct_sales",
    customerId: "cust1", customerName: "Asha Rao",
    companyId: "comp1", companyName: "Acme Travels",
    hotelId: CRS_HOTEL, hotelName: "5 Elements", hotelCity: "Akkalkot",
    checkIn: addDays(first, 40), checkOut: addDays(first, 42), nights: 2,
    rooms: [{
      roomTypeId: "crsDLX", roomTypeName: "Deluxe", mealPlan: "CP",
      quantity: 1, adults: 2, children: 0, extraBeds: 0,
      sellingRate: 4200, extraBedRate: 0, childRate: 0, ...room,
    }],
    guests: [{ name: "Asha Rao", email: "asha@example.com", phone: "+919800000042", isPrimary: true }],
    ownerId: "sales1", ownerName: "Priya Sales",
    specialRequests: "",
    createdAt: at, updatedAt: at,
    ...over,
  };
};

const told: CrsAnswer[] = [];
const run = () => runOnce(async () => [{ hotelId, runAs: serviceId }]);
const row = async (crsId: string) =>
  (await sql("select * from crs_bookings where crs_id = $1", [crsId]))[0];
const stays = async (crsId: string) =>
  sql("select id::text, reference, status, sales_person, agreed_rate::text from reservations where ota_reference = $1", [crsId]);

beforeAll(async () => {
  Object.assign(process.env, SETTINGS);
  useFetchForTests(fakeCrs);
  useSenderForTests(async (a) => { told.push(a); return { ok: true }; });

  hotelId = String((await sql("select id::text from hotels where code = '5EL'"))[0]!["id"]);
  first = String((await sql(
    "select greatest(business_date, (now() at time zone timezone)::date)::text as d from hotels where id = $1",
    [hotelId]))[0]!["d"]);
  serviceId = String((await sql(
    `insert into staff (email, full_name) values ('crs-reader@example.com', 'CRS reader')
     on conflict (email) do update set is_active = true returning id::text`))[0]!["id"]);
  await sql(`insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, 'read_only')
             on conflict (staff_id, hotel_id) do update set role = 'read_only'`, [serviceId, hotelId]);
  const source = String((await sql("select id::text from booking_sources order by name limit 1"))[0]!["id"]);
  await sql(
    `insert into crs_hotels (hotel_id, crs_hotel_id, booking_source_id, run_as, is_on, connected_at)
     values ($1, $2, $3, $4, true, '2026-09-29T00:00:00Z')`,
    [hotelId, CRS_HOTEL, source, serviceId]);
  await sql(
    `insert into crs_room_types (hotel_id, crs_room_type_id, room_type_id)
     select $1, 'crs' || code, id from room_types where hotel_id = $1`, [hotelId]);
});

afterEach(() => { store.clear(); told.length = 0; });

afterAll(async () => {
  useFetchForTests(null);
  useSenderForTests(null);
  for (const k of Object.keys(SETTINGS)) delete process.env[k];
  await closePool();
});

describe("CRS bookings into the PMS", () => {
  it("makes one waiting booking with the room held, however often it is read", async () => {
    store.set("crsDocA1", crsBooking());
    await run();
    await run();

    const made = await stays("crsDocA1");
    expect(made).toHaveLength(1);
    expect(made[0]!["status"]).toBe("tentative");
    expect(made[0]!["sales_person"]).toBe("Priya Sales");
    expect(made[0]!["agreed_rate"]).toBe("4200.00");
    const b = await row("crsDocA1");
    expect(b!["outcome"]).toBe("booked");
    expect(b!["crs_reference"]).toBe("FH-2026-00042");
    expect(b!["company"]).toBe("Acme Travels");
    /* Waiting: nothing to tell the CRS yet. */
    expect(told).toHaveLength(0);
  });

  it("makes nothing when the hotel is full, and tells the CRS so on the same run", async () => {
    /* One room more than the hotel has of the type: full on any night. */
    const n = Number((await sql(
      "select count(*)::int as n from rooms r join room_types t on t.id = r.room_type_id where t.hotel_id = $1 and t.code = 'DLX'",
      [hotelId]))[0]!["n"]);
    store.set("crsDocFull", crsBooking({ reference: "FH-2026-00043" }, { quantity: n + 1 }));
    await run();

    expect(await stays("crsDocFull")).toHaveLength(0);
    expect((await row("crsDocFull"))!["outcome"]).toBe("full");
    expect(told).toEqual([expect.objectContaining({
      crsId: "crsDocFull", crsReference: "FH-2026-00043", answer: "full", hotelConfirmationNumber: null,
    })]);
    expect((await row("crsDocFull"))!["answered_at"]).not.toBeNull();
  });

  it("shows a change made in the CRS as a note, and changes nothing", async () => {
    const original = crsBooking();
    store.set("crsDocChg", original);
    await run();
    const before = await stays("crsDocChg");

    store.set("crsDocChg", { ...crsBooking(), checkIn: addDays(first, 41), checkOut: addDays(first, 43) });
    await run();

    const after = await stays("crsDocChg");
    expect(after).toEqual(before);
    const b = await row("crsDocChg");
    expect(String(b!["change_note"])).toMatch(/The CRS dates are now/);
    expect(b!["change_done_at"]).toBeNull();
  });

  it("tells the CRS the desk's Confirm once, with the PMS reference", async () => {
    store.set("crsDocConf", crsBooking({ reference: "FH-2026-00044" }));
    await run();
    const [stay] = await stays("crsDocConf");
    await sql("update reservations set status = 'confirmed' where id = $1", [stay!["id"]]);

    await run();
    await run();
    expect(told).toEqual([expect.objectContaining({
      crsId: "crsDocConf", answer: "confirmed", hotelConfirmationNumber: stay!["reference"],
    })]);
  });

  it("does not take a booking made before the hotel was connected, or another hotel's", async () => {
    store.set("crsDocOld", crsBooking({ createdAt: "2026-09-20T10:00:00Z" }));
    store.set("crsDocElse", crsBooking({ hotelId: "someOtherHotel" }));
    await run();
    expect(await stays("crsDocOld")).toHaveLength(0);
    expect(await stays("crsDocElse")).toHaveLength(0);
    expect(await row("crsDocOld")).toBeUndefined();
  });

  it("notes a booking deleted in the CRS, once a day", async () => {
    store.set("crsDocDel", crsBooking());
    await run();
    store.delete("crsDocDel");
    await sql("update crs_hotels set deleted_checked_on = null where hotel_id = $1", [hotelId]);
    await run();
    expect(String((await row("crsDocDel"))!["change_note"])).toMatch(/Deleted in the CRS/);
  });

  it("reads nothing without the four settings", async () => {
    delete process.env["CRS_AUTOMATION_PASSWORD"];
    reads.length = 0;
    store.set("crsDocNoKey", crsBooking());
    await run();
    process.env["CRS_AUTOMATION_PASSWORD"] = SETTINGS.CRS_AUTOMATION_PASSWORD;
    expect(reads).toHaveLength(0);
    expect(await stays("crsDocNoKey")).toHaveLength(0);
  });
});

describe("the CRS's quote, per room per night (D27-171)", () => {
  const types = new Map([["crsDLX", "rt-dlx"]]);
  const lineOf = (room: Record<string, unknown>) => {
    const made = bookingFrom(crsBooking({}, room), types);
    return "lines" in made ? made.lines[0] : made.problem;
  };

  it("splits a line's extra beds and children across its rooms, exactly", () => {
    expect(lineOf({ quantity: 2, extraBeds: 2, extraBedRate: 500, children: 2, childRate: 300 }))
      .toEqual(expect.objectContaining({ rooms: 2, children: 1, agreedRate: 5000 }));
  });

  it.each([
    [{ quantity: 3, extraBeds: 1, extraBedRate: 1000 }, /does not split to the paisa across 3 rooms/],
    [{ children: 1, quantity: 2 }, /1 children across 2 rooms/],
    [{ sellingRate: 0 }, /no rate/],
    [{ roomTypeId: "crsNOPE", roomTypeName: "Suite" }, /"Suite" is not matched/],
  ])("%o is left to the desk", (room, why) => {
    expect(lineOf(room)).toMatch(why);
  });
});
