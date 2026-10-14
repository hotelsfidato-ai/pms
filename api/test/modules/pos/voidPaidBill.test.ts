import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { openTillDay } from "../../drawer.ts";

/* ══════════════════════════════════════════════════════════════════
   A PAID RESTAURANT BILL VOIDED (the owner's D27-324 (1), 14 October)

   The owner, an administrator or the GM voids a PAID bill, with a reason:
   the same business day, before the restaurant's day is closed; never a
   bill charged to a room; card or UPI with the refund's reference; cash
   out of the voider's own drawer. The bill keeps its number, reprints
   VOID, and the day's report names who, when, why and how much. The
   KOTs stay. Migration 223 is the database's half
   (db/tests/modules/pos.sql, "pos void").
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "VOIDPAID";
let owner = "";
let gm = "";
let waiter = "";
let tikka = "";
let putAwayTillDay: () => Promise<void>;

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const call = (who: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, body === undefined
    ? { headers: { "x-dev-staff-id": who } }
    : {
        method: "POST",
        headers: { "x-dev-staff-id": who, "content-type": "application/json" },
        body: JSON.stringify(body),
      });

interface Order {
  id: string; orderNo: string; status: string; payable: number;
  voidedBy: string | null; voidedAt: string | null; voidReason: string | null;
  voidReference: string | null; room: string | null;
  tenders: { method: string; amount: number }[];
  lines: { kotStatus: string }[];
}

/** A bill of one Paneer Tikka, sent to the kitchen and paid `how`. */
async function paidBill(table: string, how: Record<string, unknown>, by = owner): Promise<Order> {
  const opened = await call(by, "/till/orders", { outlet: "REST", table: `${TAG} ${table}` });
  expect(opened.status, await opened.clone().text()).toBe(200);
  const { id } = (await opened.json()) as { id: string };
  expect((await call(by, `/till/orders/${id}/lines`, { itemId: tikka, qty: 1 })).status).toBe(200);
  expect((await call(by, `/till/orders/${id}/kot`, {})).status).toBe(200);
  const paid = await call(by, `/till/orders/${id}/settle`, how);
  expect(paid.status, await paid.clone().text()).toBe(200);
  return (await paid.json()) as Order;
}

const voidIt = (who: string, id: string, body: Record<string, unknown>) =>
  call(who, `/till/orders/${id}/void`, body);

beforeAll(async () => {
  owner = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  const person = async (email: string, name: string, role: string) => {
    const [s] = await sql<{ id: string }>(
      `insert into staff (email, full_name) values ($1, $2)
       on conflict (email) do update set is_active = true returning id::text`, [email, name]);
    await sql(
      `insert into staff_hotels (staff_id, hotel_id, role)
       select $1, id, $2 from hotels where code = '5EL'
       on conflict (staff_id, hotel_id) do update set role = excluded.role`, [s!.id, role]);
    return s!.id;
  };
  gm = await person("void-gm@fidato.in", "VOIDPAID Manager", "gm");
  waiter = await person("void-waiter@fidato.in", "VOIDPAID Waiter", "pos");
  const res = await call(owner, "/till/menu");
  const menu = (await res.json()) as { categories: { items: { id: string; name: string }[] }[] };
  tikka = menu.categories.flatMap((c) => c.items).find((i) => i.name === "Paneer Tikka")!.id;
  putAwayTillDay = await openTillDay("5EL");
});

afterAll(async () => {
  await putAwayTillDay();
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try {
    await db.query("alter table pos_order_tenders disable trigger pos_order_tenders_no_delete_settled");
    await db.query("alter table pos_order_lines disable trigger pos_order_lines_frozen");
    await db.query("delete from pos_orders where table_ref like $1", [`${TAG}%`]);
    await db.query("delete from cashier_shifts where staff_id = any($1::uuid[])", [[gm, waiter]]);
    await db.query("delete from staff_hotels where staff_id = any($1::uuid[])", [[gm, waiter]]);
  } finally {
    await db.query("alter table pos_order_lines enable trigger pos_order_lines_frozen");
    await db.query("alter table pos_order_tenders enable trigger pos_order_tenders_no_delete_settled");
    await db.end();
  }
  await closePool();
});

