import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { READ_RULES, WRITE_RULES, whoMay } from "../../../src/roleGate.ts";

/* ══════════════════════════════════════════════════════════════════
   TABLE BOOKINGS, THE RESTAURANT'S SIDE (the owner's D27-221, D27-224)

   Lunch 12:30-15:00 and dinner 19:30-23:00 in half-hour slots unless the
   restaurant sets its own - IN THE HOTEL'S TIME ZONE, the last seating half
   an hour before a meal ends. A person confirms (a table if they like) or
   declines with a reason, once, while the request waits. Everything here
   runs on a restaurant of its own and is removed afterwards.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "TBTEST";
const people: Record<"gm" | "waiter" | "housekeeper", string> = { gm: "", waiter: "", housekeeper: "" };
let outlet = "";
let otherOutlet = "";
let table = "";
let otherTable = "";
let stay = "";
let wasZone = "";

async function sql<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}
const call = (who: string, method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method,
    headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const reason = async (res: Response) => ((await res.json()) as { reason: string }).reason;
/** A booking straight into the table, as the guest's function makes one. */
const book = async (at: string, status = "requested") => (await sql<{ id: string }>(
  `insert into table_bookings (hotel_id, outlet_id, reservation_id, party, at, status, answer)
   select o.hotel_id, o.id, $2, 2, $3::timestamptz, $4, case when $4 = 'declined' then 'Full' end
     from pos_outlets o where o.id = $1 returning id::text`, [outlet, stay, at, status]))[0]!.id;
const slots = async (outletId: string, date: string) => (await sql<{ s: string }>(
  "select to_char(s at time zone 'UTC', 'HH24:MI') as s from app.table_slots($1, $2::date) s",
  [outletId, date])).map((r) => r.s);

beforeAll(async () => {
  /* An outlet runs as somebody; the owner, as the restaurant's own tests do. */
  const owner = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  [outlet, otherOutlet] = [
    (await sql<{ id: string }>(
      `insert into pos_outlets (hotel_id, code, name, category, staff_id)
       select id, $1, 'Table Test Restaurant', 'food', $2 from hotels where code = '5EL' returning id::text`, [TAG, owner]))[0]!.id,
    (await sql<{ id: string }>(
      `insert into pos_outlets (hotel_id, code, name, category, staff_id)
       select id, $1, 'Table Test Elsewhere', 'food', $2 from hotels where code = 'AGR' returning id::text`, [TAG, owner]))[0]!.id,
  ];
  const tableOf = async (o: string) => {
    const [section] = await sql<{ id: string }>(
      "insert into pos_sections (hotel_id, outlet_id, name) select hotel_id, id, 'Garden' from pos_outlets where id = $1 returning id::text", [o]);
    return (await sql<{ id: string }>(
      "insert into pos_tables (hotel_id, section_id, label) select hotel_id, $2, 'G1' from pos_outlets where id = $1 returning id::text",
      [o, section!.id]))[0]!.id;
  };
  table = await tableOf(outlet);
  otherTable = await tableOf(otherOutlet);
  stay = (await sql<{ id: string }>(
    `select r.id::text from reservations r join hotels h on h.id = r.hotel_id
      where h.code = '5EL' and r.status in ('confirmed', 'checked_in') limit 1`))[0]!.id;
  wasZone = (await sql<{ timezone: string }>("select timezone from hotels where code = 'AGR'"))[0]!.timezone;

  for (const [who, role] of [["gm", "gm"], ["waiter", "pos"], ["housekeeper", "housekeeping"]] as const) {
    const [row] = await sql<{ id: string }>(
      `insert into staff (email, full_name) values ($1, $2)
       on conflict (email) do update set is_active = true returning id::text`,
      [`tbtest-${who}@fidato.in`, `${TAG} ${who}`]);
    people[who] = row!.id;
    await sql("delete from staff_hotels where staff_id = $1", [row!.id]);
    await sql("insert into staff_hotels (staff_id, hotel_id, role) select $1, id, $2 from hotels where code = '5EL'",
      [row!.id, role]);
  }
});

afterAll(async () => {
  await sql("delete from table_bookings where outlet_id = any($1::uuid[])", [[outlet, otherOutlet]]);
  await sql("delete from pos_tables where id = any($1::uuid[])", [[table, otherTable]]);
  await sql("delete from pos_sections where outlet_id = any($1::uuid[])", [[outlet, otherOutlet]]);
  await sql("delete from pos_outlets where id = any($1::uuid[])", [[outlet, otherOutlet]]);
  await sql("update hotels set timezone = $1 where code = 'AGR'", [wasZone]);
  await sql("delete from staff_hotels where staff_id = any($1::uuid[])", [Object.values(people)]);
  await sql("update staff set is_active = false where id = any($1::uuid[])", [Object.values(people)]);
  await closePool();
});

