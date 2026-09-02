import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../src/server.ts";
import { closePool } from "../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE TILL — the POS built into the PMS

   The db suite proves the RULES: a paid bill takes no edits, a room
   settlement carries its ticket. These prove the ROUTES, and three of
   them are the reason this file exists at all:

     · a bill mixing 5% food with 18% water becomes TWO folio postings,
       because a posting carries one rate and the ledger enforces it

     · a room with two open folios is REFUSED and both guests named,
       the same answer the bridge gives on a changeover day

     · settling to a room does not write its own posting — it goes
       through pos_tickets, the same door an outside POS uses
   ══════════════════════════════════════════════════════════════════ */

let ownerStaffId: string;

const admin = async () =>
  new (await import("pg")).default.Pool({
    connectionString:
      process.env["SUPER_DATABASE_URL"] ??
      "postgres://postgres:pw@127.0.0.1:55432/fidato",
  });

beforeAll(async () => {
  const db = await admin();
  const staff = await db.query<{ id: string }>(
    "select id from staff where email = 'owner@fidato.in'",
  );
  ownerStaffId = staff.rows[0]!.id;
  await db.end();
});

afterAll(async () => {
  /* Everything this file charged to a guest folio, reversed.

     pos.test.ts learned this the hard way — ₹3,635 of test charges
     accumulated on real folios across two runs and every report that
     sums extras drifted away from the export the demo reconciles to.
     The suite was green the whole time, because nothing measured it. */
  const db = await admin();
  try {
    const { rows: mine } = await db.query<{ posting_id: string }>(
      `select t.posting_id::text
         from pos_tickets t
         join pos_orders o on o.order_no = split_part(t.ticket_ref, '/', 1)
        where o.table_ref like 'TILLTEST%' and t.posting_id is not null`,
    );

    for (const row of mine) {
      /* A reversal, not a delete. The ledger is append-only and these
         tests must not be the one thing that gets to ignore that. */
      await db.query(
        `insert into folio_postings
           (hotel_id, folio_id, business_date, category, description,
            amount, tax_rate, tax_amount, source_type, posted_by)
         select hotel_id, folio_id, business_date, category,
                'Reversal — till test', -amount, tax_rate, -tax_amount,
                'pos', posted_by
           from folio_postings where id = $1`,
        [row.posting_id],
      );
    }

    const { rows: net } = await db.query<{ net: string }>(
      `select coalesce(sum(amount),0)::text as net
         from folio_postings
        where description like '%till test%'
           or id in (select posting_id from pos_tickets t
                      join pos_orders o
                        on o.order_no = split_part(t.ticket_ref,'/',1)
                     where o.table_ref like 'TILLTEST%'
                       and t.posting_id is not null)`,
    );

    /* Asserted, not assumed. A cleanup nobody measures is a cleanup
       nobody knows failed. */
    expect(
      Number(net[0]!.net),
      "Till test charges are still live on guest folios.",
    ).toBe(0);

    /* And take the ORDERS out too.

       Defect 54 was exactly this: pos.test.ts reversed its money and
       left its outlet behind, so "Test outlet" appeared on 5EL's POS
       screen as a real one. This file then did the same thing one
       layer up — the Till screen listed eight TILLTEST orders under
       "Settled today", which is the demo showing a stranger the
       inside of its own test suite.

       `pos_order_lines_frozen` refuses to let a paid bill be deleted,
       which is right and is why it is LIFTED here rather than
       weakened — the same thing load-demo.ts does for this trigger
       and three others. Nothing in api/src may do this. */
    const { rows: mineOrders } = await db.query<{ id: string }>(
      `select id::text from pos_orders where table_ref like 'TILLTEST%'`,
    );

    if (mineOrders.length) {
      const ids = mineOrders.map((r) => r.id);

      /* The ORDER goes before its ticket, not after.

         The first attempt nulled pos_orders.ticket_id to free the
         foreign key, and the database refused:

             violates check constraint "pos_orders_room_has_ticket"

         which is the rule this schema was given on purpose — a room
         settlement that does not name the ticket carrying its folio
         posting is a bill somebody believes is on a folio and is not.
         The constraint was right and the cleanup was backwards. */
      const { rows: refs } = await db.query<{ order_no: string }>(
        `select order_no from pos_orders where id = any($1::uuid[])`, [ids],
      );

      /* Tenders too. The delete cascades into pos_order_tenders, whose
         BEFORE DELETE trigger refuses to let a settled bill's payments be
         removed — which is right, and is why it is lifted here rather
         than weakened. How money was taken is evidence. */
      await db.query(
        "alter table pos_order_tenders disable trigger " +
        "pos_order_tenders_no_delete_settled",
      );
      await db.query(
        "alter table pos_order_lines disable trigger pos_order_lines_frozen",
      );
      try {
        /* Cascades to the lines, which is why the trigger is down. */
        await db.query(
          `delete from pos_orders where id = any($1::uuid[])`, [ids],
        );
      } finally {
        await db.query(
          "alter table pos_order_lines enable trigger pos_order_lines_frozen",
        );
        await db.query(
          "alter table pos_order_tenders enable trigger " +
          "pos_order_tenders_no_delete_settled",
        );
      }

      /* Now nothing references them. The POSTINGS stay — they were
         reversed above, and the ledger is append-only. */
      for (const r of refs) {
        await db.query(
          `delete from pos_tickets where ticket_ref like $1`,
          [`${r.order_no}%`],
        );
      }
    }

    const { rows: left } = await db.query<{ n: string }>(
      `select count(*)::text as n from pos_orders
        where table_ref like 'TILLTEST%'`,
    );
    expect(
      Number(left[0]!.n),
      "Till test orders are still in the database and show on the Till screen.",
    ).toBe(0);
  } finally {
    await db.end();
  }
  await closePool();
});

