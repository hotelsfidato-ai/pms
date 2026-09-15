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

    /* ⚠ WITHIN THE CAP, DERIVED FROM THE BILL. This was a flat 100 and
       started failing the day 083 capped a biller at 10% — not because
       anything here was wrong, but because a constant chosen when the
       demo bill happened to be large enough is a constant that expires.
       This test is about tax following the discount; it has no opinion
       about the size. */
    const off = Math.floor(before.net * 0.09);
    expect(off, "the demo bill is too small to discount").toBeGreaterThan(0);

    const after = (await (await post(
      `/api/hotels/5EL/till/orders/${order.id}/discount`,
      { type: "fixed", value: off, reason: "complaint" })).json()) as Order;

    expect(after.taxable).toBeCloseTo(after.net - off, 2);
    /* Off the gross instead, tax would not move at all. That is the bug
       this assertion exists to catch. */
    expect(after.tax).toBeLessThan(before.tax);
    expect(after.gross).toBeCloseTo(after.taxable + after.tax, 2);
  });
});

/* ══════════════════════════════════════════════════════════════════
   THE CAP, AND THE PROMOTIONS BEYOND IT

   The owner's design, given on 9 September when asked what threshold
   should send a discount for approval: a biller has a free hand up to
   10% and everything larger is a NAMED promotion applied by code.

   An approval queue asks somebody to decide the same question again
   every night. "The owner's guests eat at 50%" is not a decision, it
   is a policy — decided once, named, and counted at month end.
   ══════════════════════════════════════════════════════════════════ */
