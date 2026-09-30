import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE KITCHEN'S TWO BUTTONS, AND READY FOR THE WAITER (D27-221, D27-222)

   The kitchen starts a dish and makes it Ready; nothing more. A Ready
   dish is the waiter's: Tables counts it on the table's tile, and the
   waiter's "Taken" serves it - only a ready dish, and saying why not.

   On the demo's free tables AC9, AC10 and B2, one per test, and a waiter
   of its own; the orders are abandoned afterwards.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";

let owner = "";
let waiter = "";
let roti = "";
let pau = "";
let butter = "";
let onions = "";
const orders: string[] = [];

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}
const call = (who: string, method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method,
    headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const post = (who: string, path: string, body: unknown = {}) => call(who, "POST", path, body);
const reason = async (res: Response) => ((await res.json()) as { reason?: string }).reason ?? "";

type Line = { id: string; name: string; parentLineId: string | null; kotStatus: string };
/** Butter Roti x2 and a Bhaaji Pau (Butter) with Onions, sent to the kitchen. */
async function sentOrder(table: string): Promise<{ id: string; dishes: Line[] }> {
  const res = await post(owner, "/till/orders", { outlet: "REST", table });
  expect(res.status, await res.clone().text()).toBe(200);
  const id = ((await res.json()) as { id: string }).id;
  orders.push(id);
  await post(owner, `/till/orders/${id}/lines`, { itemId: roti, qty: 2 });
  await post(owner, `/till/orders/${id}/lines`,
    { itemId: pau, qty: 1, variationId: butter, addonIds: [onions] });
  const kot = await post(owner, `/till/orders/${id}/kot`);
  expect(kot.status, await kot.clone().text()).toBe(200);
  const lines = ((await kot.json()) as { lines: Line[] }).lines;
  return { id, dishes: lines.filter((l) => l.parentLineId === null) };
}
async function readyOn(table: string): Promise<number> {
  const res = await call(owner, "GET", "/till/floor");
  const body = (await res.json()) as { sections: { tables: { label: string; ready: number }[] }[] };
  return body.sections.flatMap((s) => s.tables).find((t) => t.label === table)!.ready;
}

beforeAll(async () => {
  owner = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  waiter = (await sql<{ id: string }>(
    `insert into staff (email, full_name, firebase_uid)
     values ('k2-waiter@fidato.in', 'K2 waiter', 'test-uid-k2-waiter')
     on conflict (email) do update set is_active = true returning id::text`))[0]!.id;
  await sql("delete from staff_hotels where staff_id = $1", [waiter]);
  await sql(`insert into staff_hotels (staff_id, hotel_id, role)
             select $1, id, 'pos' from hotels where code = '5EL'`, [waiter]);

  const res = await call(owner, "GET", "/till/menu");
  type Item = { id: string; name: string; variations: { id: string; label: string }[];
    addonGroups: { addons: { id: string; label: string }[] }[] };
  const items = ((await res.json()) as { categories: { items: Item[] }[] })
    .categories.flatMap((c) => c.items);
  roti = items.find((i) => i.name === "Butter Roti")!.id;
  const p = items.find((i) => i.name === "Bhaaji Pau")!;
  pau = p.id;
  butter = p.variations.find((v) => v.label === "Butter")!.id;
  onions = p.addonGroups.flatMap((g) => g.addons).find((a) => a.label === "Onions")!.id;
});

afterAll(async () => {
  for (const id of orders) await post(owner, `/till/orders/${id}/abandon`, { reason: "kitchen two test" });
  await sql("delete from staff_hotels where staff_id = $1", [waiter]);
  await sql("update staff set is_active = false where id = $1", [waiter]);
  await closePool();
});

describe("the kitchen has two buttons (D27-222, Q2)", () => {
  it("starts and readies a dish, and cannot serve one", async () => {
    const { dishes } = await sentOrder("B2");
    const dish = dishes[0]!;
    expect((await post(owner, `/kitchen/lines/${dish.id}/preparing`)).status).toBe(200);
    expect((await post(owner, `/kitchen/lines/${dish.id}/ready`)).status).toBe(200);
    const served = await post(owner, `/kitchen/lines/${dish.id}/served`);
    expect(served.status, "the kitchen served a dish").toBe(409);
    expect(await reason(served)).toMatch(/starts a dish or makes it ready/);
  });
});

describe("Ready, on Tables and Taken by the waiter (D27-221, D27-222)", () => {
  it("Tables counts the ready dishes on the table, not their sides", async () => {
    const { dishes } = await sentOrder("AC9");
    expect(await readyOn("AC9")).toBe(0);
    for (const d of dishes) await post(owner, `/kitchen/lines/${d.id}/ready`);
    expect(await readyOn("AC9"), "2 rotis and a pau are 3 dishes; the onions are not one").toBe(3);
  });

  it("the waiter's Taken serves only ready food, says why otherwise, and clears the count", async () => {
    const { id, dishes } = await sentOrder("AC10");
    const [rotiLine, pauLine] = [dishes.find((d) => d.name === "Butter Roti")!,
      dishes.find((d) => d.name.startsWith("Bhaaji Pau"))!];
    await post(owner, `/kitchen/lines/${rotiLine.id}/ready`);

    const early = await post(waiter, `/till/orders/${id}/taken`, { lineIds: [rotiLine.id, pauLine.id] });
    expect(early.status, "a dish still in the kitchen was taken").toBe(409);
    expect(await reason(early)).toMatch(/Bhaaji Pau \(Butter\) is not ready yet/);
    expect(await readyOn("AC10"), "a refused Taken took the roti anyway").toBe(2);

    const taken = await post(waiter, `/till/orders/${id}/taken`, { lineIds: [rotiLine.id] });
    expect(taken.status, await taken.clone().text()).toBe(200);
    expect(await readyOn("AC10")).toBe(0);
    const status = (await sql<{ kot_status: string }>(
      "select kot_status from pos_order_lines where id = $1", [rotiLine.id]))[0]!.kot_status;
    expect(status).toBe("served");

    const again = await post(waiter, `/till/orders/${id}/taken`, { lineIds: [rotiLine.id] });
    expect(again.status).toBe(409);
    expect(await reason(again)).toMatch(/already taken/);
  });
});
