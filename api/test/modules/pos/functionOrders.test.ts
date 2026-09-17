import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   A RESTAURANT ORDER ON A BANQUET FUNCTION'S BILL — D17-21, the till's half

   The owner, 17 September: staff attach an order to a function when
   ordering (Tables, the Terminal, the Till), and such an order is PAID ON
   THE FUNCTION'S BILL ONLY — settled "to the function"; cash, card, UPI
   and a room are refused for it; it may come off the function while open.

   WHICH functions is the banquet service's rule (confirmed, bill open,
   running on the business date), asked through its front door. So these
   tests make real functions through banquet's own routes and let its rule
   answer — a till that kept its own copy would pass here only by luck.

   THE ASSERTION THAT MATTERS: a refusal writes nothing, and a function
   settlement is counted ONCE on the function's bill
   (app.banquet_event_total, 061).
   ══════════════════════════════════════════════════════════════════ */

const TAG = `till-fn-${process.pid}`;

let staffId: string;
let hotelId: string;
let businessDate: string;
let outlet: string;
let item: string;

let eventsBefore: string[] = [];
let venuesBefore: string[] = [];
let moduleBefore: boolean | null = null;
const ordersMade: string[] = [];
const ids: Record<string, string> = {};

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
      "x-dev-staff-id": staffId,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

