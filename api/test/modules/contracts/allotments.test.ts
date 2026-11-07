import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   ALLOTMENTS (D27-383 item 8, migration 267) - every refusal by name,
   each counted in the database afterwards

     holding     kept by the owner, an administrator and the GM (reception
                 is refused); never more than is free on a night - an
                 allotment never overbooks the hotel; nights inside the
                 contract; the release still ahead
     picking up  a booking from it is the allotment's company's, its room
                 type, its nights, no more than it holds - and it takes the
                 held rooms even where the desk may not overbook and nothing
                 else is free
     changing    never fewer rooms than are booked from it; stopping puts
                 what it holds back on sale
   The release itself, and its idempotence, are db/tests/modules/contracts.sql.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const TAG = "ALOT";
const NIGHT1 = "2031-06-10";
const NIGHT3 = "2031-06-12";
let hotelId: string;
let typeId: string;
let otherTypeId: string;
let source: string;
let agent: string;
let contractId: string;
let sellable: number;
let overbook: boolean;
let today: string;
const plus = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const staff = new Map<string, string>();

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
    [`alot-${role}@fidato.in`, `${TAG} ${role}`, `test-uid-alot-${role}`]);
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
const allotments = async () => (await sql(
  "select count(*)::int as n from allotments where contract_id = $1", [contractId])).rows[0].n as number;
const available = async (night: string) => (await sql(
  "select available from app.inventory_grid($1, $2::date, $2::date) where room_type_id = $3",
  [hotelId, night, typeId])).rows[0].available as number;

const hold = (over: Record<string, unknown> = {}) => ({
  contractId, roomTypeId: typeId, firstNight: NIGHT1, lastNight: NIGHT3, rooms: 2, releaseDays: 3, ...over,
});
const book = (name: string, over: Record<string, unknown> = {}, line: Record<string, unknown> = {}) =>
  call("front_desk", "POST", "/bookings", {
    guestName: `${TAG} ${name}`, checkIn: NIGHT1, checkOut: "2031-06-12", bookingSourceId: source,
    lines: [{ roomTypeId: typeId, mealPlan: "EP", adults: 1, children: 0, rooms: 1, ...line }], ...over,
  });

beforeAll(async () => {
  hotelId = (await sql("select id::text from hotels where code = '5EL'")).rows[0].id;
  const types = (await sql(
    `select id::text from room_types where hotel_id = $1 and is_active order by sort_order`, [hotelId])).rows;
  typeId = types[0].id;
  otherTypeId = types[1].id;
  source = (await sql("select id::text from booking_sources where is_active order by name limit 1")).rows[0].id;
  overbook = (await sql("select desk_may_overbook as y from hotels where id = $1", [hotelId])).rows[0].y;
  for (const role of ["front_desk", "gm", "read_only"]) staff.set(role, await person(role));
  agent = (await sql(`insert into companies (name, kind) values ($1, 'travel_agent') returning id::text`,
    [`${TAG} Agent`])).rows[0].id;
  today = (await sql("select app.business_date($1)::text as d", [hotelId])).rows[0].d;
  contractId = (await sql(
    `insert into contracts (hotel_id, company_id, name, valid_from, valid_to, pricing)
     values ($1, $2, $3, $4::date - 5, '2031-12-31', 'rates') returning id::text`,
    [hotelId, agent, `${TAG} 2031`, today])).rows[0].id;
  await sql(`insert into contract_rates (hotel_id, contract_id, room_type_id, meal_plan, price_single, price_double)
             values ($1, $2, $3, 'EP', 2100, 2400)`, [hotelId, contractId, typeId]);
  sellable = await available(NIGHT1);
});

