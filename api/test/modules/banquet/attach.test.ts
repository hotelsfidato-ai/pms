import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { withSession } from "../../../src/auth.ts";
import { whyNotAttachable } from "../../../src/modules/banquet/index.ts";

/* ══════════════════════════════════════════════════════════════════
   RESTAURANT FOOD ON A BANQUET BILL — D17-21, 17 September

   Two halves are banquet's, and this file holds both:

   WHICH FUNCTIONS AN ORDER MAY BE ATTACHED TO. The owner's rule: a
   confirmed function at this property, its bill open, running on the
   business date from its first day to its last. The till's screen reads
   the list; the till's server asks `whyNotAttachable` through banquet's
   front door before it writes. Both are exercised here, against the
   same functions, so the two answers cannot drift apart unseen.

   THE FUNCTION'S BILL SHOWS ITS RESTAURANT ORDERS. Open and settled are
   listed, abandoned is not, and only settled ones are in the total —
   app.banquet_event_total's rule, read by the same numbers.

   The till cannot attach an order yet (the POS chat builds that next),
   so the orders here are written directly as the superuser, and removed
   again with everything else this file made.
   ══════════════════════════════════════════════════════════════════ */

let ownerStaffId: string;
let hotelId: string;
let businessDate: string;

const TAG = `attach-${process.pid}`;
const HALLS = [`North ${TAG}`, `South ${TAG}`, `Lawn ${TAG}`];

let eventsBefore: string[] = [];
let venuesBefore: string[] = [];
let moduleBefore: boolean | null = null;
const ordersMade: string[] = [];

const admin = async () =>
  new (await import("pg")).default.Pool({
    connectionString:
      process.env["SUPER_DATABASE_URL"] ??
      "postgres://postgres:pw@127.0.0.1:55432/fidato",
  });