const as = (path: string, init?: RequestInit) =>
  app.request(path, {
    ...init,
    headers: {
      "x-dev-staff-id": ownerStaffId,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

const post = (path: string, body?: unknown) =>
  /* The key is spread in rather than set to undefined: with
     exactOptionalPropertyTypes, `body: undefined` is not the same as
     no body at all, and RequestInit means the second one. */
  as(path, {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** Open an order tagged so afterAll can find what it charged. */
async function openOrder(label: string) {
  const res = await post("/api/hotels/5EL/till/orders", {
    outlet: "REST",
    table: `TILLTEST ${label}`,
  });
  expect(res.status, `could not open an order: ${await res.clone().text()}`)
    .toBe(200);
  return (await res.json()) as { id: string; orderNo: string };
}

async function menuItem(name: string) {
  const res = await as("/api/hotels/5EL/till/menu");
  const body = (await res.json()) as {
    categories: { items: { id: string; name: string; price: number }[] }[];
  };
  const found = body.categories
    .flatMap((c) => c.items)
    .find((i) => i.name === name);
  expect(found, `the demo menu has no "${name}"`).toBeTruthy();
  return found!;
}

describe("the menu", () => {
  it("is the hotel's, and the demo loader is what put items in it", async () => {
    const res = await as("/api/hotels/5EL/till/menu");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      categories: { name: string; items: unknown[] }[];
    };
    expect(body.categories.length).toBeGreaterThan(0);
    expect(body.categories.flatMap((c) => c.items).length).toBeGreaterThan(0);
  });

  it("carries tax per ITEM, because a real bill mixes rates", async () => {
    const water = await menuItem("Packaged Water 1L");
    const tikka = await menuItem("Paneer Tikka");
    const res = await as("/api/hotels/5EL/till/menu");
    const body = (await res.json()) as {
      categories: { items: { id: string; taxRate: number }[] }[];
    };
    const all = body.categories.flatMap((c) => c.items);
    const rate = (id: string) => all.find((i) => i.id === id)!.taxRate;

    /* Packaged water is 18% and restaurant food is 5%. If tax lived on
       the outlet instead of the item, these would be equal and every
       bill carrying both would be wrong. */
    expect(rate(water.id)).toBe(18);
    expect(rate(tikka.id)).toBe(5);
  });
});

describe("an order", () => {
  it("totals from the database, not from adding up in the browser", async () => {
    const order = await openOrder("total");
    const tikka = await menuItem("Paneer Tikka");

    const res = await post(
      `/api/hotels/5EL/till/orders/${order.id}/lines`,
      { itemId: tikka.id, qty: 2 },
    );
    const body = (await res.json()) as {
      net: number; tax: number; gross: number;
    };

    expect(body.net).toBe(640);      // 2 x 320
    expect(body.tax).toBe(32);       // 5%
    expect(body.gross).toBe(672);

    await post(`/api/hotels/5EL/till/orders/${order.id}/abandon`,
      { reason: "test" });
  });

  it("does not charge for a struck line, but keeps it", async () => {
    const order = await openOrder("void");
    const tikka = await menuItem("Paneer Tikka");

    /* The same dish twice is a quantity, not a second line.

       This test used to add 1 then 4 and reach for `lines[1]`, because
       the API inserted unconditionally: a table ordering six rotis got
       six rows reading "1x Butter Roti", on the kitchen copy and on the
       guest's bill. Every till in the trade increments instead. */
    await post(`/api/hotels/5EL/till/orders/${order.id}/lines`,
      { itemId: tikka.id, qty: 1 });
    const added = await post(`/api/hotels/5EL/till/orders/${order.id}/lines`,
      { itemId: tikka.id, qty: 4 });
    const before = (await added.json()) as {
      gross: number; lines: { id: string; qty: number }[];
    };
    expect(before.lines.length, "the same dish opened a second line").toBe(1);
    expect(before.lines[0]!.qty).toBe(5);
    expect(before.gross).toBe(1680);  // 5 x 320 + 5%

    /* A NOTE makes it a different thing. "Paneer Tikka" and "Paneer
       Tikka, no chilli" are two dishes to a kitchen and must not merge. */
    const noted = await post(`/api/hotels/5EL/till/orders/${order.id}/lines`,
      { itemId: tikka.id, qty: 1, note: "no chilli" });
    const withNote = (await noted.json()) as { lines: { note: string | null }[] };
    expect(withNote.lines.length, "a note merged into the plain line").toBe(2);
    expect(withNote.lines.some((l) => l.note === "no chilli")).toBe(true);

    const res = await post(
      `/api/hotels/5EL/till/orders/${order.id}/lines/${before.lines[0]!.id}/void`,
    );
    const after = (await res.json()) as {
      gross: number; lines: { voided: boolean }[];
    };

    expect(after.gross).toBe(336);              // only the noted one remains
    expect(after.lines.length).toBe(2);         // the struck one is still THERE
    expect(after.lines.filter((l) => l.voided).length).toBe(1);

    await post(`/api/hotels/5EL/till/orders/${order.id}/abandon`,
      { reason: "test" });
  });

  it("changes a quantity without striking and re-adding", async () => {
    const order = await openOrder("qty");
    const tikka = await menuItem("Paneer Tikka");
    const first = await post(`/api/hotels/5EL/till/orders/${order.id}/lines`,
      { itemId: tikka.id, qty: 3 });
    const body = (await first.json()) as { lines: { id: string }[] };
    const lineId = body.lines[0]!.id;

    const down = await post(
      `/api/hotels/5EL/till/orders/${order.id}/lines/${lineId}/qty`, { qty: 2 });
    const two = (await down.json()) as { gross: number; lines: { qty: number }[] };
    expect(two.lines[0]!.qty).toBe(2);
    expect(two.gross).toBe(672);   // 2 x 320 + 5%

    /* Zero is a strike, not a delete. A waiter counting down to none
       means the same as pressing the cross, and 028 keeps struck lines
       either way — a manager settling a dispute wants to see them. */
    const zero = await post(
      `/api/hotels/5EL/till/orders/${order.id}/lines/${lineId}/qty`, { qty: 0 });
    const none = (await zero.json()) as {
      gross: number; lines: { voided: boolean }[];
    };
    expect(none.gross).toBe(0);
    expect(none.lines.length, "the struck line was deleted").toBe(1);
    expect(none.lines[0]!.voided).toBe(true);

    const bad = await post(
      `/api/hotels/5EL/till/orders/${order.id}/lines/${lineId}/qty`, { qty: -1 });
    expect(bad.status).toBe(409);

    await post(`/api/hotels/5EL/till/orders/${order.id}/abandon`,
      { reason: "test" });
  });

  it("refuses to settle an empty bill", async () => {
    const order = await openOrder("empty");
    const res = await post(`/api/hotels/5EL/till/orders/${order.id}/settle`,
      { method: "cash" });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toMatch(/nothing on this order/i);

    await post(`/api/hotels/5EL/till/orders/${order.id}/abandon`,
      { reason: "test" });
  });

  it("says why it was closed unpaid, or refuses to close", async () => {
    const order = await openOrder("abandon");
    const bare = await post(`/api/hotels/5EL/till/orders/${order.id}/abandon`);
    expect(bare.status).toBe(409);

    const named = await post(`/api/hotels/5EL/till/orders/${order.id}/abandon`,
      { reason: "Guest walked out" });
    expect(named.status).toBe(200);
  });

  it("takes nothing more once it is paid", async () => {
    const order = await openOrder("frozen");
    const tikka = await menuItem("Paneer Tikka");
    await post(`/api/hotels/5EL/till/orders/${order.id}/lines`,
      { itemId: tikka.id, qty: 1 });
    await post(`/api/hotels/5EL/till/orders/${order.id}/settle`,
      { method: "cash" });

    const res = await post(`/api/hotels/5EL/till/orders/${order.id}/lines`,
      { itemId: tikka.id, qty: 1 });

    /* Refused by the API with a reason a waiter can act on. The trigger
       underneath would have refused it too — this is Rule 6, not the
       guarantee. */
    expect(res.status).toBe(409);
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toMatch(/paid|settled/i);
  });
});

describe("settling to a room", () => {
  it("refuses a room with two open folios and names both guests", async () => {
    /* 25 August on the demo property is a changeover day in 201:
       Rekha Gaikwad due out, Tanvi Bhide arrived, both checked in with
       open folios. The PMS cannot know which of them ate. */
    const order = await openOrder("changeover");
    const tikka = await menuItem("Paneer Tikka");
    await post(`/api/hotels/5EL/till/orders/${order.id}/lines`,
      { itemId: tikka.id, qty: 1 });

    const res = await post(`/api/hotels/5EL/till/orders/${order.id}/settle`,
      { method: "room", room: "201" });

    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      reason: string; choices: { folioId: string; guest: string }[];
    };
    expect(body.reason).toMatch(/changeover|open folios/i);
    expect(body.choices.length).toBe(2);

    /* Naming them is the point. A refusal that does not say who to pick
       leaves the waiter exactly where they started. */
    expect(body.choices.map((c) => c.guest).join(" ")).toMatch(/\w+/);

    await post(`/api/hotels/5EL/till/orders/${order.id}/abandon`,
      { reason: "test" });
  });

  it("splits a mixed-rate bill into one posting per rate", async () => {
    const order = await openOrder("mixed");
    const tikka = await menuItem("Paneer Tikka");        // 320 @ 5%
    const water = await menuItem("Packaged Water 1L");   //  40 @ 18%

    await post(`/api/hotels/5EL/till/orders/${order.id}/lines`,
      { itemId: tikka.id, qty: 2 });
    await post(`/api/hotels/5EL/till/orders/${order.id}/lines`,
      { itemId: water.id, qty: 1 });

    const rooms = (await (await as("/api/hotels/5EL/till/rooms")).json()) as {
      rooms: { room: string; folioId: string }[];
    };
    const target = rooms.rooms[0]!;

    const res = await post(`/api/hotels/5EL/till/orders/${order.id}/settle`,
      { method: "room", room: target.room, folioId: target.folioId });

    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { gross: number; status: string };
    expect(body.status).toBe("settled");
    expect(body.gross).toBe(719.2);   // 640 + 32 + 40 + 7.20

    /* THE ASSERTION THIS FILE EXISTS FOR.

       `fp_tax_consistent` requires tax_amount = round(amount * rate /
       100, 2) within a paisa, and a posting carries ONE rate. The first
       version of settle posted a single row with rate 0 and the tax in
       tax_amount; the database rejected it outright. A blended rate
       does not work either — 680 at an effective 5.76% computes to
       39.17 against an actual 39.20.

       GST agrees with the constraint: two rates are two supplies. */
    const db = await admin();
    try {
      const { rows } = await db.query<{
        tax_rate: string; amount: string; tax_amount: string;
      }>(
        `select p.tax_rate::text, p.amount::text, p.tax_amount::text
           from folio_postings p
           join pos_tickets t on t.posting_id = p.id
          where t.ticket_ref like $1
          order by p.tax_rate`,
        [`${order.orderNo}%`],
      );

      expect(rows.length, "a mixed-rate bill must not be one posting").toBe(2);
      expect(rows.map((r) => Number(r.tax_rate))).toEqual([5, 18]);
      expect(Number(rows[0]!.amount)).toBe(640);
      expect(Number(rows[0]!.tax_amount)).toBe(32);
      expect(Number(rows[1]!.amount)).toBe(40);
      expect(Number(rows[1]!.tax_amount)).toBe(7.2);
    } finally {
      await db.end();
    }
  });

  it("reaches the folio through pos_tickets, not around it", async () => {
    const order = await openOrder("bridge");
    const tikka = await menuItem("Paneer Tikka");
    await post(`/api/hotels/5EL/till/orders/${order.id}/lines`,
      { itemId: tikka.id, qty: 1 });

    const rooms = (await (await as("/api/hotels/5EL/till/rooms")).json()) as {
      rooms: { room: string; folioId: string }[];
    };
    const target = rooms.rooms[0]!;
    await post(`/api/hotels/5EL/till/orders/${order.id}/settle`,
      { method: "room", room: target.room, folioId: target.folioId });

    const db = await admin();
    try {
      /* The in-house till gets NO privileged path to the ledger. Every
         posting it causes is named by a pos_tickets row, exactly as an
         outside POS's would be — which is why the idempotency and the
         refusal handling did not have to be written twice. */
      const { rows } = await db.query<{ n: string }>(
        `select count(*)::text as n
           from folio_postings p
          where p.source_type = 'pos'
            and p.description like $1
            and not exists (
              select 1 from pos_tickets t where t.posting_id = p.id)`,
        [`%${order.orderNo}%`],
      );
      expect(
        Number(rows[0]!.n),
        "a till posting reached a folio without a ticket naming it",
      ).toBe(0);
    } finally {
      await db.end();
    }
  });

  it("refuses a room nobody is checked into", async () => {
    const order = await openOrder("empty room");
    const tikka = await menuItem("Paneer Tikka");
    await post(`/api/hotels/5EL/till/orders/${order.id}/lines`,
      { itemId: tikka.id, qty: 1 });

    const res = await post(`/api/hotels/5EL/till/orders/${order.id}/settle`,
      { method: "room", room: "999" });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toMatch(/nobody is checked in|cannot be charged/i);

    await post(`/api/hotels/5EL/till/orders/${order.id}/abandon`,
      { reason: "test" });
  });
});

describe("cash", () => {
  it("never touches a folio", async () => {
    const order = await openOrder("cash");
    const tikka = await menuItem("Paneer Tikka");
    await post(`/api/hotels/5EL/till/orders/${order.id}/lines`,
      { itemId: tikka.id, qty: 1 });

    const res = await post(`/api/hotels/5EL/till/orders/${order.id}/settle`,
      { method: "cash" });
    expect(res.status).toBe(200);

    const db = await admin();
    try {
      /* A walk-in diner paying cash has no folio, and inventing one to
         hold the charge would put a guest on a room they never had.
         pos_tickets stays what its comment says: bills that reached a
         guest folio. */
      const { rows } = await db.query<{ n: string }>(
        `select count(*)::text as n from pos_tickets
          where ticket_ref like $1`,
        [`${order.orderNo}%`],
      );
      expect(Number(rows[0]!.n)).toBe(0);
    } finally {
      await db.end();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════
   DISCOUNT, ROUND OFF AND SPLIT TENDER

   The db suite proves the arithmetic. These prove the ROUTES, and one
   of them is the reason this block exists: a DISCOUNTED bill charged
   to a room must post the DISCOUNTED amount. The settle path used to
   compute its own per-rate split from the lines, which was correct
   until discounts existed — the guest would hold a discounted bill and
   the folio would receive the full amount, days before anyone noticed.
   ══════════════════════════════════════════════════════════════════ */

type Order = {
  id: string; orderNo: string;
  net: number; discount: number; taxable: number; tax: number;
  gross: number; roundOff: number; payable: number;
  discountType: string | null; discountValue: number | null;
  discountReason: string | null;
  tenders: { method: string; amount: number; change: number | null }[];
};

async function orderWithTwoRates(label: string) {
  const order = await openOrder(label);
  const food = await menuItem("Paneer Tikka");
  const water = await menuItem("Packaged Water 1L");
  await post(`/api/hotels/5EL/till/orders/${order.id}/lines`,
    { itemId: food.id, qty: 1 });
  await post(`/api/hotels/5EL/till/orders/${order.id}/lines`,
    { itemId: water.id, qty: 1 });
  return order;
}

describe("a discount has to say why", () => {
  it("refuses an amount with no reason", async () => {
    const order = await orderWithTwoRates("no-reason");
    const res = await post(`/api/hotels/5EL/till/orders/${order.id}/discount`,
      { type: "fixed", value: 50 });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/why/i);
  });

  it("refuses more than 100 percent", async () => {
    const order = await orderWithTwoRates("over-100");
    const res = await post(`/api/hotels/5EL/till/orders/${order.id}/discount`,
      { type: "percent", value: 120, reason: "generous" });
    expect(res.status).toBe(409);
  });

  it("stores what was entered, not only what it came to", async () => {
    const order = await orderWithTwoRates("percent");
    const res = await post(`/api/hotels/5EL/till/orders/${order.id}/discount`,
      { type: "percent", value: 10, reason: "manager comp" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Order;

    /* 10% is the record. Recomputing it from the amount later fails the
       moment a line is added or struck. */
    expect(body.discountType).toBe("percent");
    expect(body.discountValue).toBe(10);
    expect(body.discountReason).toBe("manager comp");
    expect(body.discount).toBeCloseTo(Math.round(body.net * 10) / 100, 2);
  });

  it("takes the discount off the NET, so tax falls with it", async () => {
    const order = await orderWithTwoRates("tax-falls");
    const before = (await (await as(
      `/api/hotels/5EL/till/orders/${order.id}`)).json()) as Order;

    const after = (await (await post(
      `/api/hotels/5EL/till/orders/${order.id}/discount`,
      { type: "fixed", value: 100, reason: "complaint" })).json()) as Order;

    expect(after.taxable).toBeCloseTo(after.net - 100, 2);
    /* Off the gross instead, tax would not move at all. That is the bug
       this assertion exists to catch. */
    expect(after.tax).toBeLessThan(before.tax);
    expect(after.gross).toBeCloseTo(after.taxable + after.tax, 2);
  });
});

describe("round off", () => {
  it("brings the payable to a whole rupee, and stays under one", async () => {
    const order = await orderWithTwoRates("round");
    const res = await post(
      `/api/hotels/5EL/till/orders/${order.id}/round-off`, { apply: true });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Order;

    expect(Math.abs(body.roundOff)).toBeLessThan(1);
    expect(body.payable).toBeCloseTo(Math.round(body.gross), 2);
    expect(body.payable).toBeCloseTo(body.gross + body.roundOff, 2);
  });

  it("applied twice does not compound", async () => {
    const order = await orderWithTwoRates("round-twice");
    await post(`/api/hotels/5EL/till/orders/${order.id}/round-off`,
      { apply: true });
    const twice = (await (await post(
      `/api/hotels/5EL/till/orders/${order.id}/round-off`,
      { apply: true })).json()) as Order;

    expect(Math.abs(twice.roundOff)).toBeLessThan(1);
    expect(twice.payable).toBeCloseTo(Math.round(twice.gross), 2);
  });
});

describe("split tender", () => {
  it("refuses payments that do not add up to the bill", async () => {
    const order = await orderWithTwoRates("short");
    const now = (await (await as(
      `/api/hotels/5EL/till/orders/${order.id}`)).json()) as Order;

    const res = await post(`/api/hotels/5EL/till/orders/${order.id}/settle`, {
      tenders: [{ method: "cash", amount: Number((now.payable - 10).toFixed(2)) }],
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/come to/i);
  });

  it("takes part cash and part card, and derives the change", async () => {
    const order = await orderWithTwoRates("split");
    const now = (await (await as(
      `/api/hotels/5EL/till/orders/${order.id}`)).json()) as Order;

    const cash = 100;
    const card = Number((now.payable - cash).toFixed(2));
    const res = await post(`/api/hotels/5EL/till/orders/${order.id}/settle`, {
      tenders: [
        { method: "cash", amount: cash, tendered: 500 },
        { method: "card", amount: card, reference: "4242" },
      ],
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as Order & { paymentMethod: string };

    expect(body.paymentMethod).toBe("split");
    expect(body.tenders).toHaveLength(2);
    /* Change is derived, never stored: a stored figure is one more thing
       that can disagree with the arithmetic. */
    expect(body.tenders.find((t) => t.method === "cash")!.change).toBe(400);
    expect(body.tenders.find((t) => t.method === "card")!.change).toBeNull();
  });

  it("refuses a room mixed with anything else", async () => {
    const order = await orderWithTwoRates("room-mix");
    const now = (await (await as(
      `/api/hotels/5EL/till/orders/${order.id}`)).json()) as Order;

    const res = await post(`/api/hotels/5EL/till/orders/${order.id}/settle`, {
      tenders: [
        { method: "room", amount: Number((now.payable - 50).toFixed(2)) },
        { method: "cash", amount: 50 },
      ],
    });
    expect(res.status).toBe(409);
    /* Not a limitation being apologised for. There is no defensible way
       to choose which tax rate a partial room payment settles. */
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/in full/i);
  });

  it("records one tender even for an ordinary single-method bill", async () => {
    const order = await orderWithTwoRates("single");
    const res = await post(`/api/hotels/5EL/till/orders/${order.id}/settle`,
      { method: "cash" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Order;

    /* Uniform on purpose: the drawer reconciles the same way whether the
       biller used Cash or the Part button. */
    expect(body.tenders).toHaveLength(1);
    expect(body.tenders[0]!.method).toBe("cash");
    expect(body.tenders[0]!.amount).toBeCloseTo(body.payable, 2);
  });
});

describe("a discounted bill charged to a room", () => {
  it("posts the DISCOUNTED amount to the folio, not the full one", async () => {
    const order = await orderWithTwoRates("room-discount");
    await post(`/api/hotels/5EL/till/orders/${order.id}/discount`,
      { type: "fixed", value: 100, reason: "manager comp" });

    const now = (await (await as(
      `/api/hotels/5EL/till/orders/${order.id}`)).json()) as Order;

    const rooms = (await (await as("/api/hotels/5EL/till/rooms")).json()) as {
      rooms: { room: string }[];
    };
    const room = rooms.rooms[0];
    expect(room, "the demo has no chargeable room").toBeTruthy();

    /* A changeover day leaves two folios open on one room, and the bridge
       refuses rather than charging whichever the database returned first.
       The till answers by naming the guest — so the test does what the
       screen does, instead of picking a room that happens to be simple. */
    let res = await post(`/api/hotels/5EL/till/orders/${order.id}/settle`,
      { method: "room", room: room!.room });

    if (res.status === 409) {
      const asked = (await res.clone().json()) as {
        choices?: { folioId: string }[];
      };
      expect(asked.choices, await res.clone().text()).toBeTruthy();
      res = await post(`/api/hotels/5EL/till/orders/${order.id}/settle`, {
        method: "room", room: room!.room,
        folioId: asked.choices![0]!.folioId,
      });
    }
    expect(res.status, await res.clone().text()).toBe(200);

    const db = await admin();
    try {
      const { rows } = await db.query<{ total: string }>(
        `select coalesce(sum(fp.amount + fp.tax_amount), 0)::text as total
           from folio_postings fp
           join pos_tickets t on t.posting_id = fp.id
          where t.ticket_ref like $1`,
        [`${order.orderNo}%`],
      );

      /* The whole point. Before app.pos_order_by_rate existed, this
         posted `net + tax` computed from the raw lines and came to the
         UNDISCOUNTED total — a folio that does not match the bill in
         the guest's hand. */
      expect(Number(rows[0]!.total)).toBeCloseTo(now.gross, 2);
      expect(Number(rows[0]!.total)).toBeLessThan(now.net + now.tax);
    } finally {
      await db.end();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════
   VARIATIONS AND ADD-ONS, THROUGH THE ROUTES

   The db suite proves the rules. These prove the till cannot get a
   price wrong, and the dangerous case is the quiet one: a dish GAINS
   variations, and a till that still rings the item charges
   `pos_menu_items.price` — a number nobody has looked at since, and
   one that is on no menu.
   ══════════════════════════════════════════════════════════════════ */

describe("a dish sold by variation", () => {
  let dishId: string;
  let oilId: string;
  let butterId: string;
  let onionId: string;
  let groupId: string;

  beforeAll(async () => {
    const db = await admin();
    try {
      const { rows: h } = await db.query<{ id: string }>(
        `select id from hotels where code = '5EL'`);
      const { rows: cat } = await db.query<{ id: string }>(
        `select id from pos_menu_categories where hotel_id = $1 limit 1`,
        [h[0]!.id]);

      const { rows: i } = await db.query<{ id: string }>(
        `insert into pos_menu_items
           (hotel_id, category_id, name, price, tax_rate, short_code, is_veg)
         values ($1,$2,'VARTEST Bhaaji Pau',300,5,'VTBP',true)
         returning id::text`,
        [h[0]!.id, cat[0]!.id]);
      dishId = i[0]!.id;

      const { rows: v } = await db.query<{ id: string; label: string }>(
        `insert into pos_item_variations (hotel_id, item_id, label, price)
         values ($1,$2,'Oil',300),($1,$2,'Butter',400)
         returning id::text, label`, [h[0]!.id, dishId]);
      oilId = v.find((r) => r.label === "Oil")!.id;
      butterId = v.find((r) => r.label === "Butter")!.id;

      const { rows: g } = await db.query<{ id: string }>(
        `insert into pos_addon_groups (hotel_id, label, min_select, max_select)
         values ($1,'VARTEST Sides',0,4) returning id::text`, [h[0]!.id]);
      groupId = g[0]!.id;

      const { rows: a } = await db.query<{ id: string }>(
        `insert into pos_addons (hotel_id, group_id, label, price)
         values ($1,$2,'Onions',25) returning id::text`, [h[0]!.id, groupId]);
      onionId = a[0]!.id;

      await db.query(
        `insert into pos_item_addon_groups (item_id, group_id) values ($1,$2)`,
        [dishId, groupId]);
    } finally {
      await db.end();
    }
  });

  afterAll(async () => {
    const db = await admin();
    try {
      /* THE LINES GO FIRST. A describe-level afterAll runs BEFORE the
         file-level one, so the orders these lines belong to are still
         there — and pos_order_lines.addon_id references what this is
         about to delete. The foreign key is right and the order was
         backwards.

         The frozen trigger is lifted rather than weakened, the same way
         this file's own teardown does it. */
      await db.query(
        "alter table pos_order_lines disable trigger pos_order_lines_frozen");
      try {
        await db.query(
          `delete from pos_order_lines
            where item_id = $1
               or variation_id in (select id from pos_item_variations
                                    where item_id = $1)
               or addon_id in (select id from pos_addons where group_id = $2)`,
          [dishId, groupId]);
      } finally {
        await db.query(
          "alter table pos_order_lines enable trigger pos_order_lines_frozen");
      }

      await db.query(`delete from pos_item_addon_groups where group_id = $1`, [groupId]);
      await db.query(`delete from pos_addons where group_id = $1`, [groupId]);
      await db.query(`delete from pos_addon_groups where id = $1`, [groupId]);
      await db.query(`delete from pos_item_variations where item_id = $1`, [dishId]);
      await db.query(`delete from pos_menu_items where id = $1`, [dishId]);
    } finally {
      await db.end();
    }
  });

  it("carries its variations and sides on the menu", async () => {
    const res = await as("/api/hotels/5EL/till/menu");
    const body = (await res.json()) as {
      categories: {
        items: {
          name: string; shortCode: string | null; isVeg: boolean | null;
          variations: { label: string; price: number }[];
          addonGroups: { label: string; addons: { label: string; price: number }[] }[];
        }[];
      }[];
    };
    const dish = body.categories.flatMap((c) => c.items)
      .find((i) => i.name === "VARTEST Bhaaji Pau")!;

    expect(dish.variations.map((v) => v.label).sort()).toEqual(["Butter", "Oil"]);
    expect(dish.addonGroups[0]!.addons[0]!.label).toBe("Onions");
    expect(dish.shortCode).toBe("VTBP");
    expect(dish.isVeg).toBe(true);
  });

  it("refuses to be rung without choosing one", async () => {
    const order = await openOrder("var-none");
    const res = await post(`/api/hotels/5EL/till/orders/${order.id}/lines`,
      { itemId: dishId, qty: 1 });
    expect(res.status).toBe(409);
    /* Named before the constraint gets to it, or the waiter sees a
       database error for something they could have fixed. */
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/sold by variation/i);
  });

  it("prices from the VARIATION, not the item", async () => {
    const order = await openOrder("var-price");
    const res = await post(`/api/hotels/5EL/till/orders/${order.id}/lines`,
      { itemId: dishId, qty: 1, variationId: butterId });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as {
      lines: { name: string; unitPrice: number }[];
    };

    /* 400, not the item's 300. */
    expect(body.lines[0]!.unitPrice).toBe(400);
    expect(body.lines[0]!.name).toBe("VARTEST Bhaaji Pau (Butter)");
  });

  it("adds the sides as child lines under the dish", async () => {
    const order = await openOrder("var-addons");
    const res = await post(`/api/hotels/5EL/till/orders/${order.id}/lines`,
      { itemId: dishId, qty: 1, variationId: oilId, addonIds: [onionId] });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as {
      lines: { id: string; name: string; isAddon: boolean;
               parentLineId: string | null }[];
      gross: number;
    };

    const dish = body.lines.find((l) => !l.isAddon)!;
    const side = body.lines.find((l) => l.isAddon)!;
    expect(side.parentLineId).toBe(dish.id);
    expect(side.name).toBe("VARTEST Sides: Onions");

    /* An add-on is a LINE, so the total already has it: 300 + 25 at 5%. */
    expect(body.gross).toBeCloseTo(Math.round((300 + 25) * 1.05 * 100) / 100, 2);
  });

  it("strikes the sides when the dish is struck", async () => {
    const order = await openOrder("var-void");
    const made = (await (await post(
      `/api/hotels/5EL/till/orders/${order.id}/lines`,
      { itemId: dishId, qty: 1, variationId: oilId, addonIds: [onionId] })).json()) as {
      lines: { id: string; isAddon: boolean }[];
    };
    const dish = made.lines.find((l) => !l.isAddon)!;

    const res = await post(
      `/api/hotels/5EL/till/orders/${order.id}/lines/${dish.id}/void`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      lines: { isAddon: boolean; voided: boolean }[]; gross: number;
    };

    /* Otherwise the onions survive the dish: 25 rupees for a side to
       something that was struck, on the bill under nothing. */
    expect(body.lines.filter((l) => l.isAddon).every((l) => l.voided)).toBe(true);
    expect(body.gross).toBe(0);
  });

  it("refuses a side the dish does not offer", async () => {
    const order = await openOrder("var-wrong-side");
    const db = await admin();
    let stray: string;
    try {
      const { rows: h } = await db.query<{ id: string }>(
        `select id from hotels where code = '5EL'`);
      const { rows: g } = await db.query<{ id: string }>(
        `insert into pos_addon_groups (hotel_id, label) values ($1,'VARTEST Other')
         returning id::text`, [h[0]!.id]);
      const { rows: a } = await db.query<{ id: string }>(
        `insert into pos_addons (hotel_id, group_id, label, price)
         values ($1,$2,'Pickle',10) returning id::text`, [h[0]!.id, g[0]!.id]);
      stray = a[0]!.id;
    } finally {
      await db.end();
    }

    const res = await post(`/api/hotels/5EL/till/orders/${order.id}/lines`,
      { itemId: dishId, qty: 1, variationId: oilId, addonIds: [stray] });
    expect(res.status).toBe(409);
    /* Named, not silently dropped. A side the guest asked for that never
       reaches the kitchen is a complaint at the table. */
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/not offered with this dish/i);

    const clean = await admin();
    try {
      await clean.query(`delete from pos_addons where label = 'Pickle'`);
      await clean.query(`delete from pos_addon_groups where label = 'VARTEST Other'`);
    } finally {
      await clean.end();
    }
  });
});
