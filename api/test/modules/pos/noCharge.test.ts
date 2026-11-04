import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { openTillDay } from "../../drawer.ts";

/* ══════════════════════════════════════════════════════════════════
   A RESTAURANT BILL GIVEN FREE: NC (the owner's D27-351, 21 October)

   The owner, an administrator or the GM closes an OPEN bill as NC - no
   charge - with a reason; their name on it is the approval. It prints the
   dishes with no prices, marked NC; it is no sale and carries no value
   anywhere; Close restaurant day names who gave it, when and why. The
   KOTs stay: the kitchen made the food. Migration 233 is the database's
   half (db/tests/modules/pos.sql, "pos nc").
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "NCBILL";
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
  id: string; orderNo: string; status: string; businessDate: string;
  ncBy: string | null; ncAt: string | null; ncReason: string | null;
  lines: { kotStatus: string }[];
}

/** An open bill of one Paneer Tikka, sent to the kitchen. */
async function openBill(table: string, by = owner): Promise<Order> {
  const opened = await call(by, "/till/orders", { outlet: "REST", table: `${TAG} ${table}` });
  expect(opened.status, await opened.clone().text()).toBe(200);
  const { id } = (await opened.json()) as { id: string };
  expect((await call(by, `/till/orders/${id}/lines`, { itemId: tikka, qty: 1 })).status).toBe(200);
  const sent = await call(by, `/till/orders/${id}/kot`, {});
  expect(sent.status).toBe(200);
  return (await (await call(by, `/till/orders/${id}`)).json()) as Order;
}

const nc = (who: string, id: string, body: Record<string, unknown>) =>
  call(who, `/till/orders/${id}/no-charge`, body);

const sales = async () => (await sql<{ n: number; v: string }>(
  `select settled_orders as n, settled_value::text as v
     from app.pos_day_summary(
       (select o.id from pos_outlets o join hotels h on h.id = o.hotel_id
         where h.code = '5EL' and o.code = 'REST'),
       (select app.business_date(id) from hotels where code = '5EL'))`))[0]!;

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
  gm = await person("nc-gm@fidato.in", "NCBILL Manager", "gm");
  waiter = await person("nc-waiter@fidato.in", "NCBILL Waiter", "pos");
  const res = await call(owner, "/till/menu");
  const menu = (await res.json()) as { categories: { items: { id: string; name: string }[] }[] };
  tikka = menu.categories.flatMap((c) => c.items).find((i) => i.name === "Paneer Tikka")!.id;
  putAwayTillDay = await openTillDay("5EL");
});

afterAll(async () => {
  await putAwayTillDay();
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try {
    await db.query("alter table pos_order_lines disable trigger pos_order_lines_frozen");
    /* The lines first: a kitchen timing goes only once its line has (080). */
    await db.query(
      "delete from pos_order_lines where order_id in (select id from pos_orders where table_ref like $1)",
      [`${TAG}%`]);
    await db.query("delete from pos_orders where table_ref like $1", [`${TAG}%`]);
    await db.query("delete from staff_hotels where staff_id = any($1::uuid[])", [[gm, waiter]]);
  } finally {
    await db.query("alter table pos_order_lines enable trigger pos_order_lines_frozen");
    await db.end();
  }
  await closePool();
});

describe("NC: a restaurant bill given free", () => {
  it("is refused to a waiter, by the server", async () => {
    const bill = await openBill("waiter", waiter);
    const res = await nc(waiter, bill.id, { reason: "staff meal" });
    expect(res.status).toBe(403);
    const [o] = await sql<{ status: string }>("select status from pos_orders where id = $1", [bill.id]);
    expect(o!.status).toBe("open");
  });

  it("needs a reason", async () => {
    const bill = await openBill("no reason");
    const res = await nc(gm, bill.id, { reason: "  " });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason)
      .toBe("Say why this bill is no charge. The reason prints on the bill.");
  });

  it("the GM gives it: NC with who, when and why, the table freed, the KOT kept, and no sale", async () => {
    const bill = await openBill("given");
    const before = await sales();
    const res = await nc(gm, bill.id, { reason: "Owner's guests" });
    expect(res.status, await res.clone().text()).toBe(200);
    const after = (await res.json()) as Order;
    expect(after.status).toBe("no_charge");
    expect(after.orderNo).toBe(bill.orderNo);
    expect([after.ncBy, after.ncReason]).toEqual(["NCBILL Manager", "Owner's guests"]);
    expect(after.ncAt).toMatch(/^\d{2}:\d{2}$/);
    expect(after.lines.map((l) => l.kotStatus)).toEqual(bill.lines.map((l) => l.kotStatus));
    const [o] = await sql<{ cleared: boolean }>(
      "select cleared_at is not null as cleared from pos_orders where id = $1", [bill.id]);
    expect(o!.cleared, "its table is freed").toBe(true);
    expect(await sales(), "no sale, no value").toEqual(before);

    const again = await nc(gm, bill.id, { reason: "twice" });
    expect(((await again.json()) as { reason: string }).reason).toBe("This bill is already NC.");
  });

  it("prints NC, is listed with the earlier days' bills, and Close restaurant day names who, when and why", async () => {
    const bill = await openBill("report");
    expect((await nc(owner, bill.id, { reason: "Staff meal" })).status).toBe(200);

    const print = await call(gm, `/till/orders/${bill.id}/bill-print`, {});
    expect(print.status, await print.clone().text()).toBe(200);
    expect(((await print.json()) as { heading: string }).heading).toBe("nc");

    /* D27-394: its value is the menu prices before tax - shown as NC, never a sale. */
    expect(bill.net).toBeGreaterThan(0);
    const earlier = (await (await call(gm, `/till/bills?date=${bill.businessDate}`)).json()) as {
      bills: { orderNo: string; status: string; net: number }[];
    };
    expect(earlier.bills.find((b) => b.orderNo === bill.orderNo))
      .toMatchObject({ status: "no_charge", net: bill.net });

    const day = (await (await call(gm, "/till/day-end")).json()) as {
      noCharge: Record<string, unknown>[];
    };
    const line = day.noCharge.find((v) => v.orderNo === bill.orderNo);
    expect(line).toMatchObject({ table: `${TAG} report`, reason: "Staff meal", value: bill.net });
    expect(line!.at).toMatch(/^\d{2}:\d{2}$/);
    expect(Object.keys(line!), "no amount paid on it").not.toContain("amount");

    /* The Night audit report: its own section with the value and a total. */
    const doc = (await (await call(gm, `/reports/night-audit?asOn=${bill.businessDate}`)).json()) as {
      sections: { key: string; columns: { key: string }[]; rows: { kind: string; cells: Record<string, unknown> }[] }[];
    };
    const section = doc.sections.find((x) => x.key === "pos-no-charge")!;
    expect(section.columns.map((c) => c.key)).toContain("value");
    expect(section.rows.find((r) => r.cells["orderNo"] === bill.orderNo)?.cells["value"]).toBe(bill.net);
    const total = section.rows.find((r) => r.kind === "total")!;
    expect(total.cells["value"]).toBe(Math.round(section.rows.filter((r) => r.kind === "row")
      .reduce((t, r) => t + Number(r.cells["value"]), 0) * 100) / 100);
  });

  it("only an open bill: a paid one is refused", async () => {
    const bill = await openBill("paid");
    expect((await call(owner, `/till/orders/${bill.id}/settle`, { method: "card" })).status).toBe(200);
    const res = await nc(gm, bill.id, { reason: "late" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toBe("This bill is already settled.");
  });
});
