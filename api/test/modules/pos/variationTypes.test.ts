import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   A DISH WITH SEVERAL VARIATION TYPES (D27-189, D27-192, D27-195)

   Pizza: Size (Regular ₹200 / Large ₹400) and an Option headed "Crust"
   (Cheese burst +₹80 / Regular Free). The first type carries the price,
   the second adds to it; the waiter picks one of each; the kitchen reads
   every choice in the line's name. The same name may be in both types.

   Made in its own section and switched off afterwards, as menuOptions.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";

let owner = "";
let categoryId = "";
const orders: string[] = [];

const call = (method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL/till${path}`, {
    method,
    headers: { "x-dev-staff-id": owner, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const reason = async (res: Response) => ((await res.json()) as { reason?: string }).reason ?? "";

type Choice = { id: string; label: string; price: number; typeNo: number;
                kind: string | null; heading: string | null };
async function choices(id: string): Promise<Choice[]> {
  const body = (await (await call("GET", "/menu")).json()) as {
    categories: { items: { id: string; variations: Choice[] }[] }[] };
  return body.categories.flatMap((c) => c.items).find((i) => i.id === id)!.variations;
}

const SIZE = { kind: "size", choices: [{ label: "Regular", price: 200 }, { label: "Large", price: 400 }] };
const CRUST = { kind: "option", heading: "Crust",
                choices: [{ label: "Cheese burst", price: 80 }, { label: "Regular", free: true }] };

async function pizza(): Promise<{ dish: string; large: string; burst: string; plain: string }> {
  const made = await call("POST", "/menu/items",
    { categoryId, name: `VTYPES Pizza ${orders.length}`, price: "1", taxRate: 5 });
  const dish = ((await made.json()) as { id: string }).id;
  const res = await call("PUT", `/menu/items/${dish}/variations`, { types: [SIZE, CRUST] });
  expect(res.status, await res.clone().text()).toBe(200);
  const all = await choices(dish);
  const find = (typeNo: number, label: string) =>
    all.find((c) => c.typeNo === typeNo && c.label === label)!.id;
  return { dish, large: find(1, "Large"), burst: find(2, "Cheese burst"), plain: find(2, "Regular") };
}

async function open(): Promise<string> {
  const res = await call("POST", "/orders", { outlet: "REST", table: "VTYPES" });
  const id = ((await res.json()) as { id: string }).id;
  orders.push(id);
  return id;
}

type Line = { name: string; qty: number; unitPrice: number; voided: boolean };
async function ring(order: string, body: Record<string, unknown>) {
  return call("POST", `/orders/${order}/lines`, { qty: 1, ...body });
}
const linesOf = async (res: Response) =>
  ((await res.json()) as { lines: Line[] }).lines.map((l) => [l.name, l.qty, l.unitPrice]);

beforeAll(async () => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try {
    owner = (await db.query("select id::text from staff where email = 'owner@fidato.in'")).rows[0].id;
  } finally { await db.end(); }
  const res = await call("POST", "/menu/categories", { name: "VTYPES section" });
  categoryId = ((await res.json()) as { id: string }).id;
});

afterAll(async () => {
  for (const id of orders) await call("POST", `/orders/${id}/abandon`, { reason: "types test" });
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try {
    await db.query("update pos_menu_items set is_active = false where category_id = $1", [categoryId]);
    await db.query("update pos_menu_categories set is_active = false where id = $1", [categoryId]);
  } finally { await db.end(); }
  await closePool();
});

describe("the form's set: kinds, headings, and a name in two types", () => {
  it("keeps each choice's type, kind and heading - Regular in both", async () => {
    const { dish } = await pizza();
    expect((await choices(dish)).map((c) => [c.typeNo, c.kind, c.heading, c.label, c.price])).toEqual([
      [1, "size", null, "Regular", 200],
      [1, "size", null, "Large", 400],
      [2, "option", "Crust", "Cheese burst", 80],
      [2, "option", "Crust", "Regular", 0],
    ]);
  });

  it("refuses a type with no kind picked, and an Option with no heading", async () => {
    const { dish } = await pizza();
    const bare = await call("PUT", `/menu/items/${dish}/variations`,
      { types: [{ choices: [{ label: "Small", price: 100 }] }] });
    expect(bare.status).toBe(409);
    expect(await reason(bare)).toMatch(/pick Size, Quantity or Option/);
    const headless = await call("PUT", `/menu/items/${dish}/variations`,
      { types: [SIZE, { ...CRUST, heading: "  " }] });
    expect(headless.status).toBe(409);
    expect(await reason(headless)).toMatch(/an Option needs a heading/);
    expect((await choices(dish)).length, "a refused set changed the menu").toBe(4);
  });
});

describe("ringing it: one of each type, priced first + added", () => {
  it("Large with a Cheese burst is one Pizza at ₹480, every choice in its name", async () => {
    const { dish, large, burst } = await pizza();
    const o = await open();
    const res = await ring(o, { itemId: dish, variationId: large, moreChoiceIds: [burst] });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await linesOf(res)).toEqual([[`VTYPES Pizza ${orders.length - 1} (Large, Cheese burst)`, 1, 480]]);
  });

  it("refuses a Large with no crust, naming the crust", async () => {
    const { dish, large } = await pizza();
    const o = await open();
    const res = await ring(o, { itemId: dish, variationId: large });
    expect(res.status).toBe(409);
    expect(await reason(res)).toMatch(/choose one crust/);
  });

  it("the same choices twice are one line of 2; a different crust is another line", async () => {
    const { dish, large, burst, plain } = await pizza();
    const o = await open();
    await ring(o, { itemId: dish, variationId: large, moreChoiceIds: [burst] });
    await ring(o, { itemId: dish, variationId: large, moreChoiceIds: [burst] });
    const res = await ring(o, { itemId: dish, variationId: large, moreChoiceIds: [plain] });
    const name = `VTYPES Pizza ${orders.length - 1}`;
    expect(await linesOf(res)).toEqual([
      [`${name} (Large, Cheese burst)`, 2, 480],
      [`${name} (Large, Regular)`, 1, 400],
    ]);
  });
});