describe("the free-hand cap", () => {
  it("refuses a percentage above the cap, and names the money", async () => {
    const order = await orderWithTwoRates("cap-percent");
    const res = await post(`/api/hotels/5EL/till/orders/${order.id}/discount`,
      { type: "percent", value: 50, reason: "a large one" });
    expect(res.status).toBe(409);
    const reason = ((await res.json()) as { reason: string }).reason;
    expect(reason).toMatch(/up to 10%/);
    /* The rupees, not only the percentage. A biller reads the amount. */
    expect(reason).toMatch(/₹/);
    expect(reason).toMatch(/promotion/i);
  });

  it("refuses a FIXED amount that walks around the cap", async () => {
    /* ⚠ THE ASSERTION THAT MATTERS. Checking the percentage would leave
       the whole cap open: 5,000 off a 6,000 bill is 83% however it was
       typed, and a biller who found that out once would never use the
       percent button again. The check is on the money. */
    const order = await orderWithTwoRates("cap-fixed");
    const before = (await (await as(
      `/api/hotels/5EL/till/orders/${order.id}`)).json()) as Order;

    const res = await post(`/api/hotels/5EL/till/orders/${order.id}/discount`,
      { type: "fixed", value: Math.ceil(before.net * 0.9),
        reason: "a large one" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/up to 10%/);
  });

  it("allows a discount at the cap exactly", async () => {
    const order = await orderWithTwoRates("cap-exact");
    const res = await post(`/api/hotels/5EL/till/orders/${order.id}/discount`,
      { type: "percent", value: 10, reason: "complaint" });
    expect(res.status, await res.clone().text()).toBe(200);
  });
});

describe("promotions", () => {
  let promoId: string;

  const patch = (id: string, body: unknown) =>
    app.request(`/api/hotels/5EL/till/promotions/${id}`, {
      method: "PATCH",
      headers: {
        "x-dev-staff-id": ownerStaffId,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    const res = await post("/api/hotels/5EL/till/promotions",
      { code: "TILLOWN", name: "TILLTEST house guests",
        kind: "percent", value: 50 });
    expect(res.status, await res.clone().text()).toBe(200);
    promoId = ((await res.json()) as { id: string }).id;
  });

  afterAll(async () => {
    const db = await admin();
    try {
      await db.query(
        `update pos_orders set promotion_id = null
          where promotion_id in (select id from pos_promotions
                                  where code like 'TILL%')`);
      await db.query("delete from pos_promotions where code like 'TILL%'");
    } finally { await db.end(); }
  });

  it("sends the cap alongside the list", async () => {
    /* The discount dialog has to say "up to 10% — 247 on this bill"
       before a biller types anything. The alternative to sending the
       cap here is a second copy of 10 in the browser. */
    const res = await as("/api/hotels/5EL/till/promotions");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      freehandCapPercent: number;
      promotions: { code: string; name: string; value: number }[];
    };
    expect(body.freehandCapPercent).toBe(10);
    expect(body.promotions.some((x) => x.code === "TILLOWN")).toBe(true);
  });

  it("goes past the cap, because it was decided in advance", async () => {
    const order = await orderWithTwoRates("promo-applies");
    const res = await post(`/api/hotels/5EL/till/orders/${order.id}/promotion`,
      { code: "TILLOWN" });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as Order & {
      promotionId: string | null; promotionName: string | null;
    };

    expect(body.discountValue).toBe(50);
    expect(body.discount).toBeCloseTo(Math.round(body.net * 50) / 100, 2);
    /* WHICH promotion, so month end is a group-by rather than a search
       through text nobody spelled the same way twice. */
    expect(body.promotionId).toBe(promoId);
    expect(body.promotionName).toBe("TILLTEST house guests");
    /* And the bill carries the promotion's own words, not the biller's. */
    expect(body.discountReason).toBe("TILLTEST house guests");
  });

  it("is found however the biller capitalised it", async () => {
    const order = await orderWithTwoRates("promo-case");
    const res = await post(`/api/hotels/5EL/till/orders/${order.id}/promotion`,
      { code: " tillown " });
    expect(res.status, await res.clone().text()).toBe(200);
  });

  it("refuses a code nobody set up", async () => {
    const order = await orderWithTwoRates("promo-missing");
    const res = await post(`/api/hotels/5EL/till/orders/${order.id}/promotion`,
      { code: "NOSUCH" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/no promotion with the code NOSUCH/i);
  });

  it("refuses one that has been switched off, by name", async () => {
    const off = await patch(promoId, { isActive: false });
    expect(off.status, await off.clone().text()).toBe(200);

    const order = await orderWithTwoRates("promo-off");
    const res = await post(`/api/hotels/5EL/till/orders/${order.id}/promotion`,
      { code: "TILLOWN" });
    expect(res.status).toBe(409);
    /* The NAME, not the code. A biller told "TILLOWN is not running"
       has to go and look up what TILLOWN was. */
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/house guests is not running/i);

    expect((await patch(promoId, { isActive: true })).status).toBe(200);
  });

  it("a free-hand discount afterwards clears the promotion", async () => {
    /* ⚠ OTHERWISE THE REPORT KEEPS COUNTING IT. A bill that was 50% for
       house guests and is now 5% off for a complaint is not a house
       guest concession any more. */
    const order = await orderWithTwoRates("promo-then-freehand");
    await post(`/api/hotels/5EL/till/orders/${order.id}/promotion`,
      { code: "TILLOWN" });
    const res = await post(`/api/hotels/5EL/till/orders/${order.id}/discount`,
      { type: "percent", value: 5, reason: "complaint" });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as { promotionId: string | null }).promotionId)
      .toBeNull();
  });

  it("clearing the discount clears the promotion too", async () => {
    const order = await orderWithTwoRates("promo-cleared");
    await post(`/api/hotels/5EL/till/orders/${order.id}/promotion`,
      { code: "TILLOWN" });
    const res = await post(
      `/api/hotels/5EL/till/orders/${order.id}/discount/clear`);
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as Order & { promotionId: string | null };
    expect(body.promotionId).toBeNull();
    expect(body.discount).toBe(0);
  });

  it("refuses a promotion bigger than the bill", async () => {
    const big = await post("/api/hotels/5EL/till/promotions",
      { code: "TILLBIG", name: "TILLTEST enormous",
        kind: "fixed", value: 999999 });
    expect(big.status, await big.clone().text()).toBe(200);

    const order = await orderWithTwoRates("promo-too-big");
    const res = await post(`/api/hotels/5EL/till/orders/${order.id}/promotion`,
      { code: "TILLBIG" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/more than this bill/i);
  });

  it("refuses a second promotion on one code", async () => {
    const res = await post("/api/hotels/5EL/till/promotions",
      { code: "tillown", name: "TILLTEST another", kind: "fixed", value: 10 });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/already in use/i);
  });

  it("refuses a promotion worth nothing", async () => {
    const res = await post("/api/hotels/5EL/till/promotions",
      { code: "TILLZERO", name: "TILLTEST nothing",
        kind: "percent", value: 0 });
    expect(res.status).toBe(409);
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
    /* A percentage rather than a flat 100, which is over the 10% cap
       083 introduced. What is being proved is that the folio gets the
       discounted figure, not what the discount was. */
    await post(`/api/hotels/5EL/till/orders/${order.id}/discount`,
      { type: "percent", value: 10, reason: "manager comp" });

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

/* ══════════════════════════════════════════════════════════════════
   OFF, AND BACK ON

   "We are out of paneer" is the most-used menu action in a live
   kitchen, and it has to take three seconds — a waiter is already at a
   table asking for it.

   A DURATION, not a switch. Off with no end is a dish that stays off
   for a week because the person who took it off went home, and nobody
   can say since when.
   ══════════════════════════════════════════════════════════════════ */

describe("taking a dish off the menu", () => {
  let itemId: string;
  let itemName: string;

  beforeAll(async () => {
    const db = await admin();
    try {
      const { rows } = await db.query<{ id: string; name: string }>(
        `select i.id::text, i.name from pos_menu_items i
           join hotels h on h.id = i.hotel_id
          where h.code = '5EL' and i.name = 'Paneer Tikka'`);
      itemId = rows[0]!.id;
      itemName = rows[0]!.name;
    } finally {
      await db.end();
    }
  });

  afterAll(async () => {
    const db = await admin();
    try {
      await db.query(
        `update pos_menu_items set off_until = null, off_reason = null
          where id = $1`, [itemId]);
      await db.query(`update pos_outlets set closed_until = null,
                             closed_reason = null`);
    } finally {
      await db.end();
    }
  });

  it("refuses an off with no duration", async () => {
    const res = await post(`/api/hotels/5EL/till/menu/items/${itemId}/off`,
      { reason: "out of paneer" });
    expect(res.status).toBe(409);
    /* Off with no end is the failure this feature exists to prevent. */
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/how long/i);
  });

  it("takes it off for four hours, and says when it is back", async () => {
    const res = await post(`/api/hotels/5EL/till/menu/items/${itemId}/off`,
      { until: "4h", reason: "out of paneer" });
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { offUntil: string };

    const hours = (Date.parse(body.offUntil) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(3.9);
    expect(hours).toBeLessThan(4.1);
  });

  it("refuses to be rung, and tells the table when it returns", async () => {
    const order = await openOrder("off-dish");
    const res = await post(`/api/hotels/5EL/till/orders/${order.id}/lines`,
      { itemId, qty: 1 });
    expect(res.status).toBe(409);

    const reason = ((await res.json()) as { reason: string }).reason;
    /* A refusal with no time sends the waiter to find somebody to ask. */
    expect(reason).toMatch(/out of paneer/i);
    expect(reason).toMatch(/back after/i);
  });

  it("comes back on, and the timestamp is CLEARED not backdated", async () => {
    const res = await post(`/api/hotels/5EL/till/menu/items/${itemId}/on`);
    expect(res.status).toBe(200);

    const db = await admin();
    try {
      const { rows } = await db.query<{ off_until: string | null }>(
        `select off_until::text from pos_menu_items where id = $1`, [itemId]);
      /* A past timestamp reads as "it was off until then" — a fact
         nobody needs, and one that makes the five states on the screen
         ambiguous. */
      expect(rows[0]!.off_until).toBeNull();
    } finally {
      await db.end();
    }

    const order = await openOrder("back-on");
    const add = await post(`/api/hotels/5EL/till/orders/${order.id}/lines`,
      { itemId, qty: 1 });
    expect(add.status, `${itemName} did not come back`).toBe(200);
  });

  it("a custom time in the past is not a duration", async () => {
    const res = await post(`/api/hotels/5EL/till/menu/items/${itemId}/off`,
      { until: "custom", customUntil: "2020-01-01T00:00:00Z" });
    expect(res.status).toBe(409);
  });
});

describe("closing the store", () => {
  afterAll(async () => {
    const db = await admin();
    try {
      await db.query(
        `update pos_outlets set closed_until = null, closed_reason = null`);
    } finally {
      await db.end();
    }
  });

  it("refuses a new order, and says when it reopens", async () => {
    const shut = await post("/api/hotels/5EL/till/outlet/REST/closed",
      { closed: true, until: "2h", reason: "kitchen stopped early" });
    expect(shut.status, await shut.clone().text()).toBe(200);

    const res = await post("/api/hotels/5EL/till/orders",
      { outlet: "REST", table: "TILLTEST shut" });
    expect(res.status).toBe(409);

    const reason = ((await res.json()) as { reason: string }).reason;
    expect(reason).toMatch(/closed/i);
    expect(reason).toMatch(/kitchen stopped early/i);
    /* When, not just whether. */
    expect(reason).toMatch(/open again/i);
  });

  it("tells the floor WHY, not only that it is shut", async () => {
    /* ⚠ THE BANNER AND THE REFUSAL KNEW DIFFERENT AMOUNTS. A waiter
       ringing an order was told "closed — kitchen stopped early"; the
       manager reading the floor was told only "closed", because the
       floor query never selected the reason. Two views of one fact,
       and the one with less in it belonged to the person who could
       act on it. */
    const res = await as("/api/hotels/5EL/till/floor?outlet=REST");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      outlet: { closedUntil: string | null; closedReason: string | null } | null;
    };
    expect(body.outlet?.closedUntil).toBeTruthy();
    expect(body.outlet?.closedReason).toBe("kitchen stopped early");
  });

  it("is not the same as the module being off", async () => {
    /* A shut store still has its screens: a biller can settle the bills
       already open, print them and count the drawer. Turning the MODULE
       off is a configuration change and takes the whole till away. */
    const menu = await as("/api/hotels/5EL/till/menu");
    expect(menu.status).toBe(200);

    const orders = await as("/api/hotels/5EL/till/orders");
    expect(orders.status).toBe(200);
  });

  it("reopens", async () => {
    const open = await post("/api/hotels/5EL/till/outlet/REST/closed",
      { closed: false });
    expect(open.status).toBe(200);

    const res = await post("/api/hotels/5EL/till/orders",
      { outlet: "REST", table: "TILLTEST reopened" });
    expect(res.status, await res.clone().text()).toBe(200);
  });
});

/* ══════════════════════════════════════════════════════════════════
   THE FLOOR, THROUGH THE ROUTES

   The five colours are DERIVED. The db suite walks one table through
   all of them; these prove the route hands the screen the same answer,
   and that a table cannot end up with two live bills on it.
   ══════════════════════════════════════════════════════════════════ */

type FloorTable = {
  id: string; label: string; seats: number | null;
  orderId: string | null; state: string;
  minutes: number | null; payable: number | null;
};

describe("the floor", () => {
  let sectionId: string;
  let ac4: string;
  let ac5: string;

  beforeAll(async () => {
    const db = await admin();
    try {
      const { rows: o } = await db.query<{ id: string; hotel: string }>(
        `select po.id::text, po.hotel_id::text as hotel from pos_outlets po
           join hotels h on h.id = po.hotel_id
          where h.code = '5EL' and po.code = 'REST'`);

      const { rows: s } = await db.query<{ id: string }>(
        `insert into pos_sections (hotel_id, outlet_id, name, sort_order)
         values ($1,$2,'FLOORTEST A/C',1) returning id::text`,
        [o[0]!.hotel, o[0]!.id]);
      sectionId = s[0]!.id;

      const { rows: t } = await db.query<{ id: string; label: string }>(
        `insert into pos_tables (hotel_id, section_id, label, seats, row_no, col_no)
         values ($1,$2,'FT4',4,1,1),($1,$2,'FT5',2,1,2)
         returning id::text, label`, [o[0]!.hotel, sectionId]);
      ac4 = t.find((r) => r.label === "FT4")!.id;
      ac5 = t.find((r) => r.label === "FT5")!.id;
    } finally {
      await db.end();
    }
  });

  afterAll(async () => {
    const db = await admin();
    try {
      await db.query(
        "alter table pos_order_lines disable trigger pos_order_lines_frozen");
      try {
        await db.query(
          `delete from pos_order_lines where order_id in
             (select id from pos_orders where table_id in ($1,$2))`, [ac4, ac5]);
      } finally {
        await db.query(
          "alter table pos_order_lines enable trigger pos_order_lines_frozen");
      }
      await db.query(`delete from pos_orders where table_id in ($1,$2)`, [ac4, ac5]);
      await db.query(`delete from pos_tables where section_id = $1`, [sectionId]);
      await db.query(`delete from pos_sections where id = $1`, [sectionId]);
    } finally {
      await db.end();
    }
  });

  const floor = async () => {
    const res = await as("/api/hotels/5EL/till/floor?outlet=REST");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sections: { name: string; tables: FloorTable[] }[];
    };
    return body.sections.find((s) => s.name === "FLOORTEST A/C")!;
  };

  it("returns every table, grouped by section", async () => {
    const section = await floor();
    expect(section.tables.map((t) => t.label)).toEqual(["FT4", "FT5"]);
    /* Empty tables are the point of a floor view — a grid that only
       showed occupied ones would answer the wrong question. */
    expect(section.tables.every((t) => t.state === "blank")).toBe(true);
  });

  it("walks a table from running to paid to blank", async () => {
    const opened = await post("/api/hotels/5EL/till/orders",
      { outlet: "REST", tableId: ac4 });
    expect(opened.status, await opened.clone().text()).toBe(200);
    const order = (await opened.json()) as { id: string; table: string };

    /* The table's LABEL is copied onto the order, so a bill reprinted
       next year reads the same even if the floor is rearranged. */
    expect(order.table).toBe("FT4");

    let t = (await floor()).tables.find((x) => x.label === "FT4")!;
    expect(t.state).toBe("running");
    expect(t.orderId).toBe(order.id);

    const item = await menuItem("Paneer Tikka");
    await post(`/api/hotels/5EL/till/orders/${order.id}/lines`,
      { itemId: item.id, qty: 1 });

    t = (await floor()).tables.find((x) => x.label === "FT4")!;
    expect(t.state, "still running until the kitchen has it").toBe("running");
    expect(t.payable).toBeGreaterThan(0);

    await post(`/api/hotels/5EL/till/orders/${order.id}/kot`);
    t = (await floor()).tables.find((x) => x.label === "FT4")!;
    expect(t.state).toBe("kot");

    await post(`/api/hotels/5EL/till/orders/${order.id}/printed`);
    t = (await floor()).tables.find((x) => x.label === "FT4")!;
    /* Printed outranks KOT: the guest is paying, which is what the
       waiter needs to see from across the room. */
    expect(t.state).toBe("printed");

    await post(`/api/hotels/5EL/till/orders/${order.id}/settle`,
      { method: "cash" });
    t = (await floor()).tables.find((x) => x.label === "FT4")!;
    expect(t.state, "settled but not reset").toBe("paid");

    const cleared = await post(`/api/hotels/5EL/till/orders/${order.id}/clear`);
    expect(cleared.status).toBe(200);
    t = (await floor()).tables.find((x) => x.label === "FT4")!;
    expect(t.state).toBe("blank");
  });

  it("refuses to clear a table with an unsettled bill on it", async () => {
    const opened = await post("/api/hotels/5EL/till/orders",
      { outlet: "REST", tableId: ac5 });
    const order = (await opened.json()) as { id: string };

    const res = await post(`/api/hotels/5EL/till/orders/${order.id}/clear`);
    expect(res.status).toBe(409);
    /* Clearing an open bill takes a live order off the floor with money
       on it — the guests are still sitting there. */
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/not been settled/i);
  });

  it("refuses a second live order on the same table, by name", async () => {
    const res = await post("/api/hotels/5EL/till/orders",
      { outlet: "REST", tableId: ac5 });
    expect(res.status).toBe(409);
    /* Named before the unique index gets to it, so the waiter is told
       WHICH bill is already running rather than meeting a constraint. */
    const reason = ((await res.json()) as { reason: string }).reason;
    expect(reason).toMatch(/FT5 already has/i);
    expect(reason).toMatch(/running on it/i);
  });

  it("refuses a table from another outlet", async () => {
    const res = await post("/api/hotels/5EL/till/orders",
      { outlet: "REST", tableId: "00000000-0000-0000-0000-000000000000" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/not in this outlet/i);
  });
});

/* ══════════════════════════════════════════════════════════════════
   THE ORDER HEADER

   One endpoint for five fields, because they are one panel. Four
   endpoints would mean a waiter who fills it in and taps away produces
   four writes, three of which can fail on their own and leave the
   header half entered with nothing saying which half.
   ══════════════════════════════════════════════════════════════════ */

describe("the order header", () => {
  it("takes covers, a waiter and a channel in one call", async () => {
    const order = await openOrder("header");

    const { rows: waiters } = await (async () => {
      const res = await as("/api/hotels/5EL/till/waiters");
      expect(res.status).toBe(200);
      return { rows: ((await res.json()) as { waiters: { id: string }[] }).waiters };
    })();
    expect(waiters.length).toBeGreaterThan(0);

    const res = await app.request(`/api/hotels/5EL/till/orders/${order.id}`, {
      method: "PATCH",
      headers: {
        "x-dev-staff-id": ownerStaffId,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        covers: 4, waiterId: waiters[0]!.id, orderType: "room_service",
      }),
    });
    expect(res.status, await res.clone().text()).toBe(200);

    const body = (await res.json()) as {
      covers: number; waiter: string; orderType: string;
    };
    expect(body.covers).toBe(4);
    expect(body.waiter).toBeTruthy();
    /* order_type has been in the schema since 034 and nothing set it. */
    expect(body.orderType).toBe("room_service");
  });

  it("writes only what was sent", async () => {
    const order = await openOrder("header-partial");
    const patch = (b: unknown) =>
      app.request(`/api/hotels/5EL/till/orders/${order.id}`, {
        method: "PATCH",
        headers: {
          "x-dev-staff-id": ownerStaffId,
          "content-type": "application/json",
        },
        body: JSON.stringify(b),
      });

    await patch({ covers: 6, customerName: "Mrs Rao" });
    const after = (await (await patch({ covers: 8 })).json()) as {
      covers: number; customerName: string | null;
    };

    /* A patch that wrote every column would blank the name each time
       somebody corrected the covers. */
    expect(after.covers).toBe(8);
    expect(after.customerName).toBe("Mrs Rao");
  });

  it("refuses zero covers by name, not by constraint", async () => {
    const order = await openOrder("header-zero");
    const res = await app.request(`/api/hotels/5EL/till/orders/${order.id}`, {
      method: "PATCH",
      headers: {
        "x-dev-staff-id": ownerStaffId,
        "content-type": "application/json",
      },
      body: JSON.stringify({ covers: 0 }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/how many people/i);
  });

  it("cannot settle a delivery with nobody to deliver to", async () => {
    const order = await openOrder("header-delivery");
    const item = await menuItem("Paneer Tikka");
    await post(`/api/hotels/5EL/till/orders/${order.id}/lines`,
      { itemId: item.id, qty: 1 });

    await app.request(`/api/hotels/5EL/till/orders/${order.id}`, {
      method: "PATCH",
      headers: {
        "x-dev-staff-id": ownerStaffId,
        "content-type": "application/json",
      },
      body: JSON.stringify({ orderType: "delivery" }),
    });

    /* Cooked, and then it cannot leave the building. */
    const refused = await post(
      `/api/hotels/5EL/till/orders/${order.id}/settle`, { method: "cash" });
    expect(refused.status).toBe(409);

    await app.request(`/api/hotels/5EL/till/orders/${order.id}`, {
      method: "PATCH",
      headers: {
        "x-dev-staff-id": ownerStaffId,
        "content-type": "application/json",
      },
      body: JSON.stringify({ customerPhone: "9000000007" }),
    });

    const settled = await post(
      `/api/hotels/5EL/till/orders/${order.id}/settle`, { method: "cash" });
    expect(settled.status, await settled.clone().text()).toBe(200);
  });

  it("holds an order and lets it go again", async () => {
    const order = await openOrder("header-hold");
    const patch = (b: unknown) =>
      app.request(`/api/hotels/5EL/till/orders/${order.id}`, {
        method: "PATCH",
        headers: {
          "x-dev-staff-id": ownerStaffId,
          "content-type": "application/json",
        },
        body: JSON.stringify(b),
      });

    const held = (await (await patch({ held: true })).json()) as {
      heldAt: string | null;
    };
    expect(held.heldAt).toBeTruthy();

    const back = (await (await patch({ held: false })).json()) as {
      heldAt: string | null;
    };
    expect(back.heldAt).toBeNull();
  });

  it("refuses a header change on a settled bill", async () => {
    const order = await openOrder("header-settled");
    const item = await menuItem("Paneer Tikka");
    await post(`/api/hotels/5EL/till/orders/${order.id}/lines`,
      { itemId: item.id, qty: 1 });
    await post(`/api/hotels/5EL/till/orders/${order.id}/settle`,
      { method: "cash" });

    const res = await app.request(`/api/hotels/5EL/till/orders/${order.id}`, {
      method: "PATCH",
      headers: {
        "x-dev-staff-id": ownerStaffId,
        "content-type": "application/json",
      },
      body: JSON.stringify({ covers: 2 }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/settled/i);
  });
});

/* ══════════════════════════════════════════════════════════════════
   THE KITCHEN DOCKET

   The number belongs to a BATCH of lines, not to the order. Starters,
   then mains, then a dessert somebody changed their mind about: three
   dockets, three numbers, one bill. A kitchen holding three pieces of
   paper that all say KOT-5 cannot tell the chef which is which.
   ══════════════════════════════════════════════════════════════════ */

describe("the kitchen docket", () => {
  it("numbers each send separately, on one bill", async () => {
    const order = await openOrder("kot-batches");
    const tikka = await menuItem("Paneer Tikka");
    const roti = await menuItem("Butter Roti");

    await post(`/api/hotels/5EL/till/orders/${order.id}/lines`,
      { itemId: tikka.id, qty: 1 });
    const first = await post(`/api/hotels/5EL/till/orders/${order.id}/kot`);
    expect(first.status).toBe(200);
    const one = (await first.json()) as { kotNo: number; sent: number };

    await post(`/api/hotels/5EL/till/orders/${order.id}/lines`,
      { itemId: roti.id, qty: 2 });
    const second = await post(`/api/hotels/5EL/till/orders/${order.id}/kot`);
    const two = (await second.json()) as { kotNo: number; sent: number };

    /* Two dockets, two numbers, one bill. */
    expect(two.kotNo).toBe(one.kotNo + 1);
    expect(one.sent).toBe(1);
    expect(two.sent).toBe(1);
  });

  it("sends only what has not gone, and refuses when nothing is left", async () => {
    const order = await openOrder("kot-nothing-left");
    const item = await menuItem("Paneer Tikka");
    await post(`/api/hotels/5EL/till/orders/${order.id}/lines`,
      { itemId: item.id, qty: 1 });
    await post(`/api/hotels/5EL/till/orders/${order.id}/kot`);

    const again = await post(`/api/hotels/5EL/till/orders/${order.id}/kot`);
    expect(again.status).toBe(409);
    /* Firing the whole order again would put the starters back on the
       pass while they are being eaten. */
    expect(((await again.json()) as { reason: string }).reason)
      .toMatch(/already with the kitchen/i);
  });

  it("prints add-ons nested under their dish, with the note", async () => {
    const order = await openOrder("kot-nested");
    const db = await admin();
    let dishId: string; let varId: string; let addonId: string;
    try {
      const { rows } = await db.query<{
        item: string; variation: string; addon: string;
      }>(
        `select i.id::text as item,
                (select v.id::text from pos_item_variations v
                  where v.item_id = i.id and v.label = 'Butter') as variation,
                (select a.id::text from pos_addons a
                  where a.label = 'Onions' and a.hotel_id = i.hotel_id) as addon
           from pos_menu_items i
           join hotels h on h.id = i.hotel_id
          where h.code = '5EL' and i.name = 'Bhaaji Pau'`);
      dishId = rows[0]!.item;
      varId = rows[0]!.variation;
      addonId = rows[0]!.addon;
    } finally {
      await db.end();
    }

    await post(`/api/hotels/5EL/till/orders/${order.id}/lines`, {
      itemId: dishId, qty: 1, variationId: varId,
      addonIds: [addonId], note: "Less Spicy",
    });
    const sent = await post(`/api/hotels/5EL/till/orders/${order.id}/kot`);
    const { kotNo } = (await sent.json()) as { kotNo: number };

    const res = await as(
      `/api/hotels/5EL/till/orders/${order.id}/kot/${kotNo}`);
    expect(res.status).toBe(200);
    const docket = (await res.json()) as {
      kotNo: number; table: string | null; orderType: string;
      lines: { id: string; parentId: string | null; name: string;
               qty: number; note: string | null; isAddon: boolean }[];
    };

    expect(docket.kotNo).toBe(kotNo);
    const dish = docket.lines.find((l) => !l.isAddon)!;
    const side = docket.lines.find((l) => l.isAddon)!;

    expect(dish.name).toBe("Bhaaji Pau (Butter)");
    expect(dish.note).toBe("Less Spicy");
    /* The whole point of the printed form: a chef reads the dish, then
       indented, what goes on it. Flat, the sides get plated alone. */
    expect(side.parentId).toBe(dish.id);
    expect(side.name).toBe("Sides: Onions");

    /* And the dish comes before its own side. */
    expect(docket.lines.indexOf(dish)).toBeLessThan(docket.lines.indexOf(side));
  });

  it("leaves a struck dish off the paper", async () => {
    const order = await openOrder("kot-struck");
    const tikka = await menuItem("Paneer Tikka");
    const roti = await menuItem("Butter Roti");
    await post(`/api/hotels/5EL/till/orders/${order.id}/lines`,
      { itemId: tikka.id, qty: 1 });
    await post(`/api/hotels/5EL/till/orders/${order.id}/lines`,
      { itemId: roti.id, qty: 1 });

    const sent = await post(`/api/hotels/5EL/till/orders/${order.id}/kot`);
    const { kotNo } = (await sent.json()) as { kotNo: number };

    const current = (await (await as(
      `/api/hotels/5EL/till/orders/${order.id}`)).json()) as {
      lines: { id: string; name: string }[];
    };
    const toStrike = current.lines.find((l) => l.name === "Butter Roti")!;
    await post(
      `/api/hotels/5EL/till/orders/${order.id}/lines/${toStrike.id}/void`);

    const docket = (await (await as(
      `/api/hotels/5EL/till/orders/${order.id}/kot/${kotNo}`)).json()) as {
      lines: { name: string }[];
    };
    /* A dish cancelled after the docket printed has its own loud line on
       the pass. Reprinting it here would put it back on the chef's rail. */
    expect(docket.lines.map((l) => l.name)).toEqual(["Paneer Tikka"]);
  });

  it("has no docket for a number that was never sent", async () => {
    const order = await openOrder("kot-missing");
    const res = await as(`/api/hotels/5EL/till/orders/${order.id}/kot/999`);
    expect(res.status).toBe(404);
  });
});

/* ══════════════════════════════════════════════════════════════════
   DAY END

   The night audit's shape, in a restaurant: refuse while something is
   wrong and NAME it. An open bill and an uncleared table are questions
   a person answers.

   A drawer that does not balance is NOT one of them. The money is
   already whatever it is, and a shift that cannot close is worse than a
   difference written down with a reason.
   ══════════════════════════════════════════════════════════════════ */

describe("day end", () => {
  afterAll(async () => {
    const db = await admin();
    try {
      await db.query("delete from pos_denominations");
      await db.query("delete from pos_day_ends");
      await db.query("delete from pos_cash_movements");
    } finally {
      await db.end();
    }
  });

  const dayEnd = async () => {
    const res = await as("/api/hotels/5EL/till/day-end?outlet=REST");
    expect(res.status).toBe(200);
    return (await res.json()) as {
      businessDate: string;
      summary: { settledOrders: number; settledValue: number;
                 byMethod: Record<string, number> };
      blockers: { id: string; reason: string; detail: string | null }[];
      cash: { opening: number; expected: number; counted: number | null;
              variance: number | null };
      movements: { kind: string; amount: number; reason: string }[];
      closedAt: string | null;
    };
  };

  it("names the open bill that stops the close", async () => {
    const order = await openOrder("dayend-open");
    const item = await menuItem("Paneer Tikka");
    await post(`/api/hotels/5EL/till/orders/${order.id}/lines`,
      { itemId: item.id, qty: 1 });

    const body = await dayEnd();
    const blocker = body.blockers.find((b) => b.id === "open_orders");
    expect(blocker, "an open bill must stop the close").toBeTruthy();
    /* The refusal names the bill, so a person knows which one to go and
       settle rather than hunting the floor. */
    expect(blocker!.detail).toContain(order.orderNo);
    expect(blocker!.reason).toMatch(/will not decide which/i);

    const close = await post("/api/hotels/5EL/till/day-end/close", {});
    expect(close.status).toBe(409);

    await post(`/api/hotels/5EL/till/orders/${order.id}/settle`,
      { method: "cash" });
  });

  it("expects cash in the drawer, and nothing else", async () => {
    const cashOrder = await openOrder("dayend-cash");
    const cardOrder = await openOrder("dayend-card");
    const item = await menuItem("Paneer Tikka");
    await post(`/api/hotels/5EL/till/orders/${cashOrder.id}/lines`,
      { itemId: item.id, qty: 1 });
    await post(`/api/hotels/5EL/till/orders/${cardOrder.id}/lines`,
      { itemId: item.id, qty: 1 });

    const before = await dayEnd();

    await post(`/api/hotels/5EL/till/orders/${cashOrder.id}/settle`,
      { method: "cash" });
    await post(`/api/hotels/5EL/till/orders/${cardOrder.id}/settle`,
      { method: "card" });

    const after = await dayEnd();
    const cashBill = after.summary.byMethod["cash"]! - (before.summary.byMethod["cash"] ?? 0);

    /* A card settlement never touched the tin. Counting it would leave
       the drawer permanently short by the amount of business done
       properly. */
    expect(after.cash.expected - before.cash.expected).toBeCloseTo(cashBill, 2);
    expect(after.summary.byMethod["card"]).toBeGreaterThan(0);
  });

  it("refuses a movement with no reason", async () => {
    const res = await post("/api/hotels/5EL/till/day-end/movements",
      { kind: "expense", amount: 300 });
    expect(res.status).toBe(409);
    /* "Misc" is what people type when the field is optional. */
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/what was it for/i);
  });

  it("moves the expectation when money goes in and out", async () => {
    const before = await dayEnd();

    await post("/api/hotels/5EL/till/day-end/movements",
      { kind: "expense", amount: 300, reason: "vegetables" });
    await post("/api/hotels/5EL/till/day-end/movements",
      { kind: "top_up", amount: 500, reason: "change from the safe" });

    const after = await dayEnd();
    expect(after.cash.expected - before.cash.expected).toBeCloseTo(200, 2);
    expect(after.movements.map((m) => m.kind).sort())
      .toEqual(["expense", "top_up"]);
  });

  it("counts the drawer by denomination", async () => {
    const res = await post("/api/hotels/5EL/till/day-end/count", {
      opening: 2000,
      denominations: [
        { value: 500, count: 4 }, { value: 100, count: 3 },
        { value: 50, count: 2 },
      ],
    });
    expect(res.status, await res.clone().text()).toBe(200);

    const body = await dayEnd();
    /* 2000 + 300 + 100 */
    expect(body.cash.counted).toBe(2400);
    expect(body.cash.opening).toBe(2000);
    /* The one figure anybody argues about, worked out before the close
       rather than discovered after it. */
    expect(body.cash.variance).toBeCloseTo(2400 - body.cash.expected, 2);
  });

  /* Every other test in this file opens an order and leaves it. That is
     twenty-five open bills, and the blocker finds all of them — which is
     the blocker working, not a fault. A real day end has the same
     requirement, so the close tests below clear the floor first. */
  const clearTheFloor = async () => {
    const db = await admin();
    try {
      const { rows } = await db.query<{ id: string }>(
        `select o.id::text from pos_orders o
           join pos_outlets ou on ou.id = o.outlet_id
           join hotels h on h.id = o.hotel_id
          where h.code = '5EL' and ou.code = 'REST'
            and (o.status = 'open'
                 or (o.status = 'settled' and o.cleared_at is null
                     and o.table_id is not null))`);
      for (const r of rows) {
        await db.query(
          `update pos_orders
              set status = case when status = 'open' then 'abandoned' else status end,
                  abandoned_reason = case when status = 'open'
                                          then 'test teardown' else abandoned_reason end,
                  cleared_at = coalesce(cleared_at, now())
            where id = $1`, [r.id]);
      }
    } finally {
      await db.end();
    }
  };

  it("refuses to close on a difference with no explanation", async () => {
    await clearTheFloor();
    const body = await dayEnd();
    expect(Math.abs(body.cash.variance!)).toBeGreaterThan(0);

    const res = await post("/api/hotels/5EL/till/day-end/close", {});
    expect(res.status).toBe(409);
    const reason = ((await res.json()) as { reason: string }).reason;
    expect(reason).toMatch(/over|short/i);
    /* And says it closes once there is a sentence. */
    expect(reason).toMatch(/say why/i);
  });

  it("closes with the reason, and stays closed", async () => {
    const res = await post("/api/hotels/5EL/till/day-end/close",
      { varianceReason: "counted twice, not found" });
    expect(res.status, await res.clone().text()).toBe(200);

    const body = await dayEnd();
    expect(body.closedAt).toBeTruthy();

    const again = await post("/api/hotels/5EL/till/day-end/close",
      { varianceReason: "again" });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { reason: string }).reason)
      .toMatch(/already closed/i);
  });

  it("will not take a movement against a closed day", async () => {
    const res = await post("/api/hotels/5EL/till/day-end/movements",
      { kind: "expense", amount: 50, reason: "late delivery" });
    expect(res.status).toBe(409);
    /* A correction is a movement on TODAY, not an edit of yesterday. */
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/against today/i);
  });
});

