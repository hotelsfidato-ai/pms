import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   COUNT IN, AT EVERY CASH POINT - the owner's D27-190, 30 September

   The day opens by counting the float, and no cash is taken before it.
   At the desk the drawer already refused cash until it was open (D27-118)
   but opened a blank float as ₹0 - a figure nobody counted. At the till
   there was no opening at all (D27-139): cash was taken all day and the
   float typed at night, 0 if left blank. Everything here is tagged
   CASHIN and removed afterwards.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "CASHIN";
let owner = "";
let tikka = "";

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const post = (path: string, body: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method: "POST",
    headers: { "x-dev-staff-id": owner, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const outletDays = () => sql<{ n: number }>(
  `select count(*)::int as n from pos_day_ends d join pos_outlets o on o.id = d.outlet_id
    join hotels h on h.id = o.hotel_id
   where h.code = '5EL' and o.code = 'REST' and d.business_date = app.business_date(h.id)`)
  .then((r) => r[0]!.n);

/** A till bill with one dish on it, ready to settle. */
async function bill(n: number): Promise<string> {
  const opened = await post("/till/orders", { outlet: "REST", table: `${TAG} ${n}` });
  expect(opened.status, await opened.clone().text()).toBe(200);
  const { id } = (await opened.json()) as { id: string };
  expect((await post(`/till/orders/${id}/lines`, { itemId: tikka, qty: 1 })).status).toBe(200);
  return id;
}

beforeAll(async () => {
  owner = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  const res = await app.request("/api/hotels/5EL/till/menu", { headers: { "x-dev-staff-id": owner } });
  const menu = (await res.json()) as { categories: { items: { id: string; name: string }[] }[] };
  tikka = menu.categories.flatMap((c) => c.items).find((i) => i.name === "Paneer Tikka")!.id;
  await sql("delete from cashier_shifts where staff_id = $1 and closed_at is null", [owner]);
  await sql(`delete from pos_day_ends where outlet_id in (select id from pos_outlets where code = 'REST')`);
});

afterAll(async () => {
  await sql("delete from cashier_shifts where staff_id = $1 and closed_at is null", [owner]);
  await sql(`delete from pos_day_ends where outlet_id in (select id from pos_outlets where code = 'REST')`);
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try {
    await db.query("alter table pos_order_tenders disable trigger pos_order_tenders_no_delete_settled");
    await db.query("alter table pos_order_lines disable trigger pos_order_lines_frozen");
    await db.query("delete from pos_orders where table_ref like $1", [`${TAG}%`]);
  } finally {
    await db.query("alter table pos_order_lines enable trigger pos_order_lines_frozen");
    await db.query("alter table pos_order_tenders enable trigger pos_order_tenders_no_delete_settled");
    await db.end();
  }
  await closePool();
});

describe("the desk's drawer opens on a counted float", () => {
  it("refuses a blank float, and opens nothing", async () => {
    const res = await post("/cashier-shift/open", {});
    expect(res.status, await res.clone().text()).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toMatch(/Count the opening float/);
    const [n] = await sql<{ n: number }>(
      "select count(*)::int as n from cashier_shifts where staff_id = $1 and closed_at is null", [owner]);
    expect(n!.n).toBe(0);
  });

  it("opens on 0 when 0 is what was counted", async () => {
    const res = await post("/cashier-shift/open", { opening: 0 });
    expect(res.status, await res.clone().text()).toBe(200);
  });
});

describe("the till's day opens on a counted float (D27-190)", () => {
  it("takes no cash before the day is opened; a card goes on", async () => {
    const cash = await post(`/till/orders/${await bill(1)}/settle`, { method: "cash" });
    expect(cash.status, await cash.clone().text()).toBe(409);
    expect(((await cash.json()) as { reason: string }).reason).toMatch(/Open the restaurant's day first/);
    /* Part of a split in cash is cash too. */
    const split = await post(`/till/orders/${await bill(2)}/settle`, {
      tenders: [{ method: "card", amount: 1 }, { method: "cash", amount: 1 }] });
    expect(split.status, await split.clone().text()).toBe(409);
    const card = await post(`/till/orders/${await bill(3)}/settle`, { method: "card" });
    expect(card.status, await card.clone().text()).toBe(200);
    expect(await outletDays()).toBe(0);
  });

  it("counts nothing at night before the day is opened", async () => {
    const res = await post("/till/day-end/count", { denominations: [{ value: 500, count: 1 }] });
    expect(res.status, await res.clone().text()).toBe(409);
    expect(await outletDays()).toBe(0);
  });

  it("refuses a blank float, opens once on a counted one, and then takes cash", async () => {
    expect((await post("/till/day-end/open", {})).status).toBe(409);
    expect(await outletDays()).toBe(0);

    const open = await post("/till/day-end/open", { opening: 1500 });
    expect(open.status, await open.clone().text()).toBe(200);
    const again = await post("/till/day-end/open", { opening: 900 });
    expect(again.status).toBe(409);
    const [day] = await sql<{ opening: string }>(
      `select d.opening_cash::text as opening from pos_day_ends d
         join pos_outlets o on o.id = d.outlet_id where o.code = 'REST'`);
    expect(Number(day!.opening)).toBe(1500);

    const view = await app.request("/api/hotels/5EL/till/day-end", { headers: { "x-dev-staff-id": owner } });
    expect(((await view.json()) as { opened: boolean }).opened).toBe(true);

    const cash = await post(`/till/orders/${await bill(4)}/settle`, { method: "cash" });
    expect(cash.status, await cash.clone().text()).toBe(200);
  });
});
