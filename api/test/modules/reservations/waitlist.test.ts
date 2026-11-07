import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE WAITLIST (D27-383 item 8, migration 272)

     adding     a name, a real phone, nights from the business date, a room
                type here - each refused by name, nothing written; a viewer
                is refused
     the list   oldest first, with the rooms free NOW on every night: a
                cancellation shows there by itself; a guest's phone is
                withheld from a role that does not read guests
     booking    New booking with the entry marks it booked, in the booking's
                own transaction; a second booking for it is refused
     removing   kept, with who and why; nothing is ever deleted
   Nothing is booked or sent by the system: there is no route that does.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const TAG = "WLST";
let hotelId: string;
let typeId: string;
let source: string;
let today: string;
const staff = new Map<string, string>();
const plus = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Client({ connectionString: SUPER });
  await db.connect();
  try { return await db.query(text, params); } finally { await db.end(); }
};

const person = async (role: string) => {
  const { rows } = await sql(
    `insert into staff (email, full_name, firebase_uid)
     values ($1, $2, $3)
     on conflict (email) do update set is_active = true, full_name = excluded.full_name
     returning id::text`,
    [`wlst-${role}@fidato.in`, `${TAG} ${role}`, `test-uid-wlst-${role}`]);
  const id = rows[0].id as string;
  await sql("delete from staff_hotels where staff_id = $1", [id]);
  await sql("insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)", [id, hotelId, role]);
  return id;
};

