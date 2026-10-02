import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   WAKE-UP CALLS AND LOST PROPERTY, through the API (D27-239, D27-241)

   Wake-up calls: the desk sets one; a guest asks from their own page and
   it waits for the desk to confirm; due from fifteen minutes before until
   done; a cancel says why. Lost property: the desk and housekeeping log;
   only the desk returns (to whom) or disposes (why). Nobody else.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";
const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};
const sha = (v: string) => createHash("sha256").update(v).digest("hex");

const CODE = `WL${String(process.pid).slice(-1)}${String(process.pid).slice(-2, -1)}`;
const TOKEN = "a-booking-link-for-wake-up-tests-0123456789";
const UNLOCK = "an-unlock-for-wake-up-tests-0123456789abcdef";
let hotelId: string;
let stay: string;
let tomorrow: string;
const staff = new Map<string, string>();

const call = (role: string, path: string, method = "GET", body?: unknown) =>
  app.request(`/api/hotels/${CODE}${path}`, {
    method,
    headers: { "x-dev-staff-id": staff.get(role)!, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
type Call = { id: string; status: string; fromGuest: boolean; callAt: string; due: boolean; room: string };
const calls = async (view = "open") =>
  ((await (await call("front_desk", `/wake-up-calls?view=${view}`)).json()) as { calls: Call[] }).calls;
const bell = async (role: string) =>
  ((await (await call(role, "/notifications")).json()) as Array<{ id: string }>).map((x) => x.id);

beforeAll(async () => {
  const owner = (await sql("select id::text from staff where email = 'owner@fidato.in'")).rows[0].id as string;
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  await db.query("select set_config('app.user_id', $1, false)", [owner]);
  hotelId = (await db.query("select app.provision_property_unchecked($1,'Wake Up API','Nowhere')::text as id",
    [CODE])).rows[0].id;
  await db.query("select app.bulk_create_rooms($1, 'STD', 1::smallint, 101, 101)", [hotelId]);
  const guest = (await db.query("insert into guests (full_name) values ('WLTEST Guest') returning id::text")).rows[0].id;
  stay = (await db.query(
    `insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate, status)
     values ($1, app.next_reference($1), $2, (select id from room_types where hotel_id = $1 limit 1),
             app.business_date($1), app.business_date($1) + 3, 2000, 'checked_in') returning id::text`,
    [hotelId, guest])).rows[0].id;
  await db.query(
    `insert into room_assignments (hotel_id, reservation_id, room_id, from_date, to_date, reason)
     select $1, $2, id, app.business_date($1), app.business_date($1) + 3, 'arrival' from rooms where hotel_id = $1`,
    [hotelId, stay]);
  const link = (await db.query(
    `insert into guest_links (hotel_id, reservation_id, token_hash, origin, expires_at)
     values ($1, $2, $3, 'desk', now() + interval '1 day') returning id::text`, [hotelId, stay, sha(TOKEN)])).rows[0].id;
  await db.query(
    `insert into guest_unlocks (link_id, reservation_id, unlock_hash, expires_at) values ($1, $2, $3, now() + interval '1 hour')`,
    [link, stay, sha(UNLOCK)]);
  tomorrow = (await db.query("select to_char(app.hotel_day($1, now()) + 1, 'YYYY-MM-DD') as d", [hotelId])).rows[0].d;
  await db.end();

  for (const role of ["front_desk", "housekeeping", "finance"]) {
    const { rows } = await sql(
      `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
       on conflict (email) do update set is_active = true, full_name = excluded.full_name returning id::text`,
      [`wl-${role}@fidato.in`, `WLTEST ${role}`, `test-uid-wl-${role}`]);
    staff.set(role, rows[0].id);
    await sql("delete from staff_hotels where staff_id = $1", [rows[0].id]);
    await sql("insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)", [rows[0].id, hotelId, role]);
  }
});

afterAll(async () => {
  await sql("delete from wake_up_calls where hotel_id = $1", [hotelId]);
  await sql("delete from lost_items where hotel_id = $1", [hotelId]);
  await sql("delete from guest_unlocks where link_id in (select id from guest_links where hotel_id = $1)", [hotelId]);
  await sql("delete from guest_links where hotel_id = $1", [hotelId]);
  await sql("delete from staff_hotels where staff_id = any($1)", [[...staff.values()]]);
  await sql("update staff set is_active = false where id = any($1)", [[...staff.values()]]);
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  await db.query("alter table hotels disable trigger hotels_no_delete");
  await db.query("delete from hotels where id = $1", [hotelId]);
  await db.query("alter table hotels enable trigger hotels_no_delete");
  await db.end();
  await closePool();
});

describe("wake-up calls (D27-241)", () => {
  it("are the desk's: housekeeping and the accountant are refused", async () => {
    expect((await call("housekeeping", "/wake-up-calls")).status).toBe(403);
    expect((await call("finance", "/wake-up-calls", "POST",
      { reservationId: stay, day: tomorrow, time: "07:00" })).status).toBe(403);
  });

  it("the desk sets one on the hotel's clock; not in the past", async () => {
    const res = await call("front_desk", "/wake-up-calls", "POST", { reservationId: stay, day: tomorrow, time: "07:00" });
    expect(res.status, await res.clone().text()).toBe(200);
    const set = (await calls()).find((c) => c.callAt === `${tomorrow}T07:00`)!;
    expect(set).toMatchObject({ status: "set", fromGuest: false, room: "101", due: false });
    expect((await call("front_desk", "/wake-up-calls", "POST",
      { reservationId: stay, day: "2020-01-01", time: "07:00" })).status).toBe(409);
  });

  it("is due from fifteen minutes before, on the desk's bell and not housekeeping's", async () => {
    await sql(`insert into wake_up_calls (hotel_id, reservation_id, call_at, created_by)
               values ($1, $2, now() + interval '10 minutes', $3)`, [hotelId, stay, staff.get("front_desk")]);
    expect((await calls()).some((c) => c.due)).toBe(true);
    expect(await bell("front_desk")).toContain("wake-up-calls-due");
    expect(await bell("housekeeping")).not.toContain("wake-up-calls-due");
  });

  it("a guest asks from their page; the desk confirms, cancels with a reason, or marks it done", async () => {
    const asked = await app.request(`/api/guest/${TOKEN}/wake-up`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Guest ${UNLOCK}` },
      body: JSON.stringify({ day: tomorrow, time: "06:15" }),
    });
    expect(asked.status, await asked.clone().text()).toBe(200);
    const theirs = (await calls()).find((c) => c.callAt === `${tomorrow}T06:15`)!;
    expect(theirs).toMatchObject({ status: "asked", fromGuest: true });
    expect(await bell("front_desk")).toContain("wake-up-calls-asked");

    expect((await call("front_desk", `/wake-up-calls/${theirs.id}`, "PATCH", { action: "confirm" })).status).toBe(200);
    expect((await call("front_desk", `/wake-up-calls/${theirs.id}`, "PATCH", { action: "cancel" })).status).toBe(409);
    expect((await call("front_desk", `/wake-up-calls/${theirs.id}`, "PATCH", { action: "done" })).status).toBe(200);
    expect((await calls("done")).find((c) => c.id === theirs.id)?.status).toBe("done");

    const mine = await app.request(`/api/guest/${TOKEN}/wake-up`, { headers: { authorization: `Guest ${UNLOCK}` } });
    expect(((await mine.json()) as { calls: unknown[] }).calls.length).toBeGreaterThan(0);
    expect((await app.request(`/api/guest/${TOKEN}/wake-up`)).status, "not without the unlock").toBe(404);
  });
});

describe("lost property (D27-241)", () => {
  it("housekeeping logs, only the desk clears, and a return says to whom", async () => {
    const logged = await call("housekeeping", "/lost-property", "POST",
      { what: "A watch", foundWhere: "Room 101, under the bed", roomNumber: "101", keptWhere: "Desk drawer" });
    expect(logged.status, await logged.clone().text()).toBe(200);
    const kept = ((await (await call("housekeeping", "/lost-property")).json()) as {
      items: Array<{ id: string; what: string; daysKept: number; room: string }>; mayClear: boolean });
    expect(kept.mayClear).toBe(false);
    const watch = kept.items.find((i) => i.what === "A watch")!;
    expect(watch).toMatchObject({ room: "101", daysKept: 0 });

    expect((await call("housekeeping", `/lost-property/${watch.id}`, "PATCH",
      { action: "returned", to: "The guest" })).status).toBe(403);
    expect((await call("front_desk", `/lost-property/${watch.id}`, "PATCH", { action: "returned" })).status).toBe(409);
    expect((await call("front_desk", `/lost-property/${watch.id}`, "PATCH",
      { action: "returned", to: "WLTEST Guest, ID seen" })).status).toBe(200);
    const cleared = ((await (await call("front_desk", "/lost-property?view=cleared")).json()) as {
      items: Array<{ id: string; status: string; returnedTo: string }> }).items;
    expect(cleared.find((i) => i.id === watch.id)).toMatchObject({ status: "returned", returnedTo: "WLTEST Guest, ID seen" });
    expect((await call("finance", "/lost-property")).status).toBe(403);
  });
});
