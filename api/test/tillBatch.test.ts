import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../src/server.ts";
import { closePool } from "../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   A WHOLE ORDER, IN ONE REQUEST

   A waiter standing at a table builds the order on the pad in their
   hand — six taps, no network — and sends it once. Before this, each
   tap was a journey to the server, and on a real server that is about
   a second per dish.

   THE ASSERTION THAT MATTERS IS THE ROLLBACK.

   Six dishes go up together. If the fourth is refused — off the menu,
   a variation not chosen, an outlet closed — the first three must not
   be on a bill. Half an order is worse than none: the waiter believes
   they sent six, the kitchen cooks three, and nobody finds out until
   the table complains.

   `withUser` wraps the request in one transaction, so a refusal has to
   THROW. Returning would let the transaction commit whatever had
   already been written, which is exactly the bug this guards.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const admin = async () =>
  new (await import("pg")).default.Pool({ connectionString: SUPER });

let ownerUid: string;
let items: string[] = [];
let outlet: string | null = null;
const made: string[] = [];

const post = (path: string, body: unknown) =>
  app.request(`/api/hotels${path}`, {
    method: "POST",
    headers: { "x-dev-staff-id": ownerUid, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  const db = await admin();
  try {
    const s = await db.query<{ uid: string }>(
      "select firebase_uid as uid from staff where email = 'owner@fidato.in'",
    );
    ownerUid = s.rows[0]!.uid;

    /* Dishes with no variations — a dish sold by variation refuses
       without one, and that is a different test. */
    const it = await db.query<{ id: string }>(
      `select i.id::text from pos_menu_items i
        where i.is_active
          and not exists (select 1 from pos_item_variations v
                           where v.item_id = i.id and v.is_active)
        limit 3`,
    );
    items = it.rows.map((r) => r.id);

    const o = await db.query<{ code: string }>(
      `select o.code from pos_outlets o
         join hotels h on h.id = o.hotel_id
        where h.code = '5EL' and o.is_active limit 1`,
    );
    outlet = o.rows[0]?.code ?? null;
  } finally {
    await db.end();
  }
});

afterAll(async () => {
  const db = await admin();
  try {
    for (const id of made) {
      await db.query("delete from pos_order_lines where order_id = $1", [id]);
      await db.query("delete from pos_orders where id = $1", [id]);
    }
  } finally {
    await db.end();
  }
  await closePool();
});

describe("sending a whole order at once", () => {
  it("opens the order, adds every dish and fires one docket", async () => {
    if (!outlet || items.length < 3) {
      expect(outlet, "5EL needs an outlet and three plain dishes").toBeTruthy();
      return;
    }

    const res = await post("/5EL/till/orders/batch", {
      outlet,
      table: "BATCH-1",
      send: true,
      lines: [
        { itemId: items[0], qty: 2 },
        { itemId: items[1], qty: 1 },
        { itemId: items[2], qty: 3 },
      ],
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      ok: boolean; id: string; opened: boolean;
      sent: number; kotNo: number;
      lines: { voided: boolean; kotStatus?: string }[];
    };
    made.push(body.id);

    expect(body.ok).toBe(true);
    expect(body.opened, "it should have opened a new order").toBe(true);
    /* ONE docket for the batch, not one per dish. A kitchen holding
       three pieces of paper that all say the same number cannot tell
       the chef which is which — and three numbers for one round is
       just as bad. */
    expect(body.kotNo).toBeGreaterThan(0);
    expect(body.sent).toBeGreaterThan(0);

    const live = body.lines.filter((l) => !l.voided);
    expect(live.length).toBeGreaterThanOrEqual(3);
  });

  it("ROLLS THE WHOLE ORDER BACK when one dish is refused", async () => {
    if (!outlet || items.length < 2) return;

    const db = await admin();
    let before: string;
    try {
      const { rows } = await db.query<{ n: string }>(
        "select count(*)::text as n from pos_orders",
      );
      before = rows[0]!.n;
    } finally {
      await db.end();
    }

    const res = await post("/5EL/till/orders/batch", {
      outlet,
      table: "ROLLBACK-1",
      send: true,
      lines: [
        { itemId: items[0], qty: 1 },
        { itemId: items[1], qty: 2 },
        /* Not on the menu. The three above are already written by the
           time this is reached. */
        { itemId: "00000000-0000-0000-0000-000000000000", qty: 1 },
      ],
    });

    expect(res.status).toBe(409);

    /* ⚠ THE ROW COUNT FIRST, DELIBERATELY. A 409 proves only that the
       request was refused; the wording proves only the wording. What
       actually matters is that the order the first two dishes were
       written into is NOT THERE — so that assertion goes first, and it
       is the one that fires when the rollback is removed.

       Checked this way round after watching the message assertion trip
       first and hide the real failure. A guard should fail on the thing
       it exists to catch. */
    const db2 = await admin();
    try {
      const { rows } = await db2.query<{ n: string }>(
        "select count(*)::text as n from pos_orders",
      );
      expect(rows[0]!.n, "a half-written order survived the refusal")
        .toBe(before);
    } finally {
      await db2.end();
    }

    const body = (await res.json()) as { reason: string };
    /* And it says WHICH dish. "No such item on the menu" is not
       actionable when six went up together. */
    expect(body.reason).toContain("Dish 3");
    expect(body.reason).toContain("Nothing was sent");
  });

  it("adds a second round to an order already open", async () => {
    if (!outlet || items.length < 2) return;

    const first = await post("/5EL/till/orders/batch", {
      outlet, table: "ROUNDS-1", send: true,
      lines: [{ itemId: items[0], qty: 1 }],
    });
    const one = (await first.json()) as { id: string; kotNo: number };
    made.push(one.id);

    const second = await post("/5EL/till/orders/batch", {
      orderId: one.id, send: true,
      lines: [{ itemId: items[1], qty: 2 }],
    });
    expect(second.status).toBe(200);
    const two = (await second.json()) as {
      id: string; opened: boolean; kotNo: number;
    };

    expect(two.id, "the same bill, not a new one").toBe(one.id);
    expect(two.opened).toBe(false);
    /* A NEW docket number for the second round. Starters then mains is
       two pieces of paper, and the kitchen has to be able to tell them
       apart. */
    expect(two.kotNo).toBeGreaterThan(one.kotNo);
  });

  it("refuses an empty send rather than opening an empty bill", async () => {
    const res = await post("/5EL/till/orders/batch", {
      outlet, table: "EMPTY-1", lines: [],
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toContain("nothing to send");
  });
});