afterAll(async () => {
  await sql("update hotels set desk_may_overbook = $2 where id = $1", [hotelId, overbook]);
  const ids = (await sql(
    `select r.id::text from reservations r join guests g on g.id = r.guest_id where g.full_name like $1`,
    [`${TAG} %`])).rows.map((r) => r.id as string);
  await sql("delete from folios where reservation_id = any($1::uuid[])", [ids]);
  await sql("delete from reservations where id = any($1::uuid[])", [ids]);
  await sql("delete from allotment_releases where allotment_id in (select id from allotments where contract_id = $1)", [contractId]);
  await sql("delete from allotments where contract_id = $1", [contractId]);
  await sql("delete from contract_rates where contract_id = $1", [contractId]);
  await sql("delete from contracts where id = $1", [contractId]);
  await sql("delete from companies where name like $1", [`${TAG} %`]);
  await sql("alter table guests disable trigger guests_no_delete");
  try { await sql("delete from guests where full_name like $1", [`${TAG} %`]); }
  finally { await sql("alter table guests enable trigger guests_no_delete"); }
  const people = [...staff.values()];
  await sql("delete from staff_hotels where staff_id = any($1::uuid[])", [people]);
  await sql("update staff set is_active = false where id = any($1::uuid[])", [people]);
  await closePool();
});