describe("voiding a paid restaurant bill", () => {
  it("is refused to a waiter, by the server", async () => {
    const bill = await paidBill("waiter", { method: "cash" }, waiter);
    const res = await voidIt(waiter, bill.id, { reason: "wrong table" });
    expect(res.status).toBe(403);
    const [o] = await sql<{ status: string }>("select status from pos_orders where id = $1", [bill.id]);
    expect(o!.status).toBe("settled");
  });

  it("needs a reason", async () => {
    const bill = await paidBill("no reason", { method: "cash" });
    const res = await voidIt(gm, bill.id, { reason: "  " });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason)
      .toBe("Say why this bill is being voided. The reason stays on the bill.");
  });

  it("the GM voids a cash bill: it keeps its number, its payment and its KOT, and the cash leaves the GM's drawer", async () => {
    const bill = await paidBill("cash", { method: "cash" });
    const res = await voidIt(gm, bill.id, { reason: "Billed to the wrong table" });
    expect(res.status, await res.clone().text()).toBe(200);
    const after = (await res.json()) as Order;
    expect(after.status).toBe("void");
    expect(after.orderNo).toBe(bill.orderNo);
    expect(after.voidReason).toBe("Billed to the wrong table");
    expect(after.voidedBy).toBe("VOIDPAID Manager");
    expect(after.voidedAt).toBeTruthy();
    /* Its payment stands (the GM may not see the owner's name on it). */
    const paidBy = (o: Order) => o.tenders.map((t) => [t.method, t.amount]);
    expect(paidBy(after)).toEqual(paidBy(bill));
    expect(after.lines.map((l) => l.kotStatus)).toEqual(bill.lines.map((l) => l.kotStatus));
    const [k] = await sql<{ no: number }>(
      "select max(kot_no)::int as no from pos_order_lines where order_id = $1", [bill.id]);
    expect((await call(gm, `/till/orders/${bill.id}/kot/${k!.no}`)).status, "its KOT stands").toBe(200);

    /* Out of the GM's own drawer, opened by the void as a refund opens it. */
    const [d] = await sql<{ expected: string; opening: string }>(
      `select app.cashier_expected_cash(id)::text as expected, opening_cash::text as opening
         from cashier_shifts where staff_id = $1 and closed_at is null`, [gm]);
    expect(Number(d!.expected)).toBe(Number(d!.opening) - bill.payable);
  });

  it("a UPI bill needs the refund's reference", async () => {
    const bill = await paidBill("upi", { method: "upi" });
    const no = await voidIt(gm, bill.id, { reason: "Paid twice" });
    expect(no.status).toBe(409);
    expect(((await no.json()) as { reason: string }).reason)
      .toBe("Give the refund's reference: the UPI reference or the card approval.");
    const yes = await voidIt(gm, bill.id, { reason: "Paid twice", reference: "UPI 4471 2209" });
    expect(yes.status, await yes.clone().text()).toBe(200);
    expect(((await yes.json()) as Order).voidReference).toBe("UPI 4471 2209");
  });

  it("a bill charged to a room is refused, naming the room", async () => {
    const rooms = (await (await call(owner, "/till/rooms")).json()) as {
      rooms: { room: string; folioId: string }[];
    };
    const target = rooms.rooms[0]!;
    const bill = await paidBill("room", { method: "room", room: target.room, folioId: target.folioId });
    const res = await voidIt(gm, bill.id, { reason: "wrong room" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason)
      .toBe(`This bill went to room ${target.room} - reverse it on the guest's bill.`);
  });

  it("only on the bill's own business day", async () => {
    const bill = await paidBill("yesterday", { method: "card" });
    /* Back after: the day's next order number counts the day's own bills. */
    await sql("update pos_orders set business_date = business_date - 1 where id = $1", [bill.id]);
    try {
      const res = await voidIt(gm, bill.id, { reason: "late", reference: "APPR 1" });
      expect(res.status).toBe(409);
      expect(((await res.json()) as { reason: string }).reason)
        .toMatch(/^Only a bill of today's business day can be voided\./);
    } finally {
      await sql("update pos_orders set business_date = business_date + 1 where id = $1", [bill.id]);
    }
  });

  it("reprints VOID, and the day's report shows who, when, why and how much", async () => {
    const bill = await paidBill("report", { method: "cash" });
    expect((await voidIt(gm, bill.id, { reason: "Guest complaint" })).status).toBe(200);

    const print = await call(gm, `/till/orders/${bill.id}/bill-print`, {});
    expect(print.status, await print.clone().text()).toBe(200);
    expect(((await print.json()) as { heading: string }).heading).toBe("void");

    const day = (await (await call(gm, "/till/day-end")).json()) as {
      voided: { orderNo: string; by: string | null; at: string; reason: string; amount: number;
                method: string | null; cash: number }[];
    };
    const line = day.voided.find((v) => v.orderNo === bill.orderNo);
    expect(line).toMatchObject({
      by: "VOIDPAID Manager", reason: "Guest complaint", amount: bill.payable, method: "cash",
      cash: bill.payable,
    });
    expect(line!.at).toMatch(/^\d{2}:\d{2}$/);
  });

  it("is refused once the restaurant's day is closed", async () => {
    const bill = await paidBill("closed", { method: "cash" });
    await sql(
      `update pos_day_ends d set counted_cash = 0, closed_by = $1, closed_at = now()
         from pos_outlets o, hotels h
        where o.id = d.outlet_id and h.id = d.hotel_id and h.code = '5EL' and o.code = 'REST'
          and d.business_date = app.business_date(h.id)`, [owner]);
    try {
      const res = await voidIt(gm, bill.id, { reason: "late" });
      expect(res.status).toBe(409);
      expect(((await res.json()) as { reason: string }).reason)
        .toBe("The restaurant's day is closed and its drawer counted. A bill of a closed day cannot be voided.");
    } finally {
      /* A closed day stays closed (050's trigger): opened again for the
         files after this one, by the superuser, the trigger off. */
      await sql("alter table pos_day_ends disable trigger pos_day_ends_final");
      try {
        await sql(
          `update pos_day_ends d set counted_cash = null, closed_by = null, closed_at = null
             from pos_outlets o, hotels h
            where o.id = d.outlet_id and h.id = d.hotel_id and h.code = '5EL' and o.code = 'REST'
              and d.business_date = app.business_date(h.id)`);
      } finally {
        await sql("alter table pos_day_ends enable trigger pos_day_ends_final");
      }
    }
  });
});
