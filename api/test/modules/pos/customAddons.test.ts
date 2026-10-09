import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   CUSTOM ADD-ONS, AND ADD-ONS ON A DISH ALREADY SENT (the owner's D27-291)

   "A guest wants something we don't offer: type its name and price and add
   it to the dish, even a dish already sent." Its own line under the dish
   ("Veg Biryani 310 / + Extra papad 40"), its own quantity, the dish's own
   tax; after Send it waits for the next Send and that KOT names the dish.
   On a sent dish the numbered add-ons go on the same way. Anyone who takes
   orders may add one; a price is typed or Free is ticked - never a default.

   Numbers 801-899 are this file's, and go at the end.
   ══════════════════════════════════════════════════════════════════ */

let owner: string;
let waiter: string;
const orders: string[] = [];

const admin = async () =>
  new (await import("pg")).default.Pool({
    connectionString: process.env["SUPER_DATABASE_URL"]
      ?? "postgres://postgres:pw@127.0.0.1:55432/fidato",
  });

const asStaff = (who: () => string) => (path: string, init?: RequestInit) =>
  app.request(path, {
    ...init,
    headers: { "x-dev-staff-id": who(), "content-type": "application/json", ...(init?.headers ?? {}) },
  });
const as = asStaff(() => owner);
const post = (path: string, body?: unknown, method = "POST") =>
  as(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const waiterPost = (path: string, body?: unknown) =>
  asStaff(() => waiter)(path, { method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

type Line = {
  id: string; name: string; qty: number; unitPrice: number; taxRate: number;
  taxScheme: string; voided: boolean; kotStatus: string; parentLineId: string | null;
  isAddon: boolean; extra: "custom" | "numbered" | null;
};
type Order = { id: string; lines: Line[]; net: number };

const H = "/api/hotels/5EL/till";

async function dish(name: string) {
  const body = (await (await as(`${H}/menu`)).json()) as {
    categories: { items: { id: string; name: string; price: number; taxRate: number }[] }[];
  };
  const found = body.categories.flatMap((c) => c.items).find((i) => i.name === name);
  expect(found, `the demo menu has no "${name}"`).toBeTruthy();
  return found!;
}

async function openOrder(label: string) {
  const res = await post(`${H}/orders`, { outlet: "REST", table: `CUSTOMTEST ${label}` });
  expect(res.status, await res.clone().text()).toBe(200);
  const o = (await res.json()) as { id: string };
  orders.push(o.id);
  return o.id;
}

const order = async (id: string) => (await (await as(`${H}/orders/${id}`)).json()) as Order;
const dishes = (o: Order) => o.lines.filter((l) => !l.voided && !l.parentLineId);
const extrasOf = (o: Order, dishId: string) =>
  o.lines.filter((l) => l.parentLineId === dishId && l.extra !== null);
const reason = async (res: Response) => ((await res.json()) as { reason: string }).reason;

let biryani: Awaited<ReturnType<typeof dish>>;
let kebabId: string;

beforeAll(async () => {
  const db = await admin();
  try {
    owner = (await db.query<{ id: string }>(
      "select id from staff where email = 'owner@fidato.in'")).rows[0]!.id;
    waiter = (await db.query<{ id: string }>(
      `insert into staff (email, full_name, firebase_uid)
       values ('custom-waiter@fidato.in', 'CUSTOM waiter', 'test-uid-custom-waiter')
       on conflict (email) do update set is_active = true returning id::text`)).rows[0]!.id;
    await db.query("delete from staff_hotels where staff_id = $1", [waiter]);
    await db.query(`insert into staff_hotels (staff_id, hotel_id, role)
                    select $1, id, 'pos' from hotels where code = '5EL'`, [waiter]);
  } finally {
    await db.end();
  }
  biryani = await dish("Veg Biryani");
  const made = await post(`${H}/numbered-addons`, { number: 802, name: "Kebab", price: 120 });
  expect(made.status, await made.clone().text()).toBe(200);
  kebabId = ((await made.json()) as { addon: { id: string } }).addon.id;
});

afterAll(async () => {
  const db = await admin();
  try {
    for (const id of orders) {
      await db.query("delete from pos_order_lines where order_id = $1", [id]);
      await db.query("delete from pos_orders where id = $1", [id]);
    }
    await db.query(
      `delete from pos_numbered_addons
        where number between 801 and 899
          and hotel_id = (select id from hotels where code = '5EL')`);
    await db.query("delete from staff_hotels where staff_id = $1", [waiter]);
  } finally {
    await db.end();
  }
  await closePool();
});

describe("a custom add-on on a dish not yet sent", () => {
  it("is its own line under the dish, its own number, at the dish's tax", async () => {
    const id = await openOrder("1");
    const res = await post(`${H}/orders/${id}/lines`, {
      itemId: biryani.id, qty: 2,
      extras: [{ name: "  Extra   papad ", price: 40, qty: 1 }],
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const o = await order(id);
    const [line] = dishes(o);
    expect([line!.name, line!.qty]).toEqual(["Veg Biryani", 2]);
    const [papad] = extrasOf(o, line!.id);
    expect(papad).toMatchObject({
      name: "Extra papad", qty: 1, unitPrice: 40, taxRate: line!.taxRate,
      taxScheme: line!.taxScheme, extra: "custom", isAddon: false, kotStatus: "pending",
    });
    expect(o.net).toBe(2 * biryani.price + 40);
  });

  it("a dish with one is never \"one more\" of the plain dish, either way", async () => {
    const id = await openOrder("2");
    await post(`${H}/orders/${id}/lines`, { itemId: biryani.id, qty: 1 });
    await post(`${H}/orders/${id}/lines`, { itemId: biryani.id, qty: 1,
      extras: [{ name: "Extra papad", price: 40 }] });
    await post(`${H}/orders/${id}/lines`, { itemId: biryani.id, qty: 1 });
    const o = await order(id);
    expect(dishes(o).map((l) => l.qty), "the plain one went up; the papad plate stayed its own")
      .toEqual([2, 1]);
  });

  it("Free is a ticked 0; a blank or a bare 0 is refused, and nothing is written", async () => {
    const id = await openOrder("3");
    const free = await post(`${H}/orders/${id}/lines`, { itemId: biryani.id, qty: 1,
      extras: [{ name: "Extra onions", free: true }] });
    expect(free.status, await free.clone().text()).toBe(200);
    const o = await order(id);
    expect(extrasOf(o, dishes(o)[0]!.id)[0]).toMatchObject({ name: "Extra onions", unitPrice: 0 });

    const cases: [unknown, RegExp][] = [
      [{ name: "Ghee" }, /type a price, or tick Free\. A blank is not zero/],
      [{ name: "Ghee", price: "" }, /type a price, or tick Free/],
      [{ name: "Ghee", price: 0 }, /a price of 0 is Free - tick Free/],
      [{ name: "Ghee", price: -5 }, /less than nothing/],
      [{ name: "Ghee", price: 20, free: true }, /Free, or a price - not both/],
      [{ name: "   ", price: 20 }, /Type the add-on's name/],
      [{ name: "x".repeat(61), price: 20 }, /to 60 letters/],
      [{ name: "Ghee", price: 20, qty: 0 }, /one or more of it/],
      [{ name: "Ghee", price: 20.555 }, /rupees and paise/],
    ];
    for (const [extra, why] of cases) {
      const res = await post(`${H}/orders/${id}/lines`, { itemId: biryani.id, qty: 1, extras: [extra] });
      expect(res.status, JSON.stringify(extra)).toBe(409);
      expect(await reason(res), JSON.stringify(extra)).toMatch(why);
    }
    expect((await order(id)).lines, "every refusal came before the first write").toHaveLength(2);
  });
});

describe("an add-on on a dish the kitchen already has", () => {
  it("custom and numbered go under it, wait for the next Send, and that KOT names the dish", async () => {
    const id = await openOrder("4");
    await post(`${H}/orders/${id}/lines`, { itemId: biryani.id, qty: 1 });
    const first = await post(`${H}/orders/${id}/kot`);
    const firstNo = ((await first.json()) as { kotNo: number }).kotNo;
    const sent = dishes(await order(id))[0]!;

    const res = await waiterPost(`${H}/orders/${id}/lines`, {
      extraFor: sent.id,
      extras: [{ name: "Extra papad", price: 40 }, { numberedId: kebabId, qty: 2 }],
    });
    expect(res.status, `anyone who takes orders: ${await res.clone().text()}`).toBe(200);
    const o = await order(id);
    expect(extrasOf(o, sent.id).map((l) => [l.name, l.qty, l.unitPrice, l.extra, l.kotStatus]))
      .toEqual([
        ["Extra papad", 1, 40, "custom", "pending"],
        ["Kebab", 2, 120, "numbered", "pending"],
      ]);
    expect(dishes(o)[0]!.kotStatus, "the dish itself is untouched").toBe("sent");

    const second = await post(`${H}/orders/${id}/kot`);
    expect(second.status, await second.clone().text()).toBe(200);
    const kotNo = ((await second.json()) as { kotNo: number }).kotNo;
    const docket = (await (await as(`${H}/orders/${id}/kot/${kotNo}`)).json()) as {
      lines: { name: string; qty: number; extra: boolean; for?: { name: string; kotNo: number } }[];
    };
    expect(docket.lines.map((l) => [l.name, l.qty, l.extra, l.for])).toEqual([
      ["Extra papad", 1, true, { name: "Veg Biryani", kotNo: firstNo }],
      ["Kebab", 2, true, { name: "Veg Biryani", kotNo: firstNo }],
    ]);

    const kitchen = (await (await as("/api/hotels/5EL/kitchen")).json()) as {
      lines: { orderNo: string; name: string; forDish: string | null }[];
    };
    expect(kitchen.lines.some((k) => k.name === "Extra papad" && k.forDish === "Veg Biryani")).toBe(true);
  });

  it("the Till's own door does the same, and refuses a body with none", async () => {
    const id = await openOrder("4b");
    await post(`${H}/orders/${id}/lines`, { itemId: biryani.id, qty: 1 });
    await post(`${H}/orders/${id}/kot`);
    const sent = dishes(await order(id))[0]!;
    const res = await waiterPost(`${H}/orders/${id}/lines/${sent.id}/extras`, {
      extras: [{ name: "Extra papad", price: 40, qty: 2 }],
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(extrasOf(await order(id), sent.id).map((l) => [l.name, l.qty, l.kotStatus]))
      .toEqual([["Extra papad", 2, "pending"]]);
    const none = await post(`${H}/orders/${id}/lines/${sent.id}/extras`, {});
    expect(await reason(none)).toMatch(/Which add-ons/);
  });

  it("reads under ITS dish on the bill, after dishes added since", async () => {
    const id = await openOrder("5");
    await post(`${H}/orders/${id}/lines`, { itemId: biryani.id, qty: 1, note: "first" });
    await post(`${H}/orders/${id}/lines`, { itemId: biryani.id, qty: 1, note: "second" });
    const [one] = dishes(await order(id));
    await post(`${H}/orders/${id}/lines`, { extraFor: one!.id, extras: [{ name: "Extra papad", price: 40 }] });
    expect((await order(id)).lines.map((l) => l.name))
      .toEqual(["Veg Biryani", "Extra papad", "Veg Biryani"]);
  });

  it("refuses a struck dish, an add-on line, and a line from elsewhere", async () => {
    const id = await openOrder("6");
    await post(`${H}/orders/${id}/lines`, { itemId: biryani.id, qty: 1,
      extras: [{ name: "Extra papad", price: 40 }] });
    const o = await order(id);
    const dishId = dishes(o)[0]!.id;
    const papadId = extrasOf(o, dishId)[0]!.id;

    const onExtra = await post(`${H}/orders/${id}/lines`, { extraFor: papadId, extras: [{ name: "Ghee", price: 10 }] });
    expect(await reason(onExtra)).toMatch(/go on a dish, not on a side/);
    const nowhere = await post(`${H}/orders/${id}/lines`, { extraFor: "999999999", extras: [{ name: "Ghee", price: 10 }] });
    expect(await reason(nowhere)).toMatch(/not on this bill/);
    const empty = await post(`${H}/orders/${id}/lines`, { extraFor: dishId, extras: [] });
    expect(await reason(empty)).toMatch(/Which add-ons/);

    await post(`${H}/orders/${id}/lines/${dishId}/void`);
    const struck = await post(`${H}/orders/${id}/lines`, { extraFor: dishId, extras: [{ name: "Ghee", price: 10 }] });
    expect(await reason(struck)).toMatch(/Veg Biryani was struck/);
    expect((await order(id)).lines.find((l) => l.id === papadId)!.voided,
      "striking the dish struck its add-on").toBe(true);
  });
});

describe("the quantity, the strike and the day's list", () => {
  it("a dish's number moves its sides, never its add-on lines; an add-on's number is set once", async () => {
    const id = await openOrder("7");
    await post(`${H}/orders/${id}/lines`, { itemId: biryani.id, qty: 2,
      extras: [{ name: "Extra papad", price: 40, qty: 1 }] });
    const o = await order(id);
    const dishId = dishes(o)[0]!.id;
    const papad = extrasOf(o, dishId)[0]!;
    expect((await post(`${H}/orders/${id}/lines/${dishId}/qty`, { qty: 3 })).status).toBe(200);
    expect(extrasOf(await order(id), dishId)[0]!.qty).toBe(1);

    const res = await post(`${H}/orders/${id}/lines/${papad.id}/qty`, { qty: 2 });
    expect(res.status).toBe(409);
    expect(await reason(res)).toMatch(/number is set when it goes on/);
  });

  it("a sent add-on struck asks who and why, and the day's list names its dish", async () => {
    const id = await openOrder("8");
    await post(`${H}/orders/${id}/lines`, { itemId: biryani.id, qty: 1,
      extras: [{ name: "Extra papad", price: 40 }] });
    await post(`${H}/orders/${id}/kot`);
    const o = await order(id);
    const papad = extrasOf(o, dishes(o)[0]!.id)[0]!;

    const byWaiter = await waiterPost(`${H}/orders/${id}/lines/${papad.id}/void`, { reason: "not wanted" });
    expect(await reason(byWaiter)).toMatch(/kitchen already has this/);
    const noWhy = await post(`${H}/orders/${id}/lines/${papad.id}/void`, {});
    expect(await reason(noWhy)).toMatch(/Why is it coming off/);
    const ok = await post(`${H}/orders/${id}/lines/${papad.id}/void`, { reason: "guest changed mind" });
    expect(ok.status, await ok.clone().text()).toBe(200);

    const db = await admin();
    try {
      const { rows } = await db.query<{ name: string; reason: string }>(
        `select s.name, s.reason
           from pos_orders o,
                lateral app.pos_struck_after_kitchen(o.hotel_id, o.business_date) s
          where o.id = $1 and s.order_no = o.order_no`, [id]);
      expect(rows).toEqual([{ name: "+ Extra papad (for Veg Biryani)", reason: "guest changed mind" }]);
    } finally {
      await db.end();
    }
  });

  it("striking a sent dish carries its reason to its sent add-ons (210's check holds)", async () => {
    const id = await openOrder("9");
    await post(`${H}/orders/${id}/lines`, { itemId: biryani.id, qty: 1,
      extras: [{ name: "Extra papad", price: 40 }] });
    await post(`${H}/orders/${id}/kot`);
    const dishId = dishes(await order(id))[0]!.id;
    const res = await post(`${H}/orders/${id}/lines/${dishId}/void`, { reason: "wrong table" });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(extrasOf(await order(id), dishId)[0]).toMatchObject({ voided: true });
  });
});

describe("Customise before Send, with typed add-ons too", () => {
  it("All: the numbered fold and the typed line both go on the dish", async () => {
    const id = await openOrder("10");
    await post(`${H}/orders/${id}/lines`, { itemId: biryani.id, qty: 1 });
    const dishId = dishes(await order(id))[0]!.id;
    const res = await post(`${H}/orders/${id}/lines/${dishId}/numbered-addons`, {
      numberedAddons: [{ id: kebabId, qty: 1 }], extras: [{ name: "Extra papad", price: 40 }],
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const o = await order(id);
    expect(dishes(o)[0]!.name).toBe("Veg Biryani with add-on Kebab");
    expect(extrasOf(o, dishId).map((l) => l.name)).toEqual(["Extra papad"]);
  });

  it("Just 1: the typed line goes under the one split off", async () => {
    const id = await openOrder("11");
    await post(`${H}/orders/${id}/lines`, { itemId: biryani.id, qty: 3 });
    const dishId = dishes(await order(id))[0]!.id;
    const res = await post(`${H}/orders/${id}/lines/${dishId}/numbered-addons`, {
      numberedAddons: [{ id: kebabId, qty: 1 }], just: 1, extras: [{ name: "Extra papad", price: 40 }],
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const o = await order(id);
    const [rest, one] = dishes(o);
    expect([rest!.qty, one!.qty, one!.name]).toEqual([2, 1, "Veg Biryani with add-on Kebab"]);
    expect(extrasOf(o, rest!.id)).toHaveLength(0);
    expect(extrasOf(o, one!.id).map((l) => l.name)).toEqual(["Extra papad"]);
  });

  it("a bad typed add-on refuses the whole Customise, before anything changes", async () => {
    const id = await openOrder("12");
    await post(`${H}/orders/${id}/lines`, { itemId: biryani.id, qty: 1 });
    const dishId = dishes(await order(id))[0]!.id;
    const res = await post(`${H}/orders/${id}/lines/${dishId}/numbered-addons`, {
      numberedAddons: [{ id: kebabId, qty: 1 }], extras: [{ name: "Extra papad" }],
    });
    expect(res.status).toBe(409);
    expect(dishes(await order(id))[0]!.name).toBe("Veg Biryani");
  });
});

describe("the custom add-ons used (the Add-ons tab's list)", () => {
  it("counts what was typed, by name and price, not what was struck", async () => {
    const res = await as(`${H}/custom-addons-used`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      days: number; used: { name: string; price: number; times: number; by: string | null }[];
    };
    expect(body.days).toBe(30);
    const papad = body.used.find((u) => u.name === "Extra papad" && u.price === 40);
    expect(papad, "Extra papad at ₹40 is on the list").toBeTruthy();
    expect(papad!.times).toBeGreaterThan(0);
    expect(body.used.some((u) => u.name === "Kebab"), "a numbered add-on is not a custom one").toBe(false);
  });
});