const as = (path: string, init?: RequestInit) =>
  app.request(`/api/hotels${path}`, {
    ...init,
    headers: {
      "x-dev-staff-id": ownerStaffId,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

const post = (path: string, body?: unknown) =>
  as(path, {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const setBanquet = async (on: boolean) => {
  const db = await admin();
  await db.query(
    `insert into hotel_modules (hotel_id, module, is_enabled)
     values ($1,'banquet',$2)
     on conflict (hotel_id, module) do update set is_enabled = excluded.is_enabled`,
    [hotelId, on]);
  await db.end();
};

const day = (offset: number) => {
  const d = new Date(`${businessDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

/* The functions, by what the rule should say about each. */
const ids: Record<string, string> = {};

async function register(
  key: string, hall: string, startsAt: string, endsAt: string,
) {
  const setup = await (await as("/5EL/banquet/setup")).json() as {
    venues: Array<{ id: string; name: string }>;
  };
  const venueId = setup.venues.find((v) => v.name === hall)!.id;
  const res = await post("/5EL/banquet/events", {
    venueId, title: `${key} ${TAG}`, hostName: "Host", startsAt, endsAt,
  });
  expect(res.status).toBe(200);
  ids[key] = ((await res.json()) as { id: string }).id;
}

const confirm = async (key: string) =>
  expect((await post(`/5EL/banquet/events/${ids[key]}/confirm`)).status).toBe(200);

beforeAll(async () => {
  const db = await admin();
  ownerStaffId = (await db.query<{ id: string }>(
    "select id from staff where email = 'owner@fidato.in'")).rows[0]!.id;
  hotelId = (await db.query<{ id: string }>(
    "select id from hotels where code = '5EL'")).rows[0]!.id;

  const list = async (sql: string) =>
    (await db.query<{ id: string }>(sql, [hotelId])).rows.map((r) => r.id);
  eventsBefore = await list("select id::text from banquet_events where hotel_id = $1");
  venuesBefore = await list("select id::text from banquet_venues where hotel_id = $1");
  moduleBefore = (await db.query<{ is_enabled: boolean }>(
    "select is_enabled from hotel_modules where hotel_id = $1 and module = 'banquet'",
    [hotelId])).rows[0]?.is_enabled ?? null;
  await db.end();

  await setBanquet(true);
  businessDate = ((await (await as("/5EL/banquet")).json()) as {
    businessDate: string;
  }).businessDate;

  for (const name of HALLS) {
    expect((await post("/5EL/banquet/venues", { name })).status).toBe(200);
  }

  const [north, south, lawn] = HALLS as [string, string, string];
  const t = day(0);

  /* Offered: confirmed, bill open, on today. */
  await register("Tonight", north, `${t}T18:00`, `${t}T23:00`);
  await confirm("Tonight");
  /* Offered: a three-day wedding is running on its middle day. */
  await register("Wedding", south, `${day(-1)}T10:00`, `${day(1)}T22:00`);
  await confirm("Wedding");

  /* Not offered: an enquiry has no bill. */
  await register("Enquiry", north, `${t}T08:00`, `${t}T10:00`);
  /* Not offered: confirmed, but tomorrow. */
  await register("Tomorrow", north, `${day(1)}T18:00`, `${day(1)}T23:00`);
  await confirm("Tomorrow");
  /* Not offered: cancelled, though it was confirmed for today. */
  await register("Cancelled", lawn, `${t}T08:00`, `${t}T10:00`);
  await confirm("Cancelled");
  expect((await post(`/5EL/banquet/events/${ids["Cancelled"]}/cancel`,
    { reason: "family postponed" })).status).toBe(200);
  /* Not offered: ended at the stroke of midnight, so yesterday was its
     last day — not today. */
  await register("Midnight", lawn, `${day(-1)}T19:00`, `${t}T00:00`);
  await confirm("Midnight");
});

afterAll(async () => {
  const db = await admin();
  try {
    /* The orders first — they name a function. A settled order's lines
       are frozen against every role (028), so the superuser steps round
       the triggers for the rows THIS FILE made, and nothing else. */
    if (ordersMade.length) {
      await db.query("set session_replication_role = replica");
      await db.query("delete from pos_order_lines where order_id = any($1::uuid[])", [ordersMade]);
      await db.query("delete from pos_orders where id = any($1::uuid[])", [ordersMade]);
      await db.query("set session_replication_role = origin");
    }
    const mine = `select id from banquet_events where hotel_id = $1 and id <> all($2::uuid[])`;
    await db.query(`delete from banquet_event_packages where event_id in (${mine})`,
      [hotelId, eventsBefore]);
    await db.query(`delete from folios where event_id in (${mine})`, [hotelId, eventsBefore]);
    await db.query("delete from banquet_events where hotel_id = $1 and id <> all($2::uuid[])",
      [hotelId, eventsBefore]);
    await db.query("delete from banquet_venues where hotel_id = $1 and id <> all($2::uuid[])",
      [hotelId, venuesBefore]);
    if (moduleBefore === null) {
      await db.query("delete from hotel_modules where hotel_id = $1 and module = 'banquet'",
        [hotelId]);
    } else {
      await db.query(
        "update hotel_modules set is_enabled = $2 where hotel_id = $1 and module = 'banquet'",
        [hotelId, moduleBefore]);
    }
  } finally {
    await db.end();
  }
  await closePool();
});

const why = (eventId: string) =>
  withSession(ownerStaffId, (client) => whyNotAttachable(client, hotelId, eventId));

describe("the functions a restaurant order may be attached to", () => {
  it("offers the confirmed ones running today, and nothing else", async () => {
    const res = await as("/5EL/banquet/attachable");
    expect(res.status).toBe(200);
    const body = await res.json() as {
      enabled: boolean; businessDate: string;
      functions: Array<{ id: string; title: string; venueName: string }>;
    };
    expect(body.enabled).toBe(true);
    expect(body.businessDate).toBe(businessDate);

    /* Only this file's functions: others may exist on the property. */
    const offered = body.functions
      .filter((f) => f.title.endsWith(TAG))
      .map((f) => f.title.replace(` ${TAG}`, ""))
      .sort();
    expect(offered).toEqual(["Tonight", "Wedding"]);
    expect(body.functions.find((f) => f.id === ids["Wedding"])!.venueName)
      .toBe(HALLS[1]);
  });

  it("the till's server gets the same answer, and a sentence for each refusal", async () => {
    expect(await why(ids["Tonight"]!)).toBeNull();
    expect(await why(ids["Wedding"]!)).toBeNull();

    expect(await why(ids["Enquiry"]!)).toMatch(/not confirmed yet/);
    expect(await why(ids["Tomorrow"]!)).toMatch(/not today/);
    expect(await why(ids["Cancelled"]!)).toMatch(/is cancelled/);
    expect(await why(ids["Midnight"]!)).toMatch(/on \d{1,2} \w{3} \d{4}, not today/);
    expect(await why("00000000-0000-0000-0000-000000000000")).toMatch(/no such function/);
    /* Whatever the till sends, it is refused in words, not by a cast error. */
    expect(await why("not-an-id")).toMatch(/no such function/);
  });

  it("at a property with banquet off: an empty list, not a refusal", async () => {
    await setBanquet(false);
    try {
      const res = await as("/5EL/banquet/attachable");
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ enabled: false, functions: [] });
      expect(await why(ids["Tonight"]!)).toMatch(/no banquet hall/);
      /* Every other banquet route still refuses (041). */
      expect((await as("/5EL/banquet")).status).toBe(403);
    } finally {
      await setBanquet(true);
    }
  });
});

describe("a function's bill shows its restaurant orders", () => {
  /* Order, line and status written as the till would leave them. Lines go
     on while the order is open (028 freezes them after). */
  async function order(
    eventId: string, no: string, qty: number, price: number,
    finish: "open" | "settled" | "abandoned",
  ) {
    const db = await admin();
    try {
      const outlet = (await db.query<{ id: string }>(
        "select id from pos_outlets where hotel_id = $1 order by code limit 1",
        [hotelId])).rows[0]!.id;
      const made = (await db.query<{ id: string }>(
        `insert into pos_orders (hotel_id, outlet_id, order_no, table_ref,
                                 business_date, opened_by, event_id)
         values ($1,$2,$3,'B1',$4,$5,$6) returning id::text`,
        [hotelId, outlet, `${no}-${process.pid}`, businessDate, ownerStaffId, eventId]))
        .rows[0]!.id;
      ordersMade.push(made);
      await db.query(
        `insert into pos_order_lines (order_id, hotel_id, name, qty, unit_price,
                                      tax_rate, added_by)
         values ($1,$2,'Masala tea',$3,$4,5,$5)`,
        [made, hotelId, qty, price, ownerStaffId]);
      if (finish === "settled") {
        await db.query(
          `update pos_orders set status = 'settled', settled_by = $2,
                  settled_at = now(), payment_method = 'cash' where id = $1`,
          [made, ownerStaffId]);
      } else if (finish === "abandoned") {
        await db.query(
          `update pos_orders set status = 'abandoned',
                  abandoned_reason = 'test' where id = $1`, [made]);
      }
      const payable = (await db.query<{ payable: string }>(
        "select payable::text from app.pos_order_total($1)", [made])).rows[0]!.payable;
      return { id: made, payable: Number(payable) };
    } finally {
      await db.end();
    }
  }

  it("lists open and settled, leaves out abandoned, and totals only settled", async () => {
    const open = await order(ids["Tonight"]!, "BQT1", 10, 20, "open");
    const settled = await order(ids["Tonight"]!, "BQT2", 4, 250, "settled");
    await order(ids["Tonight"]!, "BQT3", 1, 99, "abandoned");
    /* Somebody else's function: not on this bill. */
    await order(ids["Wedding"]!, "BQT4", 1, 500, "settled");

    const res = await as(`/5EL/banquet/events/${ids["Tonight"]}`);
    expect(res.status).toBe(200);
    const e = await res.json() as {
      restaurantOrders: Array<{
        id: string; orderNo: string; status: string; outlet: string | null;
        table: string | null; amount: number | null;
      }>;
      money: { pos: number | null };
    };

    expect(e.restaurantOrders.map((o) => o.id)).toEqual([open.id, settled.id]);
    expect(e.restaurantOrders.map((o) => o.status)).toEqual(["open", "settled"]);
    expect(e.restaurantOrders[0]!.amount).toBe(open.payable);
    expect(e.restaurantOrders[1]!.amount).toBe(settled.payable);
    expect(e.restaurantOrders[0]!.table).toBe("B1");
    expect(e.restaurantOrders[0]!.outlet).toBeTruthy();

    /* The total's own figure agrees with the one settled order listed. */
    expect(settled.payable).toBeGreaterThan(0);
    expect(e.money.pos).toBe(settled.payable);
  });

  it("a function with none says so with an empty list, not a missing one", async () => {
    const res = await as(`/5EL/banquet/events/${ids["Tomorrow"]}`);
    const e = await res.json() as { restaurantOrders: unknown[] };
    expect(e.restaurantOrders).toEqual([]);
  });
});