/* ══════════════════════════════════════════════════════════════════
   IMPORTING A MENU

   The whole value of this feature is what it REFUSES. A dish with no
   price that lands at zero looks priced; a tax heading nobody
   recognised that lands at five percent looks decided. Both are the
   shipped-price failure this system exists to avoid, arriving two
   hundred at a time instead of one.

   So the rejections are asserted first, and the dry run is asserted to
   change nothing — which is the property that lets somebody look at a
   file before it replaces their card.
   ══════════════════════════════════════════════════════════════════ */

describe("importing a menu", () => {
  const section = `IMP-${process.pid}`;

  const post = (rows: Record<string, string>[], dryRun: boolean) =>
    app.request("/api/hotels/PUN/till/menu/import", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-dev-staff-id": ownerStaffId,
      },
      body: JSON.stringify({ rows, dryRun }),
    });

  afterAll(async () => {
    const db = await admin();
    try {
      await db.query(
        `delete from pos_menu_items
          where category_id in (select id from pos_menu_categories
                                 where name = $1)`, [section]);
      await db.query("delete from pos_menu_categories where name = $1", [section]);
    } finally {
      await db.end();
    }
  });

  const count = async (): Promise<number> => {
    const db = await admin();
    try {
      const { rows } = await db.query<{ n: string }>(
        `select count(*)::text as n from pos_menu_items i
           join pos_menu_categories c on c.id = i.category_id
          where c.name = $1`, [section]);
      return Number(rows[0]!.n);
    } finally {
      await db.end();
    }
  };

  it("rejects a blank price rather than importing it as zero", async () => {
    const res = await post([
      { category: section, name: "Priced", price: "240" },
      { category: section, name: "Unpriced", price: "" },
    ], true);
    const body = (await res.json()) as {
      verdicts: { name: string; action: string; detail: string }[];
      creates: number; rejected: number;
    };

    expect(body.creates).toBe(1);
    expect(body.rejected).toBe(1);
    const bad = body.verdicts.find((v) => v.name === "Unpriced")!;
    expect(bad.action).toBe("rejected");
    expect(bad.detail).toMatch(/not zero/i);
  });

  it("rejects a tax heading it does not know, rather than assuming one", async () => {
    const res = await post([
      { category: section, name: "Mystery", price: "100", taxKind: "drinks" },
    ], true);
    const body = (await res.json()) as { rejected: number; verdicts: { detail: string }[] };
    expect(body.rejected).toBe(1);
    expect(body.verdicts[0]!.detail).toMatch(/not a tax heading/i);
  });

  it("names a dish that appears twice in the same file", async () => {
    const res = await post([
      { category: section, name: "Twice", price: "100" },
      { category: section, name: "Twice", price: "200" },
    ], true);
    const body = (await res.json()) as { rejected: number; verdicts: { detail: string }[] };
    /* One creates, one is refused — silently taking the second would
       mean nobody knows which price won. */
    expect(body.rejected).toBe(1);
    expect(body.verdicts[1]!.detail).toMatch(/appears twice/i);
  });

  it("writes nothing on a dry run", async () => {
    const before = await count();
    await post([{ category: section, name: "Ghost", price: "500" }], true);
    expect(await count(), "the dry run wrote to the menu").toBe(before);
  });

  it("creates on the first pass and updates on the second", async () => {
    const rows = [
      { category: section, name: "Paneer", price: "300", taxKind: "restaurant", veg: "yes" },
      { category: section, name: "Peg", price: "250", taxKind: "bar" },
    ];

    const first = (await (await post(rows, false)).json()) as
      { creates: number; updates: number };
    expect(first.creates).toBe(2);
    expect(first.updates).toBe(0);

    /* The same file again is a CORRECTION, not a second card. This is
       what somebody actually does with a spreadsheet: fix a column,
       send it again. */
    rows[0]!.price = "320";
    const second = (await (await post(rows, false)).json()) as
      { creates: number; updates: number };
    expect(second.creates).toBe(0);
    expect(second.updates).toBe(2);
    expect(await count(), "the second import duplicated the menu").toBe(2);

    const db = await admin();
    try {
      const { rows: check } = await db.query<{
        name: string; price: string; tax_rate: string | null; kind: string | null;
      }>(
        `select i.name, i.price::text, i.tax_rate::text, c.tax_kind as kind
           from pos_menu_items i
           join pos_menu_categories c on c.id = i.category_id
          where c.name = $1 order by i.name`, [section]);

      expect(check.find((r) => r.name === "Paneer")!.price).toBe("320.00");

      /* NO RATE ON THE ITEM. The heading decides it, which is the whole
         point of 067 — a bar section carries the bar's rate without
         anybody typing a number onto every peg. */
      expect(check.every((r) => r.tax_rate === null),
        "an imported item carried its own tax rate").toBe(true);

      /* The last row in the file wins the section's heading, and both
         rows here name the same section — so this asserts the heading
         was set at all, not which. */
      expect(check[0]!.kind).toBeTruthy();
    } finally {
      await db.end();
    }
  });
});
