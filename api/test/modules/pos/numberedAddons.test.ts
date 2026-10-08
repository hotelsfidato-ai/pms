import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   NUMBERED ADD-ONS (the owner's D27-289, 9 October)

   "Add-on 2 = Kebab, ₹120": a numbered list any dish can take. Customise
   beside a dish, then 2, and the dish becomes ONE line - "Veg Biryani with
   add-on Kebab" - priced together, taxed at the dish's own rate; only
   before Send; the KOT and the kitchen read the dish with "+ Kebab" under
   it. The pad's own arithmetic is held to the server's in padTotal.test.ts.

   Numbers 701-799 are this file's, and go at the end.
   ══════════════════════════════════════════════════════════════════ */

let owner: string;
const orders: string[] = [];

const admin = async () =>
  new (await import("pg")).default.Pool({
    connectionString: process.env["SUPER_DATABASE_URL"]
      ?? "postgres://postgres:pw@127.0.0.1:55432/fidato",
  });

const as = (path: string, init?: RequestInit) =>
  app.request(path, {
    ...init,
    headers: { "x-dev-staff-id": owner, "content-type": "application/json", ...(init?.headers ?? {}) },
  });
const post = (path: string, body?: unknown, method = "POST") =>
  as(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

type Line = {
  id: string; name: string; qty: number; unitPrice: number; taxRate: number;
  voided: boolean; kotStatus: string; parentLineId: string | null;
  numberedAddons: { dish: string; base: number; addons: { id: string; number: number; name: string; price: number; qty: number }[] } | null;
};
type Order = { id: string; lines: Line[]; net: number };
type Addon = { id: string; number: number; name: string; price: number; free: boolean; isActive: boolean };

const H = "/api/hotels/5EL/till";

async function dish(name: string) {
  const body = (await (await as(`${H}/menu`)).json()) as {
    categories: { items: { id: string; name: string; price: number; taxRate: number }[] }[];
  };
  const found = body.categories.flatMap((c) => c.items).find((i) => i.name === name);
  expect(found, `the demo menu has no "${name}"`).toBeTruthy();
  return found!;
}

async function addon(number: number, name: string, price: number | null, free = false) {
  const res = await post(`${H}/numbered-addons`, { number, name, price, free });
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as { addon: Addon }).addon;
}

async function openOrder(label: string) {
  const res = await post(`${H}/orders`, { outlet: "REST", table: `ADDONTEST ${label}` });
  expect(res.status, await res.clone().text()).toBe(200);
  const o = (await res.json()) as { id: string };
  orders.push(o.id);
  return o.id;
}

const order = async (id: string) => (await (await as(`${H}/orders/${id}`)).json()) as Order;
const live = (o: Order) => o.lines.filter((l) => !l.voided && !l.parentLineId);

let kebab: Addon;
let raita: Addon;
let biryani: Awaited<ReturnType<typeof dish>>;

beforeAll(async () => {
  const db = await admin();
  try {
    owner = (await db.query<{ id: string }>(
      "select id from staff where email = 'owner@fidato.in'")).rows[0]!.id;
  } finally {
    await db.end();
  }
  biryani = await dish("Veg Biryani");
  kebab = await addon(702, "Kebab", 120);
  raita = await addon(703, "Raita", 40);
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
        where number between 701 and 799
          and hotel_id = (select id from hotels where code = '5EL')`);
  } finally {
    await db.end();
  }
  await closePool();
});

describe("the numbered add-ons list", () => {
  it("is read back in number order, with its price and what it is", async () => {
    const res = await as(`${H}/numbered-addons`);
    expect(res.status).toBe(200);
    const list = ((await res.json()) as { addons: Addon[] }).addons
      .filter((a) => a.number >= 701 && a.number <= 799);
    expect(list.map((a) => [a.number, a.name, a.price])).toEqual([[702, "Kebab", 120], [703, "Raita", 40]]);
  });

  it("refuses a number already in use, and says what it is", async () => {
    const res = await post(`${H}/numbered-addons`, { number: 702, name: "Paneer", price: 90 });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toMatch(/Add-on 702 is Kebab/);
  });

  it("refuses a 0 nobody ticked Free, and a blank price (no default prices)", async () => {
    const zero = await post(`${H}/numbered-addons`, { number: 704, name: "Onions", price: 0 });
    expect(zero.status).toBe(409);
    expect(((await zero.json()) as { reason: string }).reason).toMatch(/ticked Free/);
    const blank = await post(`${H}/numbered-addons`, { number: 704, name: "Onions" });
    expect(blank.status).toBe(409);
    expect(((await blank.json()) as { reason: string }).reason).toMatch(/Type a price, or tick Free/);
    const free = await addon(704, "Onions", null, true);
    expect([free.price, free.free]).toEqual([0, true]);
  });

  it("keeps its number when changed, and frees it when switched off", async () => {
    const lime = await addon(705, "Lime", 10);
    const changed = await post(`${H}/numbered-addons/${lime.id}`, { name: "Lemon", price: 15, number: 799 }, "PATCH");
    expect(changed.status, await changed.clone().text()).toBe(200);
    const after = ((await changed.json()) as { addon: Addon }).addon;
    expect([after.number, after.name, after.price], "the number does not change").toEqual([705, "Lemon", 15]);

    expect((await post(`${H}/numbered-addons/${lime.id}`, { active: false }, "PATCH")).status).toBe(200);
    const again = await addon(705, "Mint chutney", 20);
    expect(again.number, "a switched-off add-on's number is free again").toBe(705);
    const back = await post(`${H}/numbered-addons/${lime.id}`, { active: true }, "PATCH");
    expect(back.status, "but the old one cannot come back onto a number in use").toBe(409);
  });
});

describe("a dish with numbered add-ons", () => {
  it("is ONE line: the dish and its add-ons named and priced together, at the dish's rate", async () => {
    const id = await openOrder("1");
    const res = await post(`${H}/orders/${id}/lines`,
      { itemId: biryani.id, qty: 1, numberedAddons: [{ id: kebab.id, qty: 1 }] });
    expect(res.status, await res.clone().text()).toBe(200);

    const o = await order(id);
    expect(o.lines, "one line, not a line per add-on").toHaveLength(1);
    const l = o.lines[0]!;
    expect(l.name).toBe("Veg Biryani with add-on Kebab");
    expect(l.unitPrice).toBe(biryani.price + 120);
    expect(l.taxRate, "the add-on is taxed as part of the dish").toBe(biryani.taxRate);
    expect(l.numberedAddons).toEqual({
      dish: "Veg Biryani", base: biryani.price,
      addons: [{ id: kebab.id, number: 702, name: "Kebab", price: 120, qty: 1 }],
    });
    expect(o.net).toBe(biryani.price + 120);
  });

  it("twice is ×2, and several read in number order", async () => {
    const id = await openOrder("2");
    await post(`${H}/orders/${id}/lines`, { itemId: biryani.id, qty: 1,
      numberedAddons: [{ id: raita.id, qty: 1 }, { id: kebab.id, qty: 2 }] });
    const l = live(await order(id))[0]!;
    expect(l.name).toBe("Veg Biryani with add-ons Kebab ×2, Raita");
    expect(l.unitPrice).toBe(biryani.price + 240 + 40);
  });

  it("one more of the same is one more of it; a plain one is its own line", async () => {
    const id = await openOrder("3");
    const withKebab = { itemId: biryani.id, qty: 1, numberedAddons: [{ id: kebab.id, qty: 1 }] };
    await post(`${H}/orders/${id}/lines`, withKebab);
    await post(`${H}/orders/${id}/lines`, withKebab);
    await post(`${H}/orders/${id}/lines`, { itemId: biryani.id, qty: 1 });
    const lines = live(await order(id));
    expect(lines.map((l) => [l.name, l.qty])).toEqual([
      ["Veg Biryani with add-on Kebab", 2],
      ["Veg Biryani", 1],
    ]);
  });

  it("Customise changes a dish not yet sent; taking them off gives back the dish's price", async () => {
    const id = await openOrder("4");
    await post(`${H}/orders/${id}/lines`, { itemId: biryani.id, qty: 2 });
    const line = live(await order(id))[0]!;

    const on = await post(`${H}/orders/${id}/lines/${line.id}/numbered-addons`,
      { numberedAddons: [{ id: kebab.id, qty: 1 }] });
    expect(on.status, await on.clone().text()).toBe(200);
    let l = live(await order(id))[0]!;
    expect([l.name, l.unitPrice, l.qty]).toEqual(["Veg Biryani with add-on Kebab", biryani.price + 120, 2]);

    /* Customised again: from what it was before, never Kebab on Kebab. */
    await post(`${H}/orders/${id}/lines/${line.id}/numbered-addons`,
      { numberedAddons: [{ id: raita.id, qty: 1 }] });
    l = live(await order(id))[0]!;
    expect([l.name, l.unitPrice]).toEqual(["Veg Biryani with add-on Raita", biryani.price + 40]);

    await post(`${H}/orders/${id}/lines/${line.id}/numbered-addons`, { numberedAddons: [] });
    l = live(await order(id))[0]!;
    expect([l.name, l.unitPrice, l.numberedAddons]).toEqual(["Veg Biryani", biryani.price, null]);
  });

  it("refuses Customise once the kitchen has the dish (before Send only)", async () => {
    const id = await openOrder("5");
    await post(`${H}/orders/${id}/lines`, { itemId: biryani.id, qty: 1 });
    expect((await post(`${H}/orders/${id}/kot`)).status).toBe(200);
    const line = live(await order(id))[0]!;
    const res = await post(`${H}/orders/${id}/lines/${line.id}/numbered-addons`,
      { numberedAddons: [{ id: kebab.id, qty: 1 }] });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason)
      .toMatch(/kitchen already has Veg Biryani\. Add a fresh line/);
    expect(live(await order(id))[0]!.name, "and nothing changed").toBe("Veg Biryani");
  });

  it("the KOT and the kitchen read the dish with + Kebab under it, one ticket", async () => {
    const id = await openOrder("6");
    await post(`${H}/orders/${id}/lines`, { itemId: biryani.id, qty: 1,
      numberedAddons: [{ id: kebab.id, qty: 2 }] });
    const sent = await post(`${H}/orders/${id}/kot`);
    expect(sent.status, await sent.clone().text()).toBe(200);
    const kotNo = ((await sent.json()) as { kotNo: number }).kotNo;

    const docket = (await (await as(`${H}/orders/${id}/kot/${kotNo}`)).json()) as {
      lines: { name: string; qty: number; plus: { name: string; qty: number }[] }[];
    };
    expect(docket.lines).toHaveLength(1);
    expect(docket.lines[0]).toMatchObject({ name: "Veg Biryani", qty: 1, plus: [{ name: "Kebab", qty: 2 }] });

    const kitchen = (await (await as("/api/hotels/5EL/kitchen")).json()) as {
      lines: { orderNo: string; name: string; plus: { name: string; qty: number }[] }[];
    };
    const mine = kitchen.lines.filter((k) => k.name === "Veg Biryani" && k.plus.length > 0);
    expect(mine.some((k) => k.plus[0]!.name === "Kebab" && k.plus[0]!.qty === 2)).toBe(true);
  });

  it("more of a sent dish carries its add-ons", async () => {
    const id = await openOrder("7");
    await post(`${H}/orders/${id}/lines`, { itemId: biryani.id, qty: 1,
      numberedAddons: [{ id: kebab.id, qty: 1 }] });
    await post(`${H}/orders/${id}/kot`);
    const sent = live(await order(id))[0]!;
    const res = await post(`${H}/orders/${id}/lines/${sent.id}/qty`, { qty: 2 });
    expect(res.status, await res.clone().text()).toBe(200);
    const lines = live(await order(id));
    expect(lines.map((l) => [l.name, l.qty, l.kotStatus])).toEqual([
      ["Veg Biryani with add-on Kebab", 1, "sent"],
      ["Veg Biryani with add-on Kebab", 1, "pending"],
    ]);
  });

  it("refuses an add-on that is off for a while, and says which", async () => {
    const pickle = await addon(706, "Pickle", 15);
    expect((await post(`${H}/numbered-addons/${pickle.id}/off`, { until: "2h", reason: "none left" })).status).toBe(200);
    const id = await openOrder("8");
    const res = await post(`${H}/orders/${id}/lines`, { itemId: biryani.id, qty: 1,
      numberedAddons: [{ id: pickle.id, qty: 1 }] });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toBe("Add-on 706, Pickle, is off - none left.");
    expect(live(await order(id)), "nothing went on").toHaveLength(0);
  });
});
