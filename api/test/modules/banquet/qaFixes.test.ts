import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE QA OF 28 SEPTEMBER, IN THE BANQUET HALL

   D27-124  a function set up while the banquet GST rule is unset says so,
            when it is registered and on its own page.
   D27-120  a price of 0 is kept only when it is ticked Free: the hall's
            price, a hall's usual rate, a package and a course.
   BQ-6     a function's reference is made one at a time per property,
            and is not cut after 9,999.
   X-2      an impossible telephone is refused.

   Everything this file makes at 5EL it removes, and the banquet switch
   and GST rule go back to what they were (root MEMORY 120, 292).
   ══════════════════════════════════════════════════════════════════ */

let ownerStaffId: string;
let hotelId: string;
let eventsBefore: string[] = [];
let venuesBefore: string[] = [];
let packagesBefore: string[] = [];
let moduleBefore: boolean | null = null;
let taxBefore: Array<{ over_amount: string; rate: string; note: string | null }> = [];
let venueId: string;

const TAG = `qa-${process.pid}`;

const admin = async () =>
  new (await import("pg")).default.Pool({
    connectionString:
      process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato",
  });

const as = (path: string, init?: RequestInit) =>
  app.request(`/api/hotels${path}`, {
    ...init,
    headers: { "x-dev-staff-id": ownerStaffId, "content-type": "application/json",
               ...(init?.headers ?? {}) },
  });
const send = (method: string, path: string, body: unknown) =>
  as(path, { method, body: JSON.stringify(body) });
const reason = async (r: Response) => ((await r.json()) as { reason: string }).reason;

const register = (extra: Record<string, unknown> = {}) =>
  send("POST", "/5EL/banquet/events", {
    venueId, title: `Function ${TAG}`, hostName: "Mr Rao",
    startsAt: "2027-02-10T18:00", endsAt: "2027-02-10T22:00", ...extra,
  });

beforeAll(async () => {
  const db = await admin();
  ownerStaffId = (await db.query<{ id: string }>(
    "select id from staff where email = 'owner@fidato.in'")).rows[0]!.id;
  hotelId = (await db.query<{ id: string }>(
    "select id from hotels where code = '5EL'")).rows[0]!.id;
  const ids = async (q: string) => (await db.query<{ id: string }>(q, [hotelId])).rows.map((r) => r.id);
  eventsBefore = await ids("select id::text from banquet_events where hotel_id = $1");
  venuesBefore = await ids("select id::text from banquet_venues where hotel_id = $1");
  packagesBefore = await ids("select id::text from banquet_packages where hotel_id = $1");
  moduleBefore = (await db.query<{ is_enabled: boolean }>(
    "select is_enabled from hotel_modules where hotel_id = $1 and module = 'banquet'",
    [hotelId])).rows[0]?.is_enabled ?? null;
  taxBefore = (await db.query(
    "select over_amount::text, rate::text, note from tax_rules where hotel_id = $1 and kind = 'banquet'",
    [hotelId])).rows;
  await db.query(
    `insert into hotel_modules (hotel_id, module, is_enabled) values ($1,'banquet',true)
     on conflict (hotel_id, module) do update set is_enabled = true`, [hotelId]);
  await db.end();

  const hall = await send("POST", "/5EL/banquet/venues", { name: `Hall ${TAG}` });
  venueId = ((await hall.json()) as { id: string }).id;
});

afterAll(async () => {
  const db = await admin();
  try {
    const mine = `select id from banquet_events where hotel_id = $1 and id <> all($2::uuid[])`;
    await db.query(`delete from banquet_event_packages where event_id in (${mine})`, [hotelId, eventsBefore]);
    await db.query(`delete from folios where event_id in (${mine})`, [hotelId, eventsBefore]);
    await db.query("delete from banquet_events where hotel_id = $1 and id <> all($2::uuid[])", [hotelId, eventsBefore]);
    await db.query("delete from banquet_packages where hotel_id = $1 and id <> all($2::uuid[])", [hotelId, packagesBefore]);
    await db.query("delete from banquet_venues where hotel_id = $1 and id <> all($2::uuid[])", [hotelId, venuesBefore]);
    await db.query("delete from tax_rules where hotel_id = $1 and kind = 'banquet'", [hotelId]);
    for (const t of taxBefore) {
      await db.query(
        "insert into tax_rules (hotel_id, kind, over_amount, rate, note) values ($1,'banquet',$2,$3,$4)",
        [hotelId, t.over_amount, t.rate, t.note]);
    }
    if (moduleBefore === null) {
      await db.query("delete from hotel_modules where hotel_id = $1 and module = 'banquet'", [hotelId]);
    } else {
      await db.query("update hotel_modules set is_enabled = $2 where hotel_id = $1 and module = 'banquet'",
        [hotelId, moduleBefore]);
    }
  } finally {
    await db.end();
  }
  await closePool();
});