const call = (role: string, method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method,
    headers: { "x-dev-staff-id": staff.get(role)!, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const reasonOf = async (res: Response) => ((await res.json()) as { reason: string }).reason;
const count = async () => (await sql(
  "select count(*)::int as n from waitlist where guest_name like $1", [`${TAG} %`])).rows[0].n as number;
type Entry = { id: string; guestName: string; phone: string | null; free: number | null };
const listed = async (role = "front_desk") =>
  ((await (await call(role, "GET", "/waitlist")).json()) as { entries: Entry[] }).entries
    .filter((e) => e.guestName.startsWith(TAG));

const ARRIVE = "2031-07-01";
const LEAVE = "2031-07-03";
const entry = (over: Record<string, unknown> = {}) => ({
  guestName: `${TAG} Meera`, phone: "98200 11111", roomTypeId: typeId, arrival: ARRIVE, departure: LEAVE,
  note: "Would take a smaller room", ...over,
});

beforeAll(async () => {
  hotelId = (await sql("select id::text from hotels where code = '5EL'")).rows[0].id;
  typeId = (await sql(`select id::text from room_types where hotel_id = $1 and is_active order by sort_order limit 1`,
    [hotelId])).rows[0].id;
  source = (await sql("select id::text from booking_sources where is_active order by name limit 1")).rows[0].id;
  today = (await sql("select app.business_date($1)::text as d", [hotelId])).rows[0].d;
  for (const role of ["front_desk", "read_only", "housekeeping"]) staff.set(role, await person(role));
});

afterAll(async () => {
  await sql("delete from waitlist where guest_name like $1", [`${TAG} %`]);
  const ids = (await sql(
    `select r.id::text from reservations r join guests g on g.id = r.guest_id where g.full_name like $1`,
    [`${TAG} %`])).rows.map((r) => r.id as string);
  await sql("delete from folios where reservation_id = any($1::uuid[])", [ids]);
  await sql("delete from reservations where id = any($1::uuid[])", [ids]);
  await sql("alter table guests disable trigger guests_no_delete");
  try { await sql("delete from guests where full_name like $1", [`${TAG} %`]); }
  finally { await sql("alter table guests enable trigger guests_no_delete"); }
  const s = [...staff.values()];
  await sql("delete from staff_hotels where staff_id = any($1::uuid[])", [s]);
  await sql("update staff set is_active = false where id = any($1::uuid[])", [s]);
  await closePool();
});

describe("the waitlist", () => {
  it("refuses an entry by name - nothing written - and a viewer", async () => {
    const said = async (over: Record<string, unknown>) => reasonOf(await call("front_desk", "POST", "/waitlist", entry(over)));
    expect(await said({ guestName: " " })).toBe("Whose name goes on the waitlist?");
    expect(await said({ phone: "12" })).toMatch(/is not a phone number/);
    expect(await said({ departure: ARRIVE })).toMatch(/departure is after the arrival/);
    expect(await said({ arrival: plus(today, -1), departure: plus(today, 1) })).toMatch(/on the business date or later/);
    expect(await said({ roomTypeId: "00000000-0000-0000-0000-000000000000" })).toMatch(/That room type is not here/);
    expect((await call("read_only", "POST", "/waitlist", entry())).status).toBe(403);
    expect(await count()).toBe(0);
  });

  it("lists who is waiting, oldest first, with the rooms free now; a phone only for who reads guests", async () => {
    expect((await call("front_desk", "POST", "/waitlist", entry())).status).toBe(200);
    expect((await call("front_desk", "POST", "/waitlist", entry({ guestName: `${TAG} Arun`, phone: "" }))).status).toBe(200);
    const free = (await sql(
      `select min(available)::int as n from app.inventory_grid($1, $2::date, $3::date - 1) where room_type_id = $4`,
      [hotelId, ARRIVE, LEAVE, typeId])).rows[0].n;
    const rows = await listed();
    expect(rows.map((e) => [e.guestName, e.free])).toEqual([[`${TAG} Meera`, free], [`${TAG} Arun`, free]]);
    expect(rows[0]!.phone).toBe("98200 11111");
    expect((await listed("housekeeping"))[0]!.phone).toBeNull();

    /* A booking takes a room on those nights: the list says one fewer, by itself. */
    const taken = await call("front_desk", "POST", "/bookings", {
      guestName: `${TAG} Someone else`, checkIn: ARRIVE, checkOut: LEAVE, bookingSourceId: source,
      lines: [{ roomTypeId: typeId, mealPlan: "EP", adults: 1, rooms: 1, agreedRate: 3000 }],
    });
    expect(taken.status, await taken.clone().text()).toBe(200);
    expect((await listed())[0]!.free).toBe(Math.max(free - 1, 0));
  });

  it("New booking for an entry marks it booked; a second booking for it is refused, nothing written", async () => {
    const meera = (await listed())[0]!;
    const book = (name: string) => call("front_desk", "POST", "/bookings", {
      guestName: name, checkIn: ARRIVE, checkOut: LEAVE, bookingSourceId: source, waitlistId: meera.id,
      lines: [{ roomTypeId: typeId, mealPlan: "EP", adults: 1, rooms: 1, agreedRate: 3000 }],
    });
    const made = await book(`${TAG} Meera`);
    expect(made.status, await made.clone().text()).toBe(200);
    const { rows } = await sql(
      `select w.status, r.reference, w.closed_by is not null as who
         from waitlist w join reservations r on r.id = w.reservation_id where w.id = $1`, [meera.id]);
    expect(rows[0]).toEqual({ status: "booked", reference: ((await made.json()) as { bookings: { reference: string }[] }).bookings[0]!.reference, who: true });
    expect((await listed()).map((e) => e.guestName)).toEqual([`${TAG} Arun`]);

    const again = await book(`${TAG} Meera again`);
    expect(await reasonOf(again)).toMatch(/That guest is no longer on the waitlist/);
    expect((await sql("select count(*)::int as n from guests where full_name = $1", [`${TAG} Meera again`])).rows[0].n).toBe(0);
  });

  it("removing keeps the entry, with who and why; a second remove is refused", async () => {
    const arun = (await listed())[0]!;
    expect((await call("read_only", "POST", `/waitlist/${arun.id}/remove`, {})).status).toBe(403);
    const res = await call("front_desk", "POST", `/waitlist/${arun.id}/remove`, { reason: "Booked elsewhere" });
    expect(res.status).toBe(200);
    expect((await sql("select status, close_reason from waitlist where id = $1", [arun.id])).rows[0])
      .toEqual({ status: "removed", close_reason: "Booked elsewhere" });
    expect(await reasonOf(await call("front_desk", "POST", `/waitlist/${arun.id}/remove`, {})))
      .toMatch(/no longer on the waitlist/);
    expect(await count()).toBe(2);
  });
});
