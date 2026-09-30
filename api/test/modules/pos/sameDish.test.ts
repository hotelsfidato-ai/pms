import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE SAME DISH TWICE IS ONE LINE OF TWO (D27-189, the owner, 30 Sep)

   "It just keeps adding new dishes." Tapping an unsent dish adds to its
   quantity; a dish with a variation or sides is the same only when its
   choices are the same; once the kitchen has it, more of it is a new
   line for the next docket (D27-148) - one, however many presses.

   On the demo's Bhaaji Pau (Oil / Butter, Sides), on orders of its own
   that are abandoned afterwards.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";

let owner = "";
let pau = "";
let butter = "";
let onions = "";
let curd = "";
let roti = "";
const orders: string[] = [];

const post = (path: string, body: unknown = {}) =>
  app.request(`/api/hotels/5EL/till${path}`, {
    method: "POST",
    headers: { "x-dev-staff-id": owner, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

async function open(): Promise<string> {
  const res = await post("/orders", { outlet: "REST", table: "SAMEDISH" });
  expect(res.status, await res.clone().text()).toBe(200);
  const id = ((await res.json()) as { id: string }).id;
  orders.push(id);
  return id;
}
async function add(orderId: string, body: Record<string, unknown>) {
  const res = await post(`/orders/${orderId}/lines`, { qty: 1, ...body });
  expect(res.status, await res.clone().text()).toBe(200);
}
/** [name, qty, kot status]: each dish as it went on, then its sides by name. */
const lines = async (orderId: string) => (await sql<{ name: string; qty: string; kot_status: string }>(
  `select name, qty::text, kot_status from pos_order_lines
    where order_id = $1 and not voided order by added_at, parent_line_id nulls first, name`,
  [orderId])).map((l) => [l.name, Number(l.qty), l.kot_status]);

beforeAll(async () => {
  owner = (await sql<{ id: string }>(
    "select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  const res = await app.request("/api/hotels/5EL/till/menu",
    { headers: { "x-dev-staff-id": owner } });
  type Item = { id: string; name: string; variations: { id: string; label: string }[];
    addonGroups: { addons: { id: string; label: string }[] }[] };
  const items = ((await res.json()) as { categories: { items: Item[] }[] })
    .categories.flatMap((c) => c.items);
  const p = items.find((i) => i.name === "Bhaaji Pau")!;
  pau = p.id;
  butter = p.variations.find((v) => v.label === "Butter")!.id;
  const sides = p.addonGroups.flatMap((g) => g.addons);
  onions = sides.find((a) => a.label === "Onions")!.id;
  curd = sides.find((a) => a.label === "Curd")!.id;
  roti = items.find((i) => i.name === "Butter Roti")!.id;
});

afterAll(async () => {
  for (const id of orders) await post(`/orders/${id}/abandon`, { reason: "same dish test" });
  await closePool();
});

describe("D27-189: the same dish is one line", () => {
  it("the same variation and sides twice is one line of 2, sides and all; other sides are another line", async () => {
    const o = await open();
    const choice = { itemId: pau, variationId: butter };
    await add(o, { ...choice, addonIds: [onions, curd] });
    await add(o, { ...choice, addonIds: [curd, onions] });
    await add(o, { ...choice, addonIds: [onions] });
    expect(await lines(o), "the same choices went on as a second line").toEqual([
      ["Bhaaji Pau (Butter)", 2, "pending"],
      ["Sides: Curd", 2, "pending"],
      ["Sides: Onions", 2, "pending"],
      ["Bhaaji Pau (Butter)", 1, "pending"],
      ["Sides: Onions", 1, "pending"],
    ]);
  });

  it("+ on a dish the kitchen has, pressed twice, is ONE new line of 2 for the next docket", async () => {
    const o = await open();
    await add(o, { itemId: roti });
    expect((await post(`/orders/${o}/kot`)).status).toBe(200);
    const [sent] = await sql<{ id: string }>(
      "select id::text from pos_order_lines where order_id = $1", [o]);
    /* The sent line stays at 1, so each press of its + asks for 2. */
    for (let press = 0; press < 2; press++) {
      const res = await post(`/orders/${o}/lines/${sent!.id}/qty`, { qty: 2 });
      expect(res.status, await res.clone().text()).toBe(200);
    }
    expect(await lines(o), "each press started its own line").toEqual([
      ["Butter Roti", 1, "sent"],
      ["Butter Roti", 2, "pending"],
    ]);
  });

  it("+ on a sent dish with sides copies them onto the new line (D27-192, Q7)", async () => {
    const o = await open();
    await add(o, { itemId: pau, variationId: butter, addonIds: [onions] });
    expect((await post(`/orders/${o}/kot`)).status).toBe(200);
    const [dish] = await sql<{ id: string }>(
      "select id::text from pos_order_lines where order_id = $1 and parent_line_id is null", [o]);
    const res = await post(`/orders/${o}/lines/${dish!.id}/qty`, { qty: 2 });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await lines(o)).toEqual([
      ["Bhaaji Pau (Butter)", 1, "sent"],
      ["Sides: Onions", 1, "sent"],
      ["Bhaaji Pau (Butter)", 1, "pending"],
      ["Sides: Onions", 1, "pending"],
    ]);
  });

  it("the quantity of an unsent dish takes its sides with it", async () => {
    const o = await open();
    await add(o, { itemId: pau, variationId: butter, addonIds: [onions] });
    const [dish] = await sql<{ id: string }>(
      "select id::text from pos_order_lines where order_id = $1 and parent_line_id is null", [o]);
    const res = await post(`/orders/${o}/lines/${dish!.id}/qty`, { qty: 3 });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await lines(o), "3 plates billed with 1 lot of onions").toEqual([
      ["Bhaaji Pau (Butter)", 3, "pending"],
      ["Sides: Onions", 3, "pending"],
    ]);
  });
});
