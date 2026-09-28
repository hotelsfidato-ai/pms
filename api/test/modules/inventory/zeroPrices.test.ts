import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   X-1 · A PRICE OF 0 ONLY WHEN TICKED FREE (the owner's D27-120)

   The QA of 28 September typed 0 and it was saved without a question:
   the rack rate (RT-1), the pricing base (RT-2), a dish (POS-5), a
   delivery's cost (ST-1), a purchase line (ST-2). The owner: refused
   unless ticked "Free"; blank means not priced yet. The same at every
   door, and the rate calendar's extra adult and child with their own
   ticks. Each refusal writes nothing.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const TAG = `X1-${process.pid}`;
let typeId = "";
let rack = "";
let categoryId = "";
let itemId = "";
let storeId = "";

const call = (method: string, path: string, body: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method,
    headers: { "x-dev-staff-id": "dev-owner", "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const refusedAsNotFree = async (res: Response) => {
  expect(res.status).toBe(409);
  expect(((await res.json()) as { reason: string }).reason)
    .toBe("0 is kept only when it is ticked Free. Leave it blank if nobody has priced it yet.");
};

beforeAll(async () => {
  [{ id: typeId, rack }] = await sql<{ id: string; rack: string }>(
    `select rt.id::text, rt.base_rate::text as rack from room_types rt join hotels h on h.id = rt.hotel_id
      where h.code = '5EL' and rt.base_rate is not null order by rt.name limit 1`) as [{ id: string; rack: string }];
  [{ id: categoryId }] = await sql<{ id: string }>(
    `select c.id::text from pos_menu_categories c join hotels h on h.id = c.hotel_id
      where h.code = '5EL' order by c.name limit 1`) as [{ id: string }];
  /* The demo keeps no stock at 5EL: an item of this run's own. */
  const made = await call("POST", "/stores/items", { name: `${TAG} Rice`, unit: "kg" });
  expect(made.status, await made.clone().text()).toBe(200);
  [{ id: itemId }] = await sql<{ id: string }>(
    "select id::text from stock_items where name = $1", [`${TAG} Rice`]) as [{ id: string }];
  [{ id: storeId }] = await sql<{ id: string }>(
    `select l.id::text from locations l join hotels h on h.id = l.hotel_id
      where h.code = '5EL' and l.kind = 'store' and l.is_active order by l.name limit 1`) as [{ id: string }];
});

afterAll(async () => {
  await sql("update room_types set base_rate = $2 where id = $1", [typeId, rack]);
  await sql("delete from rates where label = $1", [TAG]);
  await sql("delete from pos_menu_items where name like $1", [`${TAG}%`]);
  await sql("delete from stock_items where name like $1", [`${TAG}%`]);
  await closePool();
});

describe("X-1 · 0 only when ticked Free", () => {
  it("the rack rate: refused unticked, kept at 0 ticked (RT-1)", async () => {
    await refusedAsNotFree(await call("PUT", `/room-types/${typeId}/rate`, { rate: 0 }));
    expect((await sql<{ r: string }>("select base_rate::text as r from room_types where id = $1", [typeId]))[0]!.r)
      .toBe(rack);
    const free = await call("PUT", `/room-types/${typeId}/rate`, { rate: 0, free: true });
    expect(free.status, await free.clone().text()).toBe(200);
  });

  it("a season on Rate plans, and the rate calendar's price and extra adult and child", async () => {
    await refusedAsNotFree(await call("POST", "/rate-plans",
      { roomTypeId: typeId, mealPlan: "EP", price: 0, from: "2031-01-01", label: TAG }));
    const grid = { roomTypeId: typeId, mealPlan: "EP", from: "2031-02-01", to: "2031-02-02", label: TAG };
    await refusedAsNotFree(await call("PUT", "/rate-grid", { ...grid, price: 0 }));
    await refusedAsNotFree(await call("PUT", "/rate-grid", { ...grid, price: 3000, extraChild: 0 }));
    const ticked = await call("PUT", "/rate-grid",
      { ...grid, price: 3000, extraChild: 0, extraChildFree: true });
    expect(ticked.status, await ticked.clone().text()).toBe(200);
  });

  it("the pricing base (RT-2)", async () => {
    await refusedAsNotFree(await call("PUT", "/pricing/base", { from: "2031-03-01", price: 0 }));
  });

  it("a dish (POS-5): refused unticked, on the menu at 0 ticked", async () => {
    await refusedAsNotFree(await call("POST", "/till/menu/items",
      { categoryId, name: `${TAG} Welcome drink`, price: 0 }));
    const free = await call("POST", "/till/menu/items",
      { categoryId, name: `${TAG} Welcome drink`, price: 0, free: true });
    expect(free.status, await free.clone().text()).toBe(200);
  });

  it("a delivery's cost (ST-1) and a purchase line (ST-2)", async () => {
    await refusedAsNotFree(await call("POST", "/stores/movements",
      { itemId, locationId: storeId, kind: "receipt", quantity: 5, unitCost: 0 }));
    await refusedAsNotFree(await call("POST", "/purchasing/requests",
      { storeId, reason: `${TAG} test`, lines: [{ itemId, quantity: 1, unitPrice: 0 }] }));
  });

  /* A file has no tick, so 0 in one is refused line by line (dry runs,
     nothing written). */
  it("a room-types file and a menu file refuse 0 on the line", async () => {
    const types = await call("POST", "/room-types/import", { dryRun: true, rows: [
      { code: "X1Z", name: `${TAG} Suite`, baseOccupancy: "2", maxOccupancy: "3", rate: "0" }] });
    expect(((await types.json()) as { verdicts: { action: string; detail: string }[] }).verdicts[0])
      .toMatchObject({ action: "rejected", detail: expect.stringMatching(/0 is not taken from a file/) });
    const menu = await call("POST", "/till/menu/import", { dryRun: true, rows: [
      { category: "Starters", name: `${TAG} Water`, price: "0" }] });
    expect(((await menu.json()) as { verdicts: { action: string; detail: string }[] }).verdicts[0])
      .toMatchObject({ action: "rejected", detail: expect.stringMatching(/0 is not taken from a file/) });
  });
});
