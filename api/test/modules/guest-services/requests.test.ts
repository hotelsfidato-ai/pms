import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { ROLES } from "../../../src/permissions.ts";
import { teamsFor, RECEIVERS } from "../../../src/modules/guest-services/requests.ts";
import { REPAIR_UPDATERS } from "../../../src/modules/housekeeping/repairRoles.ts";
import { REQUEST_ROLES } from "../../../../src/modules/guest-services/requestRoles.ts";

/* ══════════════════════════════════════════════════════════════════
   GUEST REQUESTS, through the API (D27-178, the owner's D27-181)

   A request is a work order for a stay. The desk sees and acts on every
   team's; each team its own; anybody else is refused. Something broken
   asks what was done and stays on Work orders; housekeeping and food and
   drink close with one tap and stay off it. The bell tells the team.

   Everything is made at a property this file provisions and removes.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";
const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

const CODE = `GS${String(process.pid).slice(-1)}${String(process.pid).slice(-2, -1)}`;
let hotelId: string;
let inHouse: string;
let booked: string;
const staff = new Map<string, string>();

const call = (role: string, path: string, method = "GET", body?: unknown) =>
  app.request(`/api/hotels/${CODE}${path}`, {
    method,
    headers: { "x-dev-staff-id": staff.get(role)!, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

type Req = { id: string; team: string; guest: string | null; what: string;
             status: string; takenBy: string | null; minutes: number; resolution: string | null };
const list = async (role: string, view = "open") =>
  (await (await call(role, `/requests?view=${view}`)).json()) as { teams: string[]; requests: Req[] };
const raise = async (team: string, what: string) => {
  const res = await call("front_desk", "/requests", "POST", { reservationId: inHouse, team, what });
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as { id: string }).id;
};

beforeAll(async () => {
  const owner = (await sql("select id::text from staff where email = 'owner@fidato.in'")).rows[0].id as string;
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  await db.query("select set_config('app.user_id', $1, false)", [owner]);
  hotelId = (await db.query("select app.provision_property_unchecked($1,'Requests Test','Nowhere')::text as id",
    [CODE])).rows[0].id;
  await db.query("select app.bulk_create_rooms($1, 'STD', 1::smallint, 101, 102)", [hotelId]);
  const guest = (await db.query("insert into guests (full_name) values ('GSTEST Guest') returning id::text"))
    .rows[0].id;
  const stay = (status: string, from: number) => db.query(
    `insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate, status)
     values ($1, app.next_reference($1), $2, (select id from room_types where hotel_id = $1 limit 1),
             current_date + $4::int, current_date + $4::int + 1, 2000, $3)
     returning id::text`, [hotelId, guest, status, from]);
  inHouse = (await stay("checked_in", 0)).rows[0].id;
  booked = (await stay("confirmed", 3)).rows[0].id;
  await db.query(
    `insert into room_assignments (hotel_id, reservation_id, room_id, from_date, to_date, reason)
     select $1, $2, id, current_date, current_date + 1, 'arrival' from rooms where hotel_id = $1 and number = '101'`,
    [hotelId, inHouse]);
  await db.end();

  for (const role of ["front_desk", "housekeeping", "chef", "stores", "finance", "gm"]) {
    const { rows } = await sql(
      `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
       on conflict (email) do update set is_active = true, full_name = excluded.full_name returning id::text`,
      [`gst-${role}@fidato.in`, `GSTEST ${role}`, `test-uid-gst-${role}`]);
    staff.set(role, rows[0].id);
    await sql("delete from staff_hotels where staff_id = $1", [rows[0].id]);
    await sql("insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)", [rows[0].id, hotelId, role]);
  }
});

afterAll(async () => {
  await sql("delete from work_orders where hotel_id = $1", [hotelId]);
  await sql("delete from staff_hotels where staff_id = any($1)", [[...staff.values()]]);
  await sql("update staff set is_active = false where id = any($1)", [[...staff.values()]]);
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  await db.query("alter table hotels disable trigger hotels_no_delete");
  await db.query("delete from hotels where id = $1", [hotelId]);
  await db.query("alter table hotels enable trigger hotels_no_delete");
  await db.end();
  await closePool();
});

describe("who (D27-181)", () => {
  it("the screen and the server name the same people, and something broken is the repair list", () => {
    expect(ROLES.filter((r) => teamsFor(r).length > 0)).toEqual(
      ROLES.filter((r) => REQUEST_ROLES.includes(r as never)));
    expect([...RECEIVERS.maintenance].sort()).toEqual([...REPAIR_UPDATERS].sort());
  });

  it("the desk sees every team's, housekeeping its own two, the kitchen food and drink", async () => {
    const towels = await raise("housekeeping", "GSTEST towels");
    const tap = await raise("maintenance", "GSTEST tap drips");
    const tea = await raise("fnb", "GSTEST tea");
    const ids = async (role: string) => (await list(role)).requests.map((r) => r.id).sort();
    expect(await ids("front_desk")).toEqual([towels, tap, tea].sort());
    expect(await ids("housekeeping")).toEqual([towels, tap].sort());
    expect(await ids("chef")).toEqual([tea]);
    expect(await ids("stores")).toEqual([tap]);
  });

  it("a guest's name only for a role that reads guests", async () => {
    expect((await list("front_desk")).requests[0]!.guest).toBe("GSTEST Guest");
    expect((await list("chef")).requests[0]!.guest).toBeNull();
  });

  it("anybody outside the teams is refused, and raises nothing", async () => {
    expect((await call("finance", "/requests")).status).toBe(403);
    expect((await call("finance", "/requests", "POST",
      { reservationId: inHouse, team: "fnb", what: "GSTEST no" })).status).toBe(403);
    expect((await sql("select count(*)::int as n from work_orders where title = 'GSTEST no'")).rows[0].n).toBe(0);
  });

  it("the kitchen cannot act on housekeeping's", async () => {
    const towels = (await list("front_desk")).requests.find((r) => r.what === "GSTEST towels")!;
    expect((await call("chef", `/requests/${towels.id}`, "PATCH", { action: "take" })).status).toBe(403);
  });
});

describe("raising, taking, closing", () => {
  it("only for a guest in house now", async () => {
    const res = await call("front_desk", "/requests", "POST",
      { reservationId: booked, team: "fnb", what: "GSTEST not yet" });
    expect(res.status).toBe(409);
    expect((await sql("select count(*)::int as n from work_orders where title = 'GSTEST not yet'")).rows[0].n).toBe(0);
  });

  it("take, then done in one tap: who took it and how long it took", async () => {
    const towels = (await list("housekeeping")).requests.find((r) => r.what === "GSTEST towels")!;
    expect((await call("housekeeping", `/requests/${towels.id}`, "PATCH", { action: "take" })).status).toBe(200);
    expect((await call("front_desk", `/requests/${towels.id}`, "PATCH", { action: "take" })).status).toBe(409);
    expect((await call("housekeeping", `/requests/${towels.id}`, "PATCH", { action: "done" })).status).toBe(200);
    const done = (await list("front_desk", "done")).requests.find((r) => r.id === towels.id)!;
    expect(done.status).toBe("done");
    expect(done.takenBy).toBe("GSTEST housekeeping");
    expect(done.minutes).toBeGreaterThanOrEqual(0);
  });

  it("something broken asks what was done; a cancel asks why", async () => {
    const tap = (await list("front_desk")).requests.find((r) => r.what === "GSTEST tap drips")!;
    expect((await call("housekeeping", `/requests/${tap.id}`, "PATCH", { action: "done" })).status).toBe(409);
    const tea = (await list("chef")).requests.find((r) => r.what === "GSTEST tea")!;
    expect((await call("chef", `/requests/${tea.id}`, "PATCH", { action: "cancel" })).status).toBe(409);
    expect((await call("housekeeping", `/requests/${tap.id}`, "PATCH",
      { action: "done", note: "Washer replaced" })).status).toBe(200);
    expect((await call("housekeeping", `/requests/${tap.id}`, "PATCH",
      { action: "done", note: "Again" })).status).toBe(409);
  });
});

describe("where else it shows", () => {
  it("Work orders keeps something broken and leaves housekeeping and food and drink off", async () => {
    await raise("housekeeping", "GSTEST pillow");
    await raise("maintenance", "GSTEST light out");
    const res = await call("gm", "/work-orders");
    const titles = ((await res.json()) as { orders: Array<{ title: string }> }).orders.map((o) => o.title);
    expect(titles).toContain("GSTEST light out");
    expect(titles).not.toContain("GSTEST pillow");
  });

  it("the bell tells the team, and not a team it is not for", async () => {
    await raise("fnb", "GSTEST coffee");
    const bell = async (role: string) =>
      ((await (await call(role, "/notifications")).json()) as Array<{ id: string; title: string }>)
        .find((x) => x.id === "guest-requests-waiting");
    expect((await bell("chef"))?.title).toMatch(/guest request/);
    await sql(`update work_orders set status = 'in_progress' where hotel_id = $1 and category <> 'fnb'`, [hotelId]);
    expect(await bell("housekeeping")).toBeUndefined();
  });
});