const send = (method: string, path: string, body?: unknown) =>
  as(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

const day = (offset: number) => {
  const d = new Date(`${businessDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

async function func(key: string, startsAt: string, endsAt: string, confirmed: boolean) {
  const setup = await (await as("/5EL/banquet/setup")).json() as {
    venues: Array<{ id: string; name: string }>;
  };
  const venueId = setup.venues.find((v) => v.name === `Hall ${TAG}`)!.id;
  const res = await send("POST", "/5EL/banquet/events", {
    venueId, title: `${key} ${TAG}`, hostName: "Host", startsAt, endsAt,
  });
  expect(res.status).toBe(200);
  ids[key] = ((await res.json()) as { id: string }).id;
  if (confirmed) {
    expect((await send("POST", `/5EL/banquet/events/${ids[key]}/confirm`)).status)
      .toBe(200);
  }
}

type OrderBody = {
  ok?: boolean; id: string; status: string; reason?: string;
  eventId: string | null; eventTitle: string | null;
  paymentMethod: string | null; payable: number;
  tenders: { method: string; amount: number }[];
};

/** A new order with one dish on it, through the pad's route. */
async function newOrder(extra: Record<string, unknown> = {}) {
  const res = await send("POST", "/5EL/till/orders/batch", {
    outlet, table: `FN-${ordersMade.length + 1}`,
    lines: [{ itemId: item, qty: 1 }], ...extra,
  });
  const body = await res.json() as OrderBody;
  if (res.status === 200) ordersMade.push(body.id);
  return { res, body };
}

async function orderRow(id: string) {
  const db = await admin();
  try {
    const { rows } = await db.query<{
      status: string; event_id: string | null; tenders: string;
    }>(
      `select o.status, o.event_id::text,
              (select count(*) from pos_order_tenders t where t.order_id = o.id)::text as tenders
         from pos_orders o where o.id = $1`, [id]);
    return rows[0]!;
  } finally {
    await db.end();
  }
}

beforeAll(async () => {
  const db = await admin();
  try {
    staffId = (await db.query<{ id: string }>(
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
    await db.query(
      `insert into hotel_modules (hotel_id, module, is_enabled) values ($1,'banquet',true)
       on conflict (hotel_id, module) do update set is_enabled = true`, [hotelId]);

    outlet = (await db.query<{ code: string }>(
      `select code from pos_outlets where hotel_id = $1 and is_active
        order by code limit 1`, [hotelId])).rows[0]!.code;
    item = (await db.query<{ id: string }>(
      `select i.id::text from pos_menu_items i
        where i.hotel_id = $1 and i.is_active and i.off_until is null
          and not exists (select 1 from pos_item_variations v
                           where v.item_id = i.id and v.is_active)
        limit 1`, [hotelId])).rows[0]!.id;
  } finally {
    await db.end();
  }

  businessDate = ((await (await as("/5EL/banquet")).json()) as {
    businessDate: string;
  }).businessDate;
  expect((await send("POST", "/5EL/banquet/venues", { name: `Hall ${TAG}` })).status)
    .toBe(200);

  const t = day(0);
  await func("Dinner", `${t}T18:00`, `${t}T23:00`, true);
  await func("Lunch", `${t}T12:00`, `${t}T15:00`, true);
  await func("Enquiry", `${t}T08:00`, `${t}T10:00`, false);
});

afterAll(async () => {
  const db = await admin();
  try {
    if (ordersMade.length) {
      /* A settled order's lines are frozen against every role (028); the
         superuser steps round the triggers for THIS file's rows only. */
      await db.query("set session_replication_role = replica");
      await db.query("delete from pos_order_tenders where order_id = any($1::uuid[])", [ordersMade]);
      await db.query("delete from pos_line_events where line_id in (select id from pos_order_lines where order_id = any($1::uuid[]))", [ordersMade]);
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

describe("attaching an order to a banquet function", () => {
  it("puts an open order on a function the banquet service allows", async () => {
    const { body: order } = await newOrder();
    const res = await send("PATCH", `/5EL/till/orders/${order.id}`, { eventId: ids["Dinner"] });
    expect(res.status).toBe(200);
    const body = await res.json() as OrderBody;
    expect(body.eventId).toBe(ids["Dinner"]);
    expect(body.eventTitle).toBe(`Dinner ${TAG}`);
  });

  it("refuses a function the banquet service does not allow, in its words, and writes nothing", async () => {
    const { body: order } = await newOrder();
    const res = await send("PATCH", `/5EL/till/orders/${order.id}`, { eventId: ids["Enquiry"] });
    /* What was written first, then the answer (tillBatch.test.ts: a guard
       should fail on the thing it exists to catch). */
    expect((await orderRow(order.id)).event_id, "a refused function was written").toBeNull();
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toContain("not confirmed");
  });

  it("takes the function with the pad's round, and refuses the whole round for a wrong one", async () => {
    const { res, body } = await newOrder({ eventId: ids["Dinner"], send: true });
    expect(res.status).toBe(200);
    expect(body.eventId).toBe(ids["Dinner"]);

    const db = await admin();
    const count = async () => (await db.query<{ n: string }>(
      "select count(*)::text as n from pos_orders where hotel_id = $1", [hotelId])).rows[0]!.n;
    try {
      const before = await count();
      const refused = await newOrder({ eventId: ids["Enquiry"], send: true });
      expect(refused.res.status).toBe(409);
      expect(await count(), "a refused round opened an order").toBe(before);
    } finally {
      await db.end();
    }
  });

  it("takes an open order off its function", async () => {
    const { body: order } = await newOrder({ eventId: ids["Dinner"] });
    const res = await send("PATCH", `/5EL/till/orders/${order.id}`, { eventId: null });
    expect(res.status).toBe(200);
    expect(((await res.json()) as OrderBody).eventId).toBeNull();
  });
});

describe("paying for an order on a function — on the function's bill only", () => {
  it("refuses cash, card, UPI and a split for it, and takes nothing", async () => {
    const { body: order } = await newOrder({ eventId: ids["Dinner"] });

    /* Each on its own order would hide a success behind the next refusal;
       one order, every method, then what the database holds. */
    const answers: { method: string; status: number; reason: string }[] = [];
    for (const method of ["cash", "card", "upi"]) {
      const res = await send("POST", `/5EL/till/orders/${order.id}/settle`, { method });
      answers.push({ method, status: res.status,
                     reason: ((await res.json()) as { reason?: string }).reason ?? "" });
    }
    const split = await send("POST", `/5EL/till/orders/${order.id}/settle`, {
      tenders: [{ method: "cash", amount: 1 }, { method: "function", amount: 1 }],
    });

    const row = await orderRow(order.id);
    expect(row.status, "the order was settled anyway").toBe("open");
    expect(row.tenders, "a payment was recorded anyway").toBe("0");

    for (const a of answers) {
      expect(a.status, a.method).toBe(409);
      expect(a.reason, a.method).toContain(`on Dinner ${TAG}'s bill`);
    }
    expect(split.status).toBe(409);
  });

  it("settles it to the function, where the function's bill counts it once", async () => {
    const { body: order } = await newOrder({ eventId: ids["Lunch"] });

    const db = await admin();
    const posOnBill = async () => Number((await db.query<{ pos: string }>(
      "select pos_amount::text as pos from app.banquet_event_total($1)",
      [ids["Lunch"]])).rows[0]!.pos);
    try {
      expect(await posOnBill(), "an open order is not yet on the bill").toBe(0);

      const res = await send("POST", `/5EL/till/orders/${order.id}/settle`, { method: "function" });
      expect(res.status).toBe(200);
      const body = await res.json() as OrderBody;
      expect(body.status).toBe("settled");
      expect(body.paymentMethod).toBe("function");
      expect(body.tenders.map((t) => t.method)).toEqual(["function"]);

      expect(await posOnBill()).toBeCloseTo(body.payable, 2);
      /* Nothing reached a folio: the function's bill is banquet's sum. */
      const { rows } = await db.query<{ n: string }>(
        `select count(*)::text as n from folio_postings p
           join folios f on f.id = p.folio_id where f.event_id = $1`, [ids["Lunch"]]);
      expect(rows[0]!.n).toBe("0");
    } finally {
      await db.end();
    }
  });

  it("refuses to settle to a function an order that is not on one", async () => {
    const { body: order } = await newOrder();
    const res = await send("POST", `/5EL/till/orders/${order.id}/settle`, { method: "function" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toContain("not on a function");
    expect((await orderRow(order.id)).status).toBe("open");
  });

  it("asks the rule again at the settle — a function cancelled over dinner takes no bill", async () => {
    await func("Cancelled", `${day(0)}T06:00`, `${day(0)}T07:30`, true);
    const { body: order } = await newOrder({ eventId: ids["Cancelled"] });
    expect((await send("POST", `/5EL/banquet/events/${ids["Cancelled"]}/cancel`,
      { reason: "called off" })).status).toBe(200);

    const res = await send("POST", `/5EL/till/orders/${order.id}/settle`, { method: "function" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toContain("cancelled");
    expect((await orderRow(order.id)).status).toBe("open");
  });
});