describe("a restaurant's slots", () => {
  it("are the owner's default, half-hourly, the last half an hour before each meal ends - in the hotel's time", async () => {
    /* Akkalkot is IST: 12:30 there is 07:00 UTC; 22:30 is 17:00 UTC. */
    expect(await slots(outlet, "2026-10-02")).toEqual([
      "07:00", "07:30", "08:00", "08:30", "09:00",
      "14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00",
    ]);
  });

  it("follow the hotel's own time zone, not the server's", async () => {
    /* A hotel set to London: 12:30 on 2 October (summer time) is 11:30 UTC. */
    await sql("update hotels set timezone = 'Europe/London' where code = 'AGR'");
    expect((await slots(otherOutlet, "2026-10-02"))[0]).toBe("11:30");
    /* And after the clocks go back, 12:30 is 12:30 UTC. */
    expect((await slots(otherOutlet, "2026-11-02"))[0]).toBe("12:30");
  });

  it("follow the hours the restaurant sets, and none for a meal left empty", async () => {
    await sql("update pos_outlets set table_lunch = '', table_dinner = '19:00-21:00' where id = $1", [outlet]);
    expect(await slots(outlet, "2026-10-02")).toEqual(["13:30", "14:00", "14:30", "15:00"]);
    await sql("update pos_outlets set table_lunch = null, table_dinner = null where id = $1", [outlet]);
  });

  it("refuse hours that are not on the half hour or end before they start", async () => {
    for (const bad of ["12:15-15:00", "15:00-12:30", "noon"]) {
      await expect(sql("update pos_outlets set table_lunch = $2 where id = $1", [outlet, bad])).rejects.toThrow();
    }
  });
});

describe("the hours on Restaurant setup", () => {
  it("are set by exactly the owner, an administrator and the GM", () => {
    expect(whoMay(WRITE_RULES["PUT /api/hotels/:code/table-bookings/hours"]!)).toEqual(["owner", "admin", "gm"]);
  });

  it("are saved by the GM - empty for none - and read back with the slots they give", async () => {
    const res = await call(people.gm, "PUT", "/table-bookings/hours", { outlet: TAG, lunch: "", dinner: "19:30-21:00" });
    expect(res.status, await res.clone().text()).toBe(200);
    const read = (await (await call(people.gm, "GET", "/table-bookings/hours")).json()) as
      { restaurants: Array<{ code: string; lunch: string; dinner: string; slots: string[] }> };
    expect(read.restaurants.find((r) => r.code === TAG)).toEqual({
      code: TAG, name: "Table Test Restaurant", lunch: "", dinner: "19:30-21:00",
      slots: ["19:30", "20:00", "20:30"],
    });
  });

  it("refuse hours in a sentence, and the housekeeper in the gate's words", async () => {
    const bad = await call(people.gm, "PUT", "/table-bookings/hours", { outlet: TAG, lunch: "12-3", dinner: "" });
    expect(bad.status).toBe(409);
    expect(await reason(bad)).toMatch(/^Lunch is two times on the hour or half hour/);
    const hk = await call(people.housekeeper, "PUT", "/table-bookings/hours", { outlet: TAG, lunch: "", dinner: "" });
    expect(hk.status).toBe(403);
    await sql("update pos_outlets set table_lunch = null, table_dinner = null where id = $1", [outlet]);
  });
});

