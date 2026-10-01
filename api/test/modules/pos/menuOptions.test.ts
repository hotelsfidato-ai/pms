import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   VARIATIONS AND ADD-ONS, MADE ON THE MENU SCREEN AND BY FILE

   The owner's D21-40 to D21-43 (21 September). Until then only the demo
   loader could write one; these prove the routes a kitchen manager uses.

   THE ASSERTION THAT MATTERS: a variation or an add-on typed with no
   price is REFUSED — not saved at zero. Since D27-192 (Q6) a 0 is kept
   only when it is ticked Free, as a dish's is (D27-120).

   Everything is made in its own section, and switched off afterwards:
   the files after this one pick "any dish with no variations" from the
   same database.
   ══════════════════════════════════════════════════════════════════ */

const SECTION = "MENUTEST section";

let ownerStaffId: string;
let categoryId: string;
const orders: string[] = [];

const admin = async () =>
  new (await import("pg")).default.Pool({
    connectionString:
      process.env["SUPER_DATABASE_URL"] ??
      "postgres://postgres:pw@127.0.0.1:55432/fidato",
  });

const call = (method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL/till${path}`, {
    method,
    headers: { "x-dev-staff-id": ownerStaffId, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const post = (path: string, body?: unknown) => call("POST", path, body);
const patch = (path: string, body?: unknown) => call("PATCH", path, body);
/** A dish's whole set of variations (D27-192): one Size type unless told. */
const put = (id: string, choices: unknown[], more: Record<string, unknown> = {}) =>
  call("PUT", `/menu/items/${id}/variations`,
    { types: choices.length ? [{ kind: "size", choices }] : [], ...more });

async function reason(res: Response) {
  return ((await res.json()) as { reason?: string }).reason ?? "";
}

async function dish(name: string, price: unknown = "250") {
  const res = await post("/menu/items", { categoryId, name, price, taxRate: 5 });
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as { id: string }).id;
}

type MenuItem = {
  id: string; name: string; price: number;
  variations: { id: string; label: string; price: number }[];
  addonGroups: { id: string; label: string; addons: { id: string; label: string; price: number }[] }[];
};

async function onMenu(id: string): Promise<MenuItem> {
  const res = await call("GET", "/menu");
  const body = (await res.json()) as { categories: { items: MenuItem[] }[] };
  return body.categories.flatMap((c) => c.items).find((i) => i.id === id)!;
}

async function openOrder() {
  const res = await post("/orders", { outlet: "REST", table: "MENUTEST" });
  expect(res.status, await res.clone().text()).toBe(200);
  const id = ((await res.json()) as { id: string }).id;
  orders.push(id);
  return id;
}

beforeAll(async () => {
  const db = await admin();
  try {
    const s = await db.query<{ id: string }>(
      "select id from staff where email = 'owner@fidato.in'");
    ownerStaffId = s.rows[0]!.id;
  } finally {
    await db.end();
  }
  const res = await post("/menu/categories", { name: SECTION });
  categoryId = ((await res.json()) as { id: string }).id;
});

afterAll(async () => {
  for (const id of orders) {
    await post(`/orders/${id}/abandon`, { reason: "menu test" });
  }
  const db = await admin();
  try {
    await db.query(
      `update pos_menu_items set is_active = false
        where category_id = $1`, [categoryId]);
    await db.query(
      "update pos_menu_categories set is_active = false where id = $1",
      [categoryId]);
  } finally {
    await db.end();
  }
  await closePool();
});

describe("a price nobody typed is refused, never zero", () => {
  it("refuses a variation with no price, or 0 not ticked Free, and keeps one ticked", async () => {
    const id = await dish("MENUTEST Lassi");
    for (const price of [undefined, null, "", "  "]) {
      const res = await put(id, [{ label: "Small", price }]);
      expect(res.status, `price ${JSON.stringify(price)}`).toBe(409);
      expect(await reason(res)).toMatch(/Type a price/);
    }
    const zero = await put(id, [{ label: "Taster", price: "0" }]);
    expect(zero.status).toBe(409);
    expect(await reason(zero)).toMatch(/ticked Free/);
    expect((await onMenu(id)).variations).toEqual([]);

    const free = await put(id, [{ label: "Taster", free: true }]);
    expect(free.status, await free.clone().text()).toBe(200);
    expect((await onMenu(id)).variations).toMatchObject([{ label: "Taster", price: 0 }]);
  });

  it("refuses an add-on option with no price, or 0 not ticked Free, and keeps one ticked", async () => {
    const g = await post("/menu/addon-groups",
      { label: "MENUTEST Preferences", minSelect: 0, maxSelect: null });
    expect(g.status).toBe(200);
    const groupId = ((await g.json()) as { id: string }).id;

    for (const price of [undefined, null, ""]) {
      const res = await post(`/menu/addon-groups/${groupId}/addons`,
        { label: "No onion", price });
      expect(res.status, `price ${JSON.stringify(price)}`).toBe(409);
      expect(await reason(res)).toMatch(/Type a price/);
    }
    const zero = await post(`/menu/addon-groups/${groupId}/addons`,
      { label: "No onion", price: 0 });
    expect(zero.status).toBe(409);
    expect(await reason(zero)).toMatch(/ticked Free/);
    const ok = await post(`/menu/addon-groups/${groupId}/addons`,
      { label: "No onion", free: true });
    expect(ok.status).toBe(200);

    const list = await call("GET", "/menu/addon-groups");
    const groups = ((await list.json()) as {
      groups: { id: string; addons: { label: string; price: number }[] }[];
    }).groups;
    expect(groups.find((x) => x.id === groupId)!.addons)
      .toEqual([expect.objectContaining({ label: "No onion", price: 0 })]);
  });

  it("refuses a repriced variation left blank, and changes nothing", async () => {
    const id = await dish("MENUTEST Chaas");
    await put(id, [{ label: "Glass", price: 40 }]);
    const v = (await onMenu(id)).variations[0]!;
    const res = await put(id, [{ id: v.id, label: "Glass", price: "" }]);
    expect(res.status).toBe(409);
    expect((await onMenu(id)).variations[0]!.price).toBe(40);
  });

  it("refuses a DISH added with an empty price box (POS-14)", async () => {
    /* It was `Number(input.price)`, and Number("") is 0. */
    for (const price of ["", null]) {
      const res = await post("/menu/items",
        { categoryId, name: "MENUTEST Blank", price, taxRate: 5 });
      expect(res.status, `price ${JSON.stringify(price)}`).toBe(409);
    }
  });
});

describe("variations on a dish, saved as one set (D27-192)", () => {
  it("adds, renames, reprices and removes; emptying it needs the dish's price", async () => {
    const id = await dish("MENUTEST Biryani", "250");
    expect((await put(id, [{ label: "Half", price: 180 }, { label: "Full", price: 320 }])).status)
      .toBe(200);

    const dup = await put(id, [{ label: "Half", price: 180 }, { label: "half", price: 1 }]);
    expect(dup.status).toBe(409);
    expect(await reason(dup)).toMatch(/in type 1 twice/);

    let item = await onMenu(id);
    const half = item.variations.find((v) => v.label === "Half")!;
    const full = item.variations.find((v) => v.label === "Full")!;
    /* Renamed by its id; Full left out, so it goes. */
    expect((await put(id, [{ id: half.id, label: "Regular", price: 190 }])).status).toBe(200);
    item = await onMenu(id);
    expect(item.variations.map((v) => [v.id, v.label, v.price])).toEqual([[half.id, "Regular", 190]]);

    /* Emptied: the dish is one price again, and its own ₹250 has not
       been looked at since. The owner: ask for the price. */
    const bare = await put(id, []);
    expect(bare.status).toBe(409);
    expect(await reason(bare)).toMatch(/one price again\. What price\?/);
    expect((await onMenu(id)).variations.length).toBe(1);

    const priced = await put(id, [], { dishPrice: "300" });
    expect(priced.status).toBe(200);
    item = await onMenu(id);
    expect(item.variations).toEqual([]);
    expect(item.price).toBe(300);

    /* Typed again in the same type, the removed row comes back. */
    expect((await put(id, [{ label: "Full", price: 330 }])).status).toBe(200);
    expect((await onMenu(id)).variations).toMatchObject([{ id: full.id, label: "Full", price: 330 }]);
  });
});

describe("an add-on group on many dishes, and how many a guest may choose", () => {
  it("is rung on the pad as the rule says, and one price change reaches every dish", async () => {
    const curry = await dish("MENUTEST Dal");
    const paneer = await dish("MENUTEST Paneer");
    const g = await post("/menu/addon-groups",
      { label: "MENUTEST Bread", minSelect: 1, maxSelect: 2 });
    const groupId = ((await g.json()) as { id: string }).id;
    for (const [label, price] of [["Naan", 40], ["Roti", 20], ["Kulcha", 50]] as const) {
      expect((await post(`/menu/addon-groups/${groupId}/addons`, { label, price })).status).toBe(200);
    }
    expect((await post(`/menu/addon-groups/${groupId}/dishes`,
      { itemIds: [curry, paneer] })).status).toBe(200);

    const offered = await onMenu(paneer);
    const bread = offered.addonGroups.find((x) => x.id === groupId)!;
    const [naan, roti, kulcha] = ["Naan", "Roti", "Kulcha"]
      .map((l) => bread.addons.find((a) => a.label === l)!.id);

    const order = await openOrder();
    /* None chosen from a group that needs one: refused, and NOTHING of
       the dish written (a refusal after a write is a commit, MEMORY 243). */
    const none = await post(`/orders/${order}/lines`, { itemId: curry });
    expect(none.status).toBe(409);
    expect(await reason(none)).toMatch(/choose one from MENUTEST Bread/);

    const three = await post(`/orders/${order}/lines`,
      { itemId: curry, addonIds: [naan, roti, kulcha] });
    expect(three.status).toBe(409);
    expect(await reason(three)).toMatch(/allows 2/);

    const db = await admin();
    try {
      const { rows } = await db.query(
        "select 1 from pos_order_lines where order_id = $1", [order]);
      expect(rows.length, "a refused dish left a line on the bill").toBe(0);
    } finally {
      await db.end();
    }

    const two = await post(`/orders/${order}/lines`,
      { itemId: curry, addonIds: [naan, roti] });
    expect(two.status, await two.clone().text()).toBe(200);
    const lines = ((await two.json()) as {
      lines: { name: string; unitPrice: number; parentLineId: string | null }[];
    }).lines;
    expect(lines.map((l) => [l.name, l.unitPrice])).toEqual([
      ["MENUTEST Dal", 250],
      ["MENUTEST Bread: Naan", 40],
      ["MENUTEST Bread: Roti", 20],
    ]);

    /* Repriced once, in the group - both dishes read the new price. */
    expect((await patch(`/menu/addons/${naan}`, { label: "Naan", price: 45 })).status).toBe(200);
    for (const id of [curry, paneer]) {
      const n = (await onMenu(id)).addonGroups[0]!.addons.find((a) => a.label === "Naan")!;
      expect(n.price).toBe(45);
    }

    /* Taken off one dish: the other keeps it. */
    expect((await post(`/menu/addon-groups/${groupId}/dishes`, { itemIds: [paneer] })).status).toBe(200);
    expect((await onMenu(curry)).addonGroups).toEqual([]);
    expect((await onMenu(paneer)).addonGroups.length).toBe(1);

    /* Removed: gone from the menu, kept on the bill that sold it. */
    expect((await post(`/menu/addons/${roti}/remove`)).status).toBe(200);
    expect((await onMenu(paneer)).addonGroups[0]!.addons.map((a) => a.label))
      .not.toContain("Roti");
  });

  it("refuses a rule a guest could never meet", async () => {
    const bad = await post("/menu/addon-groups",
      { label: "MENUTEST Impossible", minSelect: 3, maxSelect: 1 });
    expect(bad.status).toBe(409);
    expect(await reason(bad)).toMatch(/cannot be more than/);
  });
});

describe("the two import files (D21-43)", () => {
  it("reads add-ons first, then a menu with variations naming them", async () => {
    const addons = await post("/menu/addon-groups/import", { dryRun: false, rows: [
      { group: "MENUTEST Raita", option: "Plain", price: "30", minSelect: "0", maxSelect: "1" },
      { group: "MENUTEST Raita", option: "Boondi", price: "40" },
      { group: "MENUTEST Raita", option: "Mixed", price: "" },
      { group: "MENUTEST Jain", option: "Jain", price: "10" },
      { group: "MENUTEST Jain", option: "No garlic", price: "0" },
    ] });
    expect(addons.status).toBe(200);
    const a = (await addons.json()) as {
      creates: number; rejected: number; verdicts: { line: number; detail: string }[];
    };
    expect(a.creates).toBe(3);
    expect(a.rejected).toBe(2);
    expect(a.verdicts.find((v) => v.line === 4)!.detail).toMatch(/blank is not zero/);
    /* D27-192 (D): a file cannot tick Free. */
    expect(a.verdicts.find((v) => v.line === 6)!.detail).toMatch(/0 is not taken from a file/);

    const menu = await post("/menu/import", { dryRun: false, rows: [
      { category: SECTION, name: "MENUTEST Pulao", variation: "Half", price: "150",
        addonGroups: "MENUTEST Raita; MENUTEST Jain" },
      { category: SECTION, name: "MENUTEST Pulao", variation: "Full", price: "260" },
      { category: SECTION, name: "MENUTEST Pulao", price: "200" },
      { category: SECTION, name: "MENUTEST Soup", price: "120", addonGroups: "Nowhere" },
    ] });
    expect(menu.status).toBe(200);
    const m = (await menu.json()) as {
      creates: number; rejected: number; verdicts: { line: number; detail: string }[];
    };
    expect(m.creates).toBe(2);
    expect(m.rejected).toBe(2);
    expect(m.verdicts.find((v) => v.line === 4)!.detail).toMatch(/has variations in this file/);
    expect(m.verdicts.find((v) => v.line === 5)!.detail).toMatch(/not an add-on group yet/);

    const res = await call("GET", "/menu");
    const pulao = ((await res.json()) as { categories: { items: MenuItem[] }[] })
      .categories.flatMap((c) => c.items).find((i) => i.name === "MENUTEST Pulao")!;
    expect(pulao.variations.map((v) => [v.label, v.price]))
      .toEqual([["Half", 150], ["Full", 260]]);
    expect(pulao.addonGroups.map((g) => g.label).sort())
      .toEqual(["MENUTEST Jain", "MENUTEST Raita"]);
  });
});