describe("holding rooms", () => {
  it("is the owner's, an administrator's or the GM's: reception and a viewer are refused, nothing written", async () => {
    expect((await call("front_desk", "POST", "/allotments", hold())).status).toBe(403);
    expect((await call("read_only", "POST", "/allotments", hold())).status).toBe(403);
    expect(await allotments()).toBe(0);
  });

  it("refuses nights outside the contract, and a release already past, by name", async () => {
    const outside = await call("gm", "POST", "/allotments", hold({ lastNight: "2032-01-02" }));
    expect(await reasonOf(outside)).toMatch(/to 31 Dec 2031; an allotment's nights are inside its contract/);
    const huge = await call("gm", "POST", "/allotments", hold({ releaseDays: 400 }));
    expect(await reasonOf(huge)).toMatch(/Release days is a whole number from 0 to 365/);
    /* Two days ahead with three days' release: its release date was yesterday. */
    const tooLate = await call("gm", "POST", "/allotments",
      hold({ firstNight: plus(today, 2), lastNight: plus(today, 3), releaseDays: 3 }));
    expect(await reasonOf(tooLate)).toMatch(/With 3 days' release, the rooms for .* would go back on sale at tonight's night audit/);
    const before = await call("gm", "POST", "/allotments", hold({ firstNight: plus(today, -1), lastNight: plus(today, 1) }));
    expect(await reasonOf(before)).toMatch(/An allotment starts on the business date/);
    expect(await allotments()).toBe(0);
  });

  it("never overbooks the hotel: more than is free on a night is refused, naming the night", async () => {
    const all = await call("gm", "POST", "/allotments", hold({ rooms: sellable + 1 }));
    expect(all.status).toBe(409);
    expect(await reasonOf(all)).toMatch(new RegExp(`Only ${sellable} .* free on 10 Jun 2031; the allotment would hold ${sellable + 1} more. An allotment never overbooks the hotel`));
    expect(await allotments()).toBe(0);

    const made = await call("gm", "POST", "/allotments", hold());
    expect(made.status, await made.clone().text()).toBe(200);
    expect(await available(NIGHT1)).toBe(sellable - 2);
    const second = await call("gm", "POST", "/allotments", hold({ rooms: sellable - 1 }));
    expect(await reasonOf(second)).toMatch(new RegExp(`Only ${sellable - 2} `));
    expect(await allotments()).toBe(1);
  });
});

describe("booking from it", () => {
  let allotmentId: string;
  beforeAll(async () => {
    allotmentId = (await sql("select id::text from allotments where contract_id = $1", [contractId])).rows[0].id;
  });

  it("refuses another room type, nights outside it, more than it holds, another company - nothing written", async () => {
    const other = await book("Other type", { allotmentId }, { roomTypeId: otherTypeId });
    expect(await reasonOf(other)).toMatch(/^Only .* rooms are held in this allotment\.$/);
    const outside = await book("Outside", { allotmentId, checkOut: "2031-06-14" });
    expect(await reasonOf(outside)).toMatch(/holds the nights of 10 Jun 2031 to 12 Jun 2031; this stay runs outside them/);
    const many = await book("Too many", { allotmentId }, { rooms: 3 });
    expect(await reasonOf(many)).toMatch(/Only 2 rooms are left in the allotment on 10 Jun 2031/);
    const corp = (await sql(`insert into companies (name) values ($1) returning id::text`, [`${TAG} Corp`])).rows[0].id;
    const elsewhere = await book("Another company", { allotmentId, companyId: corp });
    expect(await reasonOf(elsewhere)).toMatch(/This allotment is held for ALOT Agent; book it for them/);
    expect((await sql("select count(*)::int as n from reservations where allotment_id = $1", [allotmentId])).rows[0].n).toBe(0);
  });

  it("is made for its company at the contract's rate, and takes held rooms where nothing else is free", async () => {
    await sql("update hotels set desk_may_overbook = false where id = $1", [hotelId]);
    /* Fill every room not held, so only the allotment's are left. */
    const filler = await call("front_desk", "POST", "/bookings", {
      guestName: `${TAG} Filler`, checkIn: NIGHT1, checkOut: "2031-06-13", bookingSourceId: source,
      lines: [{ roomTypeId: typeId, mealPlan: "EP", adults: 1, rooms: sellable - 2, agreedRate: 3000 }],
    });
    expect(filler.status, await filler.clone().text()).toBe(200);
    const plain = await book("No room", {}, { agreedRate: 3000 });
    expect(plain.status).toBe(409);
    expect(await reasonOf(plain)).toMatch(/has no room free for every night/);

    const picked = await book("From the allotment", { allotmentId });
    expect(picked.status, await picked.clone().text()).toBe(200);
    const { rows } = await sql(
      `select r.allotment_id::text as a, r.company_id::text as co, r.agreed_rate::float8 as rate, r.contract_id::text as k
         from reservations r join guests g on g.id = r.guest_id where g.full_name = $1`, [`${TAG} From the allotment`]);
    expect(rows[0]).toEqual({ a: allotmentId, co: agent, rate: 2100, k: contractId });
    expect(await available(NIGHT1)).toBe(0);
    const held = (await sql("select held from app.allotment_held($1, $2::date, $2::date) where allotment_id = $3",
      [hotelId, NIGHT1, allotmentId])).rows[0].held;
    expect(held).toBe(1);
  });

  it("refuses a night already released, saying when", async () => {
    await sql(`insert into allotment_releases (allotment_id, hotel_id, night, rooms, business_date)
               values ($1, $2, '2031-06-11', 1, '2031-06-08')`, [allotmentId, hotelId]);
    const released = await book("Released", { allotmentId });
    expect(await reasonOf(released)).toMatch(/rooms for 11 Jun 2031 went back on sale at the night audit of 8 Jun 2031/);
    await sql("delete from allotment_releases where allotment_id = $1", [allotmentId]);
  });

  it("a change never holds fewer than are booked; stopping puts what it holds back on sale", async () => {
    const fewer = await call("gm", "PUT", `/allotments/${allotmentId}`, hold({ rooms: 0 }));
    expect(await reasonOf(fewer)).toMatch(/Rooms is a whole number from 1 to 500/);
    await book("Second pickup", { allotmentId });
    const crowded = await call("gm", "PUT", `/allotments/${allotmentId}`, hold({ rooms: 1 }));
    expect(await reasonOf(crowded)).toMatch(/2 rooms are booked from it on 10 Jun 2031; it cannot hold fewer than 2/);
    const shorter = await call("gm", "PUT", `/allotments/${allotmentId}`, hold({ lastNight: NIGHT1 }));
    expect(await reasonOf(shorter)).toMatch(/is booked from this allotment outside those nights/);
    const type = await call("gm", "PUT", `/allotments/${allotmentId}`, hold({ roomTypeId: otherTypeId }));
    expect(await reasonOf(type)).toMatch(/keeps its room type and contract/);

    expect((await call("front_desk", "PUT", `/allotments/${allotmentId}`, { active: false })).status).toBe(403);
    const stop = await call("gm", "PUT", `/allotments/${allotmentId}`, { active: false });
    expect(stop.status).toBe(200);
    expect((await sql("select is_active from allotments where id = $1", [allotmentId])).rows[0].is_active).toBe(false);
    const after = await book("After the stop", { allotmentId });
    expect(await reasonOf(after)).toMatch(/That allotment is not held any more/);
  });

  it("the night audit releases what is due, says how many, and a second run releases nothing", async () => {
    const pun = (await sql("select id::text from hotels where code = 'PUN'")).rows[0].id as string;
    const owner = (await sql("select id::text from staff where email = 'owner@fidato.in'")).rows[0].id as string;
    /* As nightAudit.test.ts sets Pune up: open from midnight, sixty days back
       unless a file before this one already closed a day there. */
    await sql("update hotels set night_audit_opens_at = '00:00' where id = $1", [pun]);
    await sql(`update hotels set business_date = (now() at time zone timezone)::date - 60
                where id = $1 and not exists (select 1 from night_audit_runs n
                                                where n.hotel_id = hotels.id and n.status = 'completed')`, [pun]);
    const day = (await sql("select app.business_date($1)::text as d", [pun])).rows[0].d as string;
    const type = (await sql("select id::text from room_types where hotel_id = $1 order by sort_order limit 1", [pun])).rows[0].id;
    const k = (await sql(`insert into contracts (hotel_id, company_id, name, valid_from, valid_to, pricing, discount_percent)
                          values ($1, $2, $3, $4::date, $4::date + 30, 'discount', 5) returning id::text`,
      [pun, agent, `${TAG} Pune`, day])).rows[0].id as string;
    /* 2 rooms on the nights of day+2 and day+3, released 2 days before each:
       closing `day` releases day+2 only. */
    const a = (await sql(`insert into allotments (hotel_id, contract_id, room_type_id, first_night, last_night, rooms, release_days)
                          values ($1, $2, $3, $4::date + 2, $4::date + 3, 2, 2) returning id::text`,
      [pun, k, type, day])).rows[0].id as string;
    const close = () => app.request("/api/hotels/PUN/night-audit/run", {
      method: "POST", headers: { "x-dev-staff-id": owner, "content-type": "application/json" },
      body: JSON.stringify({ businessDate: day }),
    });
    try {
      const first = await close();
      const body = (await first.json()) as { ok: boolean; allotmentRoomsReleased?: number; reason?: string };
      expect(body.ok, body.reason).toBe(true);
      expect(body.allotmentRoomsReleased).toBe(2);
      const again = await close();
      expect(again.status).toBe(409);
      const rows = (await sql("select night::text, rooms, business_date::text as d from allotment_releases where allotment_id = $1", [a])).rows;
      expect(rows).toEqual([{ night: plus(day, 2), rooms: 2, d: day }]);
    } finally {
      await sql("delete from allotment_releases where allotment_id = $1", [a]);
      await sql("delete from allotments where id = $1", [a]);
      await sql("delete from contracts where id = $1", [k]);
    }
  });

  it("an allotment's nights keep its contract's dates: shortening the contract past them is refused", async () => {
    const made = await call("gm", "POST", "/allotments", hold({ firstNight: "2031-09-01", lastNight: "2031-09-02", rooms: 1 }));
    expect(made.status, await made.clone().text()).toBe(200);
    const res = await call("gm", "PUT", `/contracts/${contractId}`, {
      name: `${TAG} 2031`, validFrom: plus(today, -5), validTo: "2031-08-31", pricing: "rates",
      rates: [{ roomTypeId: typeId, mealPlan: "EP", single: 2100, double: 2400 }],
    });
    expect(await reasonOf(res)).toMatch(/allotment from 1 Sept? 2031 to 2 Sept? 2031 would be outside those dates/);
  });
});