describe("answering a guest's request", () => {
  it("is for the till's people; the list is theirs to read", () => {
    for (const route of ["POST /api/hotels/:code/table-bookings/:id/confirm", "POST /api/hotels/:code/table-bookings/:id/decline"]) {
      expect(whoMay(WRITE_RULES[route]!), route).toContain("pos");
      expect(whoMay(WRITE_RULES[route]!), route).not.toContain("housekeeping");
    }
    expect(READ_RULES["GET /api/hotels/:code/table-bookings"]).toBeDefined();
  });

  it("lists what waits first, with the guest, the room and the time in the hotel's zone", async () => {
    const later = await book("2099-01-02T14:30:00Z", "confirmed");
    const waiting = await book("2099-01-03T14:00:00Z");
    const res = await call(people.waiter, "GET", "/table-bookings");
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { bookings: Array<Record<string, unknown>>; tables: Array<{ id: string; label: string }> };
    const mine = body.bookings.filter((b) => b["id"] === later || b["id"] === waiting);
    expect(mine.map((b) => b["id"])).toEqual([waiting, later]);
    expect(mine[0]).toMatchObject({ date: "2099-01-03", time: "19:30", party: 2, status: "requested" });
    expect(typeof mine[0]!["guest"]).toBe("string");
    expect(body.tables.map((t) => t.id)).toContain(table);
    expect(body.tables.map((t) => t.id)).not.toContain(otherTable);
  });

  it("confirms a waiting request once, with a table of this restaurant's", async () => {
    const id = await book("2099-01-04T14:00:00Z");
    const elsewhere = await call(people.waiter, "POST", `/table-bookings/${id}/confirm`, { tableId: otherTable });
    expect(elsewhere.status).toBe(409);
    expect(await reason(elsewhere)).toBe("That table is not one of this restaurant's.");

    const res = await call(people.waiter, "POST", `/table-bookings/${id}/confirm`, { tableId: table });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await sql("select status, table_id::text, answered_by::text from table_bookings where id = $1", [id]))[0])
      .toEqual({ status: "confirmed", table_id: table, answered_by: people.waiter });

    const again = await call(people.gm, "POST", `/table-bookings/${id}/decline`, { reason: "Full" });
    expect(again.status).toBe(409);
    expect(await reason(again)).toBe("This booking is confirmed already, so it is not answered again.");
  });

  it("declines only with a reason the guest reads, and not one the guest cancelled", async () => {
    const id = await book("2099-01-05T14:00:00Z");
    const bare = await call(people.waiter, "POST", `/table-bookings/${id}/decline`, { reason: "  " });
    expect(bare.status).toBe(409);
    expect(await reason(bare)).toBe("Say why, in a few words: the guest reads it.");
    expect((await call(people.waiter, "POST", `/table-bookings/${id}/decline`, { reason: "We are closed for a private event." })).status).toBe(200);
    expect((await sql("select status, answer from table_bookings where id = $1", [id]))[0])
      .toEqual({ status: "declined", answer: "We are closed for a private event." });

    const cancelled = await book("2099-01-06T14:00:00Z", "cancelled");
    const late = await call(people.waiter, "POST", `/table-bookings/${cancelled}/confirm`, {});
    expect(late.status).toBe(409);
    expect(await reason(late)).toBe("This booking is cancelled already, so it is not answered again.");
  });

  it("is refused to the housekeeper, and nothing changes", async () => {
    const id = await book("2099-01-07T14:00:00Z");
    expect((await call(people.housekeeper, "POST", `/table-bookings/${id}/confirm`, {})).status).toBe(403);
    expect((await sql("select status from table_bookings where id = $1", [id]))[0]).toEqual({ status: "requested" });
  });
});

describe("the bell", () => {
  const bell = async (who: string) =>
    ((await (await call(who, "GET", "/notifications")).json()) as Array<{ id: string; title: string; link: string }>)
      .filter((n) => n.id === "table-bookings-waiting");

  it("tells the people who answer how many wait, and not the housekeeper", async () => {
    await sql("update table_bookings set status = 'cancelled' where hotel_id = (select id from hotels where code = '5EL') and status = 'requested'");
    expect(await bell(people.waiter)).toEqual([]);
    await book("2099-02-01T14:00:00Z");
    await book("2099-02-02T14:00:00Z");
    const notes = await bell(people.waiter);
    expect(notes.map((n) => [n.title, n.link])).toEqual([["2 table bookings waiting", "/h/5EL/table-bookings"]]);
    expect(await bell(people.housekeeper)).toEqual([]);
  });
});

describe("the database's own rules", () => {
  it("keep the restaurant, the stay and the table at one hotel, and a decline's reason", async () => {
    await expect(sql(
      `insert into table_bookings (hotel_id, outlet_id, reservation_id, party, at)
       select h.id, $1, $2, 2, now() from hotels h where h.code = '5EL'`, [otherOutlet, stay])).rejects.toThrow(/another property/);
    await expect(sql(
      `insert into table_bookings (hotel_id, outlet_id, reservation_id, party, at, status)
       select hotel_id, id, $2, 2, now(), 'declined' from pos_outlets where id = $1`, [outlet, stay])).rejects.toThrow();
    await expect(sql(
      `insert into table_bookings (hotel_id, outlet_id, reservation_id, party, at)
       select hotel_id, id, $2, 21, now() from pos_outlets where id = $1`, [outlet, stay])).rejects.toThrow();
  });
});
