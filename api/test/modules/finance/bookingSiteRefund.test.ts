import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   A BOOKING-SITE STAY THAT PAID THE HOTEL (the owner's D27-328 (2))

   A booking-site guest who paid the whole stay by UPI at the desk and left
   after one night could not be checked out: Check out asked for a refund and
   the refund answered "A booking-site stay: the booking site refunds the
   guest..." - a dead end, proved by the verifier.

   Now a booking-site stay's bill gives back money paid AT THE HOTEL exactly
   as a guest's own bill does: only the ways it was paid there, never "Bill
   to company", with the same rights and the same ₹20,000 cash rule. The
   notice stays only where nothing paid at the desk is there to give back.

   A property of its own (OTR). Each stay: one night of ₹3,000 posted.
     PAID   UPI ₹6,000 at the desk               ₹3,000 owed back, by UPI
     SITE   "Bill to company" ₹6,000             the notice, nothing here
     MIXED  "Bill to company" ₹3,000 + UPI ₹1,500   ₹1,500 back by UPI only
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const CODE = "OTR";
const NOTICE = "A booking-site stay: the booking site refunds the guest. Tell the booking site; nothing is refunded here.";
let hotelId = "";
const stays: Record<string, string> = {};

const call = (path: string, method = "GET", body?: unknown) =>
  app.request(`/api/hotels/${CODE}${path}`, {
    method,
    headers: {
      "x-dev-staff-id": "dev-owner",
      ...(body === undefined ? {} : { "content-type": "application/json", "idempotency-key": randomUUID() }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

type Options = { bills: { credit: number; notice: string | null; ways: { label: string; upTo: number }[] }[] };
const options = async (name: string) =>
  ((await (await call(`/stays/${stays[name]}/refunds`)).json()) as Options).bills[0]!;
const refund = (name: string, body: Record<string, unknown>) =>
  call(`/stays/${stays[name]}/refunds`, "POST", { reason: "Left a night early", ...body });
const reason = async (res: Response) => ((await res.json()) as { reason: string }).reason;

beforeAll(async () => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER, max: 1 });
  try {
    const owner = (await db.query<{ id: string }>(
      "select id::text from staff where email = 'owner@fidato.in'")).rows[0]!;
    await db.query("select set_config('app.user_id', $1, false)", [owner.id]);
    hotelId = (await db.query<{ id: string }>(
      "select app.provision_property_unchecked($1, 'Site Refund Test', 'Nowhere')::text as id", [CODE])).rows[0]!.id;
    await db.query("insert into tax_rules (hotel_id, kind, over_amount, rate) values ($1, 'room', 0, 0)", [hotelId]);
    /* Rooms leave at midnight: a check-out on the departure day is never late. */
    await db.query("update hotels set check_out_time = '23:59' where id = $1", [hotelId]);
    const guest = (await db.query<{ id: string }>(
      "insert into guests (full_name, nationality) values ('OTR Guest', 'IN') returning id::text")).rows[0]!.id;
    for (const name of ["PAID", "SITE", "MIXED"]) {
      /* Booked for one night from the hotel's day, and that night posted:
         checking out today frees no night, so only the money stands in the way. */
      const id = (await db.query<{ id: string }>(
        `insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
                                   agreed_rate, status, source)
         values ($1, $2, $3, (select id from room_types where hotel_id = $1 and code = 'STD'),
                 app.business_date($1), app.business_date($1) + 1, 3000, 'checked_in', 'ota')
         returning id::text`, [hotelId, `${CODE}-${name}`, guest])).rows[0]!.id;
      stays[name] = id;
      const folio = (await db.query<{ id: string }>(
        "insert into folios (hotel_id, reservation_id) values ($1, $2) returning id::text", [hotelId, id])).rows[0]!.id;
      await db.query(
        `insert into folio_postings (hotel_id, folio_id, business_date, category, description,
                                     amount, tax_rate, tax_amount)
         values ($1, $2, app.business_date($1), 'room', 'Room', 3000, 0, 0)`, [hotelId, folio]);
    }
  } finally { await db.end(); }

  for (const [name, method, amount] of [
    ["PAID", "UPI", 6000], ["SITE", "Bill to company", 6000],
    ["MIXED", "Bill to company", 3000], ["MIXED", "UPI", 1500],
  ] as const) {
    const res = await call(`/stays/${stays[name]}/payments`, "POST", { method, amount, heldAsCredit: true });
    expect(res.status, `${name} ${method}: ${await res.clone().text()}`).toBe(200);
  }
}, 180_000);

afterAll(async () => {
  await closePool();
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try {
    for (const t of ["folio_postings folio_postings_append_only", "hotels hotels_no_delete"]) {
      await db.query(`alter table ${t.split(" ")[0]} disable trigger ${t.split(" ")[1]}`);
    }
    await db.query("delete from hotels where id = $1", [hotelId]);
  } finally {
    for (const t of ["folio_postings folio_postings_append_only", "hotels hotels_no_delete"]) {
      await db.query(`alter table ${t.split(" ")[0]} enable trigger ${t.split(" ")[1]}`);
    }
    await db.end();
  }
}, 120_000);

describe("D27-328 (2) · a booking-site stay gives back what was paid at the hotel", () => {
  it("offers the UPI paid at the desk, with no notice", async () => {
    const bill = await options("PAID");
    expect(bill.credit).toBe(3000);
    expect(bill.notice).toBeNull();
    expect(bill.ways.map((w) => [w.label, w.upTo])).toEqual([["UPI", 3000]]);
  });

  it("goes back only the way it was paid at the hotel, never 'Bill to company'", async () => {
    const cash = await refund("PAID", { method: "Cash", amount: 100 });
    expect(cash.status).toBe(409);
    expect(await reason(cash)).toMatch(/^This bill was not paid by Cash\. A refund goes back the way it was paid: UPI/);
    const company = await refund("PAID", { method: "Bill to company", amount: 100, reference: "X" });
    expect(await reason(company)).toBe("\"Bill to company\" is not a way this hotel gives money back.");
  });

  it("is refused at check-out until given back, then the guest checks out", async () => {
    const early = await call(`/stays/${stays["PAID"]}/check-out`, "POST", {});
    expect(early.status).toBe(409);
    expect(await reason(early)).toMatch(/overpaid by ₹3,000.*Refund it/);
    const res = await refund("PAID", { method: "UPI", amount: 3000, reference: "UPI 9911" });
    expect(res.status, await res.clone().text()).toBe(200);
    const out = await call(`/stays/${stays["PAID"]}/check-out`, "POST", {});
    expect(out.status, await out.clone().text()).toBe(200);
  });

  it("keeps the notice where the booking site was paid and nothing at the desk", async () => {
    const bill = await options("SITE");
    expect(bill).toMatchObject({ credit: 3000, notice: NOTICE, ways: [] });
    const res = await refund("SITE", { method: "UPI", amount: 100, reference: "UPI 1" });
    expect(res.status).toBe(409);
    expect(await reason(res)).toBe(NOTICE);
  });

  it("gives back only the desk's part of a bill paid both ways", async () => {
    const bill = await options("MIXED");
    expect(bill.credit).toBe(1500);
    expect(bill.notice).toBeNull();
    expect(bill.ways.map((w) => [w.label, w.upTo])).toEqual([["UPI", 1500]]);
  });
});
