import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   ONE RULE FOR IN HOUSE AND EMPTY (the owner's D21-36, D21-37) — and FD-8

   D21-36  In house   checked in and not yet checked out, whatever the
                      departure date says; a late checkout still counts.
   D21-37  Empty      nobody in it AND sellable tonight; a blocked room is
                      its own count.

   Written once, app.in_house and app.house_now (the one in-house rule
   migration), served by GET /:code/house-now. Every screen reads that;
   src/modules/front-desk/inHouseRule.test.tsx holds each one to it.

   FD-8: at 5 Elements room 208 showed Free on Rooms and the walk-in
   refused it, "Somebody is already in that room". The walk-in read
   rooms.occupancy_status, which 070 set 'occupied' for any room HELD -
   208 was given in advance to a booking arriving on the 27th. Proved
   here through the routes a clerk uses, at a property of the test's own
   (FDW, on 25 August 2026) so no demo figure moves; the demo's own 208
   is read, never written.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const admin = async () =>
  new (await import("pg")).default.Pool({ connectionString: SUPER });

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = await admin();
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const CODE = "FDW";
let hotelId = "";
let held = "";        // confirmed, arriving 27 Aug, given room 101 in advance
let heldSoon = "";    // confirmed, arriving 26 Aug, given room 102 in advance

const call = (path: string, method = "GET", body?: unknown) =>
  app.request(`/api/hotels${path}`, {
    method,
    headers: {
      "x-dev-staff-id": "dev-owner",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

interface HouseNow {
  rooms: Array<{ number: string; inHouse: boolean; outOfOrder: boolean; empty: boolean }>;
  inHouse: number; empty: number;
}
const houseNow = async (code: string) => {
  const res = await call(`/${code}/house-now`);
  expect(res.status).toBe(200);
  return await res.json() as HouseNow;
};
const room = (h: HouseNow, n: string) => h.rooms.find((r) => r.number === n)!;
const column = async (number: string) =>
  (await sql<{ occ: string }>(
    "select occupancy_status as occ from rooms where hotel_id = $1 and number = $2",
    [hotelId, number]))[0]!.occ;

const walkIn = (roomNumber: string, nights: number) =>
  call(`/${CODE}/walk-ins`, "POST", {
    guestName: `Walk-in ${roomNumber} ${process.pid}`, roomNumber, nights,
    adults: 1, offeredTariff: 2000,
  });

async function heldBooking(reference: string, from: string, to: string, roomNumber: string) {
  const [row] = await sql<{ id: string }>(
    `insert into reservations (hotel_id, reference, guest_id, room_type_id,
                               check_in, check_out, agreed_rate, status)
     values ($1, $2,
             (select id from guests where full_name = 'In-house rule guest' limit 1),
             (select id from room_types where hotel_id = $1 and code = 'STD'),
             $3::date, $4::date, 2000, 'confirmed')
     returning id::text`, [hotelId, reference, from, to]);
  /* Given its room the way the desk gives one: the front desk's own route. */
  const res = await call(`/${CODE}/stays/${row!.id}/assign`, "POST", { roomNumber });
  expect(res.status, await res.clone().text()).toBe(200);
  return row!.id;
}

beforeAll(async () => {
  const db = await admin();
  try {
    const owner = (await db.query<{ id: string }>(
      "select id::text from staff where email = 'owner@fidato.in'")).rows[0]!.id;
    await db.query("select set_config('app.user_id', $1, false)", [owner]);
    hotelId = (await db.query<{ id: string }>(
      "select app.provision_property_unchecked($1,'In House Rule Test','Nowhere')::text as id",
      [CODE])).rows[0]!.id;
    await db.query("update hotels set business_date = date '2026-08-25' where id = $1", [hotelId]);
    await db.query("select app.bulk_create_rooms($1,'STD',1::smallint,101,104)", [hotelId]);
    /* A room charge needs a GST rule (067), as at any real property. */
    await db.query(
      `insert into tax_rules (hotel_id, kind, over_amount, rate, note)
       values ($1, 'room', 0, 5, 'Test')`, [hotelId]);
    await db.query("insert into guests (full_name) values ('In-house rule guest')");
    /* 104 is blocked tonight: out of order, never Empty. */
    await db.query(
      `insert into room_blocks (hotel_id, room_id, from_date, to_date, reason)
       select $1, id, date '2026-08-20', null, 'out_of_order'
         from rooms where hotel_id = $1 and number = '104'`, [hotelId]);
  } finally { await db.end(); }

  held = await heldBooking(`${CODE}-HELD`, "2026-08-27", "2026-08-30", "101");
  heldSoon = await heldBooking(`${CODE}-SOON`, "2026-08-26", "2026-08-28", "102");
});

afterAll(async () => {
  const db = await admin();
  try {
    await db.query("alter table folio_postings disable trigger folio_postings_append_only");
    await db.query("alter table hotels disable trigger hotels_no_delete");
    await db.query("delete from hotels where id = $1", [hotelId]);
    await db.query("alter table hotels enable trigger hotels_no_delete");
    await db.query("alter table folio_postings enable trigger folio_postings_append_only");
  } finally { await db.end(); }
  await closePool();
});

describe("FD-8 · a room held for a later booking", () => {
  it("is Empty tonight, and nothing says somebody is in it", async () => {
    const h = await houseNow(CODE);
    expect(room(h, "101")).toMatchObject({ inHouse: false, empty: true });
    expect(room(h, "102")).toMatchObject({ inHouse: false, empty: true });
    /* The column the walk-in used to read said 'occupied' here. */
    expect(await column("101")).toBe("vacant");
    expect(await column("102")).toBe("vacant");
    expect(held && heldSoon).toBeTruthy();
  });

  it("takes a one-night walk-in before that booking arrives", async () => {
    const res = await walkIn("101", 1);
    const body = await res.json() as { ok: boolean; reason?: string };
    expect(body.reason ?? "").not.toMatch(/already in that room/i);
    expect(res.status, body.reason).toBe(200);

    const h = await houseNow(CODE);
    expect(room(h, "101")).toMatchObject({ inHouse: true, empty: false });
    expect(await column("101")).toBe("occupied");
  });

  it("refuses a walk-in into nights the booking holds, and names the booking", async () => {
    const res = await walkIn("102", 2);
    expect(res.status).toBe(409);
    const { reason } = await res.json() as { reason: string };
    expect(reason).toMatch(new RegExp(`held by ${CODE}-SOON`));
    expect(reason).not.toMatch(/already in that room/i);
  });
});

describe("D21-36 · a guest past their departure date who has not checked out", () => {
  it("is still in house, and the walk-in still refuses their room", async () => {
    /* Two days on. The walk-in in 101 was due out on the 26th and has not
       been checked out; the booking held for 101 arrives today. */
    await sql("update hotels set business_date = date '2026-08-27' where id = $1", [hotelId]);

    const h = await houseNow(CODE);
    expect(room(h, "101")).toMatchObject({ inHouse: true, empty: false });

    const res = await walkIn("101", 1);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason)
      .toBe("Somebody is already in that room.");
  });

  /* FD-11 (D23-12). The booking held for 101 arrives today, and the check-in
     asked only whether another booking's NIGHTS overlap - the walk-in's
     ended on the 26th - so it put a second guest in with them. */
  it("and the check-in of the booking held for that room refuses it, naming who is in it", async () => {
    const res = await call(`/${CODE}/stays/${held}/check-in`, "POST", {
      roomNumber: "101", earlyReason: "Test", idSkipReason: "Test",
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toMatch(
      /^Walk-in 101 \d+ \(.+\) is still in room 101\. Check them out first, or choose another room\.$/);
    /* Refused before the first write (MEMORY 243). */
    const [stay] = await sql<{ status: string }>(
      "select status from reservations where id = $1", [held]);
    expect(stay!.status).toBe("confirmed");
  });
});

describe("D21-37 · the three counts", () => {
  it("are rooms, and a blocked room is its own count", async () => {
    const h = await houseNow(CODE);
    expect(room(h, "104")).toMatchObject({ outOfOrder: true, empty: false, inHouse: false });
    expect({ inHouse: h.inHouse, empty: h.empty })
      .toEqual({ inHouse: 1, empty: 2 });
  });

  /* Read only, and written to hold whatever other files have done at 5EL
     before this one (a walk-in elsewhere moves the totals, not these). */
  it("the demo: 208 and 307 are held for later bookings and Empty; 201 holds two bookings and counts once", async () => {
    const h = await houseNow("5EL");
    expect(room(h, "208")).toMatchObject({ inHouse: false, empty: true });
    expect(room(h, "307")).toMatchObject({ inHouse: false, empty: true });
    expect(room(h, "308")).toMatchObject({ outOfOrder: true, empty: false });

    /* 201: the guest due out today, not yet checked out, and the guest who
       arrived into it. Both in house (D21-36); one room. */
    const in201 = await sql<{ reference: string }>(
      `select r.reference from app.in_house((select id from hotels where code = '5EL')) i
         join reservations r on r.id = i.reservation_id
         join rooms rm on rm.id = i.room_id
        where rm.number = '201' order by 1`);
    expect(in201.map((r) => r.reference)).toEqual(["FH-2608-4857", "FH-2608-4858"]);
    expect(room(h, "201").inHouse).toBe(true);
    const outOfOrder = h.rooms.filter((r) => r.outOfOrder).length;
    expect(h.inHouse + h.empty + outOfOrder, "each room once, none in two")
      .toBe(h.rooms.length);
  });

  it("rooms.occupancy_status agrees with In house for every room here", async () => {
    const off = await sql<{ number: string }>(
      `select x.number from app.house_now($1) x join rooms rm on rm.id = x.room_id
        where (rm.occupancy_status = 'occupied') <> x.in_house order by 1`, [hotelId]);
    expect(off).toEqual([]);
  });
});
