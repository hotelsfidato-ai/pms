import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { withDrawer } from "../../drawer.ts";

/* ══════════════════════════════════════════════════════════════════
   A FUNCTION'S BILL (BQ-1, QA 28 September; the owner's D27-132 to
   D27-138): an advance, the bill, settling it, the tax invoice.

   Money goes through finance's own doors (round A's per-bill exports), so
   what these prove is banquet's part: what is put on the bill and when,
   the refusals before it, and who may. Everything made here at 5EL is
   removed afterwards, and the banquet switch and GST rule put back.
   ══════════════════════════════════════════════════════════════════ */

let ownerId: string;
let hotelId: string;
let eventId: string;
let folioId: string;
let eventsBefore: string[] = [];
let venuesBefore: string[] = [];
let moduleBefore: boolean | null = null;
let taxBefore: Array<{ over_amount: string; rate: string; note: string | null }> = [];
const byRole = new Map<string, string>();

const TAG = `bill-${process.pid}`;

const admin = async () =>
  new (await import("pg")).default.Pool({
    connectionString:
      process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato",
  });
const sql = async (text: string, params: unknown[] = []) => {
  const db = await admin();
  try { return await db.query(text, params); } finally { await db.end(); }
};

const send = (staffId: string, method: string, path: string, body?: unknown, key?: string) =>
  app.request(`/api/hotels/5EL${path}`, {
    method,
    headers: {
      "x-dev-staff-id": staffId, "content-type": "application/json",
      ...(key ? { "idempotency-key": key } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const owner = (method: string, path: string, body?: unknown, key?: string) =>
  send(ownerId, method, path, body, key);
const reason = async (r: Response) => ((await r.json()) as { reason: string }).reason;
const lines = async () => (await sql(
  `select category, amount::numeric::float8 as amount, tax_rate::float8 as rate
     from folio_postings where folio_id = $1 order by id`, [folioId])).rows;
const theBill = async () => ((await (await owner("GET", `/banquet/events/${eventId}`)).json()) as {
  status: string; bill: { charges: number; tax: number; paid: number; balance: number } | null;
  invoice: string | null;
});

beforeAll(async () => {
  ownerId = (await sql("select id::text from staff where email = 'owner@fidato.in'")).rows[0].id;
  hotelId = (await sql("select id::text from hotels where code = '5EL'")).rows[0].id;
  eventsBefore = (await sql("select id::text from banquet_events where hotel_id = $1", [hotelId])).rows.map((r) => r.id);
  venuesBefore = (await sql("select id::text from banquet_venues where hotel_id = $1", [hotelId])).rows.map((r) => r.id);
  moduleBefore = (await sql(
    "select is_enabled from hotel_modules where hotel_id = $1 and module = 'banquet'", [hotelId])).rows[0]?.is_enabled ?? null;
  taxBefore = (await sql(
    "select over_amount::text, rate::text, note from tax_rules where hotel_id = $1 and kind = 'banquet'", [hotelId])).rows;
  await sql(`insert into hotel_modules (hotel_id, module, is_enabled) values ($1,'banquet',true)
             on conflict (hotel_id, module) do update set is_enabled = true`, [hotelId]);

  for (const role of ["front_desk", "finance"]) {
    const id = (await sql(
      `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
       on conflict (email) do update set is_active = true returning id::text`,
      [`${TAG}-${role}@fidato.in`, `${TAG} ${role}`, `test-uid-${TAG}-${role}`])).rows[0].id;
    await sql("insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)", [id, hotelId, role]);
    byRole.set(role, id);
  }

  expect((await owner("PUT", "/tax/banquet", { slabs: [] })).status).toBe(200);
  const hall = await owner("POST", "/banquet/venues", { name: `Hall ${TAG}` });
  const venueId = ((await hall.json()) as { id: string }).id;
  const made = await owner("POST", "/banquet/events", {
    venueId, title: `Wedding ${TAG}`, hostName: "Mr Kulkarni", agreedAmount: 50000,
    startsAt: "2027-01-20T18:00", endsAt: "2027-01-20T23:00",
  });
  eventId = ((await made.json()) as { id: string }).id;
  expect((await owner("POST", `/banquet/events/${eventId}/catering`,
    { name: "Dinner", pax: 100, ratePerHead: 500 })).status).toBe(200);
  const confirmed = await owner("POST", `/banquet/events/${eventId}/confirm`);
  folioId = ((await confirmed.json()) as { folioId: string }).folioId;
});

afterAll(async () => {
  const db = await admin();
  try {
    const mine = "select id from banquet_events where hotel_id = $1 and id <> all($2::uuid[])";
    const bills = `select id from folios where event_id in (${mine})`;
    await db.query("set session_replication_role = replica");
    await db.query(`delete from invoices where folio_id in (${bills})`, [hotelId, eventsBefore]);
    await db.query(`delete from payments where posting_id in (select id from folio_postings where folio_id in (${bills}))`, [hotelId, eventsBefore]);
    await db.query(`delete from folio_postings where folio_id in (${bills})`, [hotelId, eventsBefore]);
    await db.query(`delete from folios where event_id in (${mine})`, [hotelId, eventsBefore]);
    await db.query(`delete from banquet_event_packages where event_id in (${mine})`, [hotelId, eventsBefore]);
    await db.query("delete from banquet_events where hotel_id = $1 and id <> all($2::uuid[])", [hotelId, eventsBefore]);
    await db.query("delete from banquet_venues where hotel_id = $1 and id <> all($2::uuid[])", [hotelId, venuesBefore]);
    await db.query("set session_replication_role = origin");
    await db.query("delete from staff_hotels where staff_id = any($1::uuid[])", [[...byRole.values()]]);
    await db.query("delete from tax_rules where hotel_id = $1 and kind = 'banquet'", [hotelId]);
    for (const t of taxBefore) {
      await db.query("insert into tax_rules (hotel_id, kind, over_amount, rate, note) values ($1,'banquet',$2,$3,$4)",
        [hotelId, t.over_amount, t.rate, t.note]);
    }
    if (moduleBefore === null) {
      await db.query("delete from hotel_modules where hotel_id = $1 and module = 'banquet'", [hotelId]);
    } else {
      await db.query("update hotel_modules set is_enabled = $2 where hotel_id = $1 and module = 'banquet'", [hotelId, moduleBefore]);
    }
  } finally {
    await db.end();
  }
  await closePool();
});

describe("an advance, before the function is billed", () => {
  it("is refused to reception (D27-132)", async () => {
    const r = await send(byRole.get("front_desk")!, "POST", `/banquet/events/${eventId}/payments`,
      { method: "UPI", amount: 10000 });
    expect(r.status).toBe(403);
  });

  it("is a payment on the function's bill, once per press", async () => {
    const key = crypto.randomUUID();
    const r = await owner("POST", `/banquet/events/${eventId}/payments`, { method: "UPI", amount: 10000 }, key);
    expect(r.status, await r.clone().text()).toBe(200);
    const again = await owner("POST", `/banquet/events/${eventId}/payments`, { method: "UPI", amount: 10000 }, key);
    expect(again.status).toBe(200);
    expect(await lines()).toEqual([{ category: "payment", amount: -10000, rate: 0 }]);
    expect((await theBill()).bill).toEqual({ charges: 0, tax: 0, paid: 10000, balance: -10000 });
  });

  it("refuses cash of ₹2,00,000 or more for the function (s.186)", async () => {
    /* D27-118: cash only into an open drawer - the owner's, for this one try. */
    const r = await withDrawer("5EL", ownerId, () =>
      owner("POST", `/banquet/events/${eventId}/payments`, { method: "Cash", amount: 200000, pan: "ABCDE1234F" }));
    expect(r.status).toBe(409);
    expect(await reason(r)).toContain("₹2,00,000");
  });
});

describe("billing the function", () => {
  it("is refused to the accountant", async () => {
    const r = await send(byRole.get("finance")!, "POST", `/banquet/events/${eventId}/bill`);
    expect(r.status).toBe(403);
  });

  it("is refused while the banquet tax is not set, and posts nothing (D27-124)", async () => {
    const r = await owner("POST", `/banquet/events/${eventId}/bill`);
    expect(r.status).toBe(409);
    expect(await reason(r)).toContain("Banquet tax is not set");
    expect((await lines()).filter((l) => l.category !== "payment")).toEqual([]);
  });

  it("is refused while a course has no price, and says which", async () => {
    await owner("PUT", "/tax/banquet", { slabs: [{ overAmount: 0, rate: 18, note: `${TAG} fixture` }] });
    const add = await owner("POST", `/banquet/events/${eventId}/catering`, { name: "Snacks", pax: 100 });
    expect(add.status).toBe(200);
    const r = await owner("POST", `/banquet/events/${eventId}/bill`);
    expect(r.status).toBe(409);
    expect(await reason(r)).toContain("No price yet for Snacks");
    const snacks = (await sql("select id::text from banquet_event_packages where event_id = $1 and name = 'Snacks'", [eventId])).rows[0].id;
    expect((await owner("DELETE", `/banquet/events/${eventId}/catering/${snacks}`)).status).toBe(200);
  });

  it("puts the hall and the courses on the bill under the Banquet rate, and fixes the price", async () => {
    const r = await owner("POST", `/banquet/events/${eventId}/bill`);
    expect(r.status, await r.clone().text()).toBe(200);
    expect((await lines()).filter((l) => l.category !== "payment")).toEqual([
      { category: "misc", amount: 50000, rate: 18 },
      { category: "food", amount: 50000, rate: 18 },
    ]);
    const b = await theBill();
    expect(b.status).toBe("completed");
    expect(b.bill).toEqual({ charges: 100000, tax: 18000, paid: 10000, balance: 108000 });

    const price = await owner("PATCH", `/banquet/events/${eventId}`, { agreedAmount: 40000 });
    expect(price.status).toBe(409);
    expect(await reason(price)).toContain("fixed");
    expect((await owner("POST", `/banquet/events/${eventId}/cancel`, { reason: "x" })).status).toBe(409);
    const twice = await owner("POST", `/banquet/events/${eventId}/bill`);
    expect(await reason(twice)).toContain("already on its bill");
  });
});

describe("settling it, and the tax invoice", () => {
  it("takes the rest, and issues finance's invoice to the host under the catering SAC", async () => {
    const paid = await owner("POST", `/banquet/events/${eventId}/payments`, { method: "UPI", amount: 108000 });
    expect(paid.status, await paid.clone().text()).toBe(200);
    expect((await theBill()).bill?.balance).toBe(0);

    const inv = await send(byRole.get("finance")!, "POST", `/banquet/events/${eventId}/invoice`);
    expect(inv.status, await inv.clone().text()).toBe(200);
    const { number } = (await inv.json()) as { number: string };
    const again = await owner("POST", `/banquet/events/${eventId}/invoice`);
    expect(((await again.json()) as { number: string }).number).toBe(number);

    const row = (await sql(
      "select recipient_name, sac_code, taxable_value::float8 as taxable, tax_total::float8 as tax from invoices where number = $1 and hotel_id = $2",
      [number, hotelId])).rows[0];
    expect(row).toEqual({ recipient_name: "Mr Kulkarni", sac_code: "996334", taxable: 100000, tax: 18000 });
    expect((await theBill()).invoice).toBe(number);
  });
});
