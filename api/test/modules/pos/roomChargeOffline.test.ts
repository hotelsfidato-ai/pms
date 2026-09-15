import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { ruleFor } from "@/lib/offline";

/* ══════════════════════════════════════════════════════════════════
   A ROOM CHARGE TAKEN WITH NO LINE, AND WHY THE DAY CANNOT CLOSE ON IT

   The owner decided on 8 September that a waiter in a hill station must
   be able to charge a dinner to a room with the connection down, and
   that it must be synced before anything closes.

   HALF OF THAT IS ALREADY BUILT AND WAS NOT OBVIOUS.

   A held charge lives in the browser's outbox; the server never saw it.
   Which means the bill is STILL OPEN on the server — and
   `app.pos_day_end_blockers` already refuses to close a day while any
   bill is open. So the guard the owner asked for is enforced by the
   database, not by a screen, and it holds across every device: a charge
   held on a waiter's phone blocks the day end running on the till,
   which no client-side check could ever do.

   This file proves that chain, because it is load-bearing and it is
   easy to break by accident — a day end that stops looking at open
   bills would silently make offline room charges unsafe.

   IT ALSO PROVES THE CLIENT HALF from the same run: `ruleFor` is
   imported from the frontend and asked what it would do with each
   payment method. A test that reimplemented that decision would prove
   only that the copy agrees with itself.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const admin = async () =>
  new (await import("pg")).default.Pool({ connectionString: SUPER });

let ownerUid: string;
let outletCode: string | null = null;
let outletId: string | null = null;
let businessDate: string | null = null;
let itemId: string | null = null;
/** A room with exactly ONE open folio. A changeover room has two and
    the server rightly refuses to guess which guest ate. */
let room: string | null = null;
const made: string[] = [];