describe("banquet tax not set (D27-124)", () => {
  let eventId: string;

  it("warns when a function is registered, and on its page", async () => {
    /* Unset the way a person would: the GST card's own route, no slabs. */
    expect((await send("PUT", "/5EL/tax/banquet", { slabs: [] })).status).toBe(200);

    const r = await register();
    expect(r.status, await r.clone().text()).toBe(200);
    const body = (await r.json()) as { id: string; warning: string | null };
    eventId = body.id;
    expect(body.warning).toContain("Banquet tax is not set: ask the GM to set it before the bill.");

    const page = (await (await as(`/5EL/banquet/events/${eventId}`)).json()) as { taxWarning: string | null };
    expect(page.taxWarning).toContain("Banquet tax is not set");
  });

  it("says nothing once the GM has set it", async () => {
    expect((await send("PUT", "/5EL/tax/banquet",
      { slabs: [{ overAmount: 0, rate: 5, note: `${TAG} fixture` }] })).status).toBe(200);
    const page = (await (await as(`/5EL/banquet/events/${eventId}`)).json()) as { taxWarning: string | null };
    expect(page.taxWarning).toBeNull();
    const r = await register({ title: `Second ${TAG}` });
    expect(((await r.json()) as { warning: string | null }).warning ?? "").not.toContain("Banquet tax");
  });
});

describe("a price of 0 only when ticked Free (D27-120)", () => {
  it("refuses 0 for the hall's price, and keeps it when Free is ticked", async () => {
    const bare = await register({ title: `Zero ${TAG}`, agreedAmount: 0 });
    expect(bare.status).toBe(409);
    expect(await reason(bare)).toContain("ticked Free");

    const free = await register({ title: `Free ${TAG}`, agreedAmount: 0, free: true });
    expect(free.status, await free.clone().text()).toBe(200);
    const id = ((await free.json()) as { id: string }).id;

    const amend = await send("PATCH", `/5EL/banquet/events/${id}`, { agreedAmount: 0 });
    expect(amend.status).toBe(409);
    const course = await send("POST", `/5EL/banquet/events/${id}/catering`,
      { name: "Tea", pax: 10, ratePerHead: 0 });
    expect(course.status).toBe(409);
    const freeCourse = await send("POST", `/5EL/banquet/events/${id}/catering`,
      { name: "Tea", pax: 10, ratePerHead: 0, free: true });
    expect(freeCourse.status, await freeCourse.clone().text()).toBe(200);
  });

  it("refuses 0 for a hall's usual rate and a package's rate a head", async () => {
    expect((await send("POST", "/5EL/banquet/venues", { name: `Zero hall ${TAG}`, defaultRate: 0 })).status).toBe(409);
    expect((await send("PATCH", `/5EL/banquet/venues/${venueId}`, { defaultRate: 0 })).status).toBe(409);
    expect((await send("PATCH", `/5EL/banquet/venues/${venueId}`, { defaultRate: 0, free: true })).status).toBe(200);
    expect((await send("POST", "/5EL/banquet/packages", { name: `Pkg ${TAG}`, ratePerHead: 0 })).status).toBe(409);
    expect((await send("POST", "/5EL/banquet/packages", { name: `Pkg ${TAG}`, ratePerHead: 0, free: true })).status).toBe(200);
  });
});

describe("the telephone (X-2)", () => {
  it("refuses a telephone that is not one", async () => {
    const r = await register({ title: `Phone ${TAG}`, hostPhone: "abc" });
    expect(r.status).toBe(409);
    expect(await reason(r)).toContain("is not a phone number");
  });
});

describe("a function's reference (BQ-6)", () => {
  it("is not cut after 9,999, and two at once both get one", async () => {
    /* The 9,999th is written directly: registering ten thousand functions
       to reach it is not a test anybody would run. */
    const db = await admin();
    const bd = (await db.query<{ d: string }>("select app.business_date($1)::text as d", [hotelId])).rows[0]!.d;
    await db.query(
      `insert into banquet_events (hotel_id, venue_id, reference, title, starts_at, ends_at,
                                   business_date, host_name, registered_by)
       values ($1, $2, 'BQ-0000-9999', $3, '2027-03-01 10:00+05:30', '2027-03-01 11:00+05:30',
               $4, 'Fixture', $5)`,
      [hotelId, venueId, `Nine ${TAG}`, bd, ownerStaffId]);
    await db.end();

    const [a, b] = await Promise.all([
      register({ title: `Ten A ${TAG}` }), register({ title: `Ten B ${TAG}` }),
    ]);
    expect(a.status, await a.clone().text()).toBe(200);
    expect(b.status, await b.clone().text()).toBe(200);
    const refs = [((await a.json()) as { reference: string }).reference,
                  ((await b.json()) as { reference: string }).reference]
      .map((r) => r.split("-").pop()).sort();
    expect(refs).toEqual(["10000", "10001"]);
  });
});
