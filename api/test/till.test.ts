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

    await post(`/api/hotels/5EL/till/orders/${order.id}/lines`,
      { itemId: tikka.id, qty: 1 });
    const added = await post(`/api/hotels/5EL/till/orders/${order.id}/lines`,
      { itemId: tikka.id, qty: 4 });
    const before = (await added.json()) as {
      gross: number; lines: { id: string }[];
    };
    expect(before.gross).toBe(1680);  // 5 x 320 + 5%

    const res = await post(
      `/api/hotels/5EL/till/orders/${order.id}/lines/${before.lines[1]!.id}/void`,
    );
    const after = (await res.json()) as {
      gross: number; lines: { voided: boolean }[];
    };

    expect(after.gross).toBe(336);              // only the 1 remains
    expect(after.lines.length).toBe(2);         // the struck one is still THERE
    expect(after.lines.filter((l) => l.voided).length).toBe(1);

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