const post = (path: string, body: unknown) =>
  app.request(`/api/hotels${path}`, {
    method: "POST",
    headers: { "x-dev-staff-id": ownerUid, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/** What a person would have to settle before the day could close. */
async function openBillBlockers(): Promise<string | null> {
  const db = await admin();
  try {
    const { rows } = await db.query<{ detail: string }>(
      `select detail from app.pos_day_end_blockers($1, $2::date)
        where id = 'open_orders'`,
      [outletId, businessDate],
    );
    return rows[0]?.detail ?? null;
  } finally {
    await db.end();
  }
}

beforeAll(async () => {
  const db = await admin();
  try {
    ownerUid = (await db.query<{ uid: string }>(
      "select firebase_uid as uid from staff where email = 'owner@fidato.in'",
    )).rows[0]!.uid;

    const o = await db.query<{ id: string; code: string }>(
      `select o.id::text, o.code from pos_outlets o
         join hotels h on h.id = o.hotel_id
        where h.code = '5EL' and o.is_active limit 1`,
    );
    outletId = o.rows[0]?.id ?? null;
    outletCode = o.rows[0]?.code ?? null;

    businessDate = (await db.query<{ d: string }>(
      `select to_char(app.business_date(h.id),'YYYY-MM-DD') as d
         from hotels h where h.code = '5EL'`,
    )).rows[0]?.d ?? null;

    itemId = (await db.query<{ id: string }>(
      `select i.id::text from pos_menu_items i
        where i.is_active
          and not exists (select 1 from pos_item_variations v
                           where v.item_id = i.id and v.is_active)
        limit 1`,
    )).rows[0]?.id ?? null;

    /* One guest, one folio. `pos_chargeable_rooms` is the same list the
       waiter's pad shows, so this test charges what a waiter could
       actually have tapped. */
    room = (await db.query<{ room: string }>(
      `select room_number as room from (
         select room_number, count(*) over (partition by room_number) as n
           from app.pos_chargeable_rooms(
                  (select id from hotels where code = '5EL'))
       ) x where n = 1 limit 1`,
    )).rows[0]?.room ?? null;
  } finally {
    await db.end();
  }
});

afterAll(async () => {
  /* ⚠ THESE BILLS ARE SETTLED, so the ordinary delete is refused:

       "Order … is settled, so its lines cannot change. Settle
        corrections with a credit on the folio, not by editing a paid
        bill."

     That trigger is right and is why it is LIFTED here rather than
     weakened — how money was taken is evidence, and nothing in
     `api/src` may do this. Same pattern and same reasoning as
     `till.test.ts`; a third spelling of this cleanup is how the second
     one came to be wrong.

     The FOLIO POSTINGS are reversed rather than deleted, because an
     append-only ledger is the one rule this project will not bend even
     in a test. Under `npm test` the whole database is dropped a minute
     later and none of this matters; under `test:live` it is the
     difference between a clean folio and a stranger's dinner on a real
     guest's bill. */
  const db = await admin();
  try {
    if (made.length) {
      await db.query(
        `insert into folio_postings
           (hotel_id, folio_id, business_date, category, description,
            amount, tax_rate, tax_amount, source_type, posted_by)
         select fp.hotel_id, fp.folio_id, fp.business_date, fp.category,
                'Reversal — room charge test', -fp.amount, fp.tax_rate,
                -fp.tax_amount, 'pos', fp.posted_by
           from folio_postings fp
           join pos_tickets t on t.posting_id = fp.id
           join pos_orders o
             on o.order_no = split_part(t.ticket_ref, '/', 1)
          where o.id = any($1::uuid[])`,
        [made],
      );

      await db.query(
        "alter table pos_order_tenders disable trigger "
        + "pos_order_tenders_no_delete_settled",
      );
      await db.query(
        "alter table pos_order_lines disable trigger pos_order_lines_frozen",
      );
      try {
        await db.query(
          "delete from pos_orders where id = any($1::uuid[])", [made],
        );
      } finally {
        await db.query(
          "alter table pos_order_lines enable trigger pos_order_lines_frozen",
        );
        await db.query(
          "alter table pos_order_tenders enable trigger "
          + "pos_order_tenders_no_delete_settled",
        );
      }
    }
  } finally {
    await db.end();
  }
  await closePool();
});

describe("what the client would do with the line down", () => {
  /* The frontend's own rule, imported. If these drift, a waiter either
     loses the ability to charge a room offline or gains the ability to
     take cash offline — and the second moves a drawer after it was
     counted. */
  const settle = "/api/hotels/5EL/till/orders/abc/settle";

  it("holds a room charge", () => {
    const r = ruleFor(settle, "POST", JSON.stringify({ method: "room" }));
    expect(r.tier).toBe("queue-warn");
    expect(r.label).toBe("Room charge");
  });

  it("refuses cash, because a drawer is counted", () => {
    expect(ruleFor(settle, "POST", JSON.stringify({ method: "cash" })).tier)
      .toBe("refuse");
  });
});

describe("the day cannot close on a charge that never arrived", () => {
  it("blocks the day end while the bill is open, then releases it", async () => {
    if (!outletCode || !itemId || !room || !outletId || !businessDate) {
      expect(room, "5EL needs one guest in house with a single open folio")
        .toBeTruthy();
      return;
    }

    /* ── The waiter takes the order ─────────────────────────────── */
    const sent = await post(`/${"5EL"}/till/orders/batch`, {
      outlet: outletCode, table: "ROOMHOLD-1", send: true,
      lines: [{ itemId, qty: 2 }],
    });
    expect(sent.status).toBe(200);
    const order = (await sent.json()) as { id: string; orderNo: string };
    made.push(order.id);

    /* ── While the charge is held on a phone, this is what the till
          sees when somebody tries to close the day ──────────────── */
    const blocked = await openBillBlockers();
    expect(
      blocked,
      "the day end did not notice an open bill — a room charge held "
      + "offline would then be closed over and lost",
    ).toBeTruthy();
    expect(blocked).toContain(order.orderNo);

    /* ── The line comes back and the outbox drains ──────────────── */
    const settled = await post(
      `/5EL/till/orders/${order.id}/settle`,
      { method: "room", room },
    );
    expect(settled.status, "the drained room charge was refused").toBe(200);

    /* ── And only now may the day close ─────────────────────────── */
    const after = await openBillBlockers();
    expect(
      after === null || !after.includes(order.orderNo),
      "the bill is still counted as open after being settled",
    ).toBe(true);
  });

  it("puts the money on the guest's folio, not somewhere of its own", async () => {
    if (!outletCode || !itemId || !room) return;

    const db = await admin();
    let before: number;
    try {
      before = Number((await db.query<{ n: string }>(
        `select coalesce(sum(fp.amount + fp.tax_amount),0)::text as n
           from folio_postings fp
           join folios f on f.id = fp.folio_id
           join room_assignments ra on ra.reservation_id = f.reservation_id
           join rooms r on r.id = ra.room_id
          where r.number = $1 and fp.source_type = 'pos'`,
        [room],
      )).rows[0]!.n);
    } finally {
      await db.end();
    }

    const sent = await post(`/5EL/till/orders/batch`, {
      outlet: outletCode, table: "ROOMHOLD-2", send: true,
      lines: [{ itemId, qty: 1 }],
    });
    const order = (await sent.json()) as { id: string; payable: number };
    made.push(order.id);

    const settled = await post(
      `/5EL/till/orders/${order.id}/settle`, { method: "room", room },
    );
    expect(settled.status).toBe(200);

    const db2 = await admin();
    try {
      const after = Number((await db2.query<{ n: string }>(
        `select coalesce(sum(fp.amount + fp.tax_amount),0)::text as n
           from folio_postings fp
           join folios f on f.id = fp.folio_id
           join room_assignments ra on ra.reservation_id = f.reservation_id
           join rooms r on r.id = ra.room_id
          where r.number = $1 and fp.source_type = 'pos'`,
        [room],
      )).rows[0]!.n);
      /* AMOUNT PLUS TAX, because a folio posting keeps them in separate
         columns and splits one bill into a posting per tax rate. Summing
         `amount` alone came out 16 short on a 336 bill — exactly the 5%
         — which looked like a missing charge and was a wrong question.
         The bill's own `payable` is the figure to check against; a test
         that recomputes the total proves only its own arithmetic. */
      expect(after - before).toBeCloseTo(order.payable, 2);
    } finally {
      await db2.end();
    }
  });
});
