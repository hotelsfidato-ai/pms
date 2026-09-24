import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   STOCK HELD PER STORE, AND MOVED BETWEEN STORES — migration 112

   The owner, 17 September: one list, a store picked at the top; every
   receive, issue, waste, return and count happens in a named store; moving
   stock between stores is one act that writes both halves, and undoing it
   undoes both (D17-2: what was recorded before sits in the Main store).
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

const TAG = "STOPS";
const HOTEL = "5EL";
let keeper: string;
let mainId: string;
let kitchenId: string;
let spareId: string;
let lobbyId: string;
let elsewhereId: string;

type Item = { id: string; name: string; onHand: number; byStore: Record<string, number> };
type Movement = {
  id: string; kind: string; quantity: number; note: string | null; store: string;
  fromStore: string | null; toStore: string | null; isReversal: boolean;
  reversesKind: string | null; reversed: boolean;
};

const call = (method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/${HOTEL}/stores${path}`, {
    method,
    headers: { "x-dev-staff-id": keeper, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const json = async (res: Response, status: number) => {
  expect(res.status, await res.clone().text()).toBe(status);
  return res.json() as Promise<Record<string, unknown>>;
};

const newItem = async (name: string) =>
  (await json(await call("POST", "/items", { name: `${TAG} ${name}`, unit: "kg" }), 200)).id as string;

const record = (itemId: string, kind: string, quantity: number, locationId: string, extra = {}) =>
  call("POST", "/movements", {
    itemId, locationId, kind, quantity, ...(kind === "receipt" ? { unitCost: 50 } : {}), ...extra,
  });

const list = async () => (await json(await call("GET", ""), 200)) as {
  stores: { id: string; name: string; isActive: boolean; isMain: boolean }[]; items: Item[];
};
const item = async (id: string) => (await list()).items.find((i) => i.id === id)!;
const history = async (id: string) =>
  ((await json(await call("GET", `/items/${id}/movements`), 200)).movements) as Movement[];

beforeAll(async () => {
  const placeAt = async (code: string, name: string) => (await sql(
    `select l.id::text from locations l join hotels h on h.id = l.hotel_id
      where h.code = $1 and l.name = $2`, [code, name])).rows[0].id as string;
  mainId = await placeAt(HOTEL, "Main store");
  kitchenId = await placeAt(HOTEL, "Kitchen store");
  elsewhereId = await placeAt("AGR", "Main store");

  const hotel = (await sql("select id::text from hotels where code = $1", [HOTEL])).rows[0].id;
  spareId = (await sql(
    `insert into locations (hotel_id, name, kind, is_active) values ($1, $2, 'store', false)
     on conflict (hotel_id, name) do update set is_active = false returning id::text`,
    [hotel, `${TAG} spare store`])).rows[0].id;
  lobbyId = (await sql(
    `insert into locations (hotel_id, name, kind) values ($1, $2, 'public_area')
     on conflict (hotel_id, name) do update set kind = 'public_area' returning id::text`,
    [hotel, `${TAG} lobby`])).rows[0].id;

  const { rows } = await sql(
    `insert into staff (email, full_name, firebase_uid)
     values ('stops-keeper@fidato.in', '${TAG} keeper', 'test-uid-stops')
     on conflict (email) do update set is_active = true
     returning id::text`);
  keeper = rows[0].id as string;
  await sql("delete from staff_hotels where staff_id = $1", [keeper]);
  await sql(
    `insert into staff_hotels (staff_id, hotel_id, role)
     select $1, id, 'stores' from hotels where code = $2`, [keeper, HOTEL]);
});

afterAll(async () => {
  await sql("delete from staff_hotels where staff_id = $1", [keeper]);
  await sql("update staff set is_active = false where id = $1", [keeper]);
  await closePool();
});

describe("the stores, as the list reads them", () => {
  it("names the hotel's stores, the Main store first, and not a switched-off one holding nothing", async () => {
    const { stores } = await list();
    expect(stores[0]!.name).toBe("Main store");
    expect(stores[0]!.isMain).toBe(true);
    expect(stores.map((s) => s.name)).toEqual(expect.arrayContaining(["Kitchen store", "Bar store"]));
    expect(stores.map((s) => s.id)).not.toContain(spareId);
    expect(stores.map((s) => s.id)).not.toContain(lobbyId);
  });

  it("gives each item what each store holds, and leaves out a store that holds none", async () => {
    const rice = await newItem("rice");
    await json(await record(rice, "receipt", 30, mainId), 200);
    await json(await record(rice, "receipt", 8, kitchenId), 200);
    const r = await item(rice);
    expect(r.onHand).toBe(38);
    expect(r.byStore).toEqual({ [mainId]: 30, [kitchenId]: 8 });
  });
});

describe("every movement happens in a store", () => {
  it("refuses a movement that names no store", async () => {
    const salt = await newItem("salt");
    const body = await json(await call("POST", "/movements",
      { itemId: salt, kind: "receipt", quantity: 1, unitCost: 1 }), 409);
    expect(body.reason).toBe("Which store?");
  });

  it("refuses a store at another property, and a place that is not a store", async () => {
    const salt = await newItem("salt two");
    for (const place of [elsewhereId, lobbyId]) {
      const body = await json(await record(salt, "receipt", 1, place), 409);
      expect(body.reason).toBe("That is not a store at this property.");
    }
    expect((await item(salt)).onHand).toBe(0);
  });

  it("refuses an issue of more than THAT store holds, even when the hotel holds enough", async () => {
    const dal = await newItem("dal");
    await json(await record(dal, "receipt", 20, mainId), 200);
    await json(await record(dal, "receipt", 2, kitchenId), 200);
    const body = await json(await record(dal, "issue", 5, kitchenId), 409);
    expect(body.reason).toMatch(/There are 2 kg of STOPS dal in Kitchen store, and this would take out 5/);
    expect((await item(dal)).byStore[kitchenId]).toBe(2);
  });

  it("takes nothing into a switched-off store", async () => {
    const tea = await newItem("tea");
    const body = await json(await record(tea, "receipt", 1, spareId), 409);
    expect(body.reason).toMatch(/STOPS spare store is switched off/);
  });

  it("says, after a movement, what that store holds now", async () => {
    const oil = await newItem("oil");
    const body = await json(await record(oil, "receipt", 12, kitchenId), 200);
    expect(body).toMatchObject({ onHand: 12, onHandHere: 12, store: "Kitchen store" });
  });
});

describe("moving stock between stores", () => {
  it("moves it out of one store and into the other, and the hotel's total does not change", async () => {
    const sugar = await newItem("sugar");
    await json(await record(sugar, "receipt", 25, mainId), 200);
    const body = await json(await call("POST", "/transfers", {
      itemId: sugar, fromId: mainId, toId: kitchenId, quantity: 10, note: `${TAG} for the week`,
    }), 200);
    expect(body).toMatchObject({
      from: { name: "Main store", onHand: 15 }, to: { name: "Kitchen store", onHand: 10 },
    });
    const s = await item(sugar);
    expect(s.onHand).toBe(25);
    expect(s.byStore).toEqual({ [mainId]: 15, [kitchenId]: 10 });
  });

  it("reads as ONE line in the history, naming both stores", async () => {
    const ghee = await newItem("ghee");
    await json(await record(ghee, "receipt", 6, mainId), 200);
    await json(await call("POST", "/transfers",
      { itemId: ghee, fromId: mainId, toId: kitchenId, quantity: 4 }), 200);
    const moves = (await history(ghee)).filter((m) => m.kind === "transfer");
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ quantity: 4, fromStore: "Main store", toStore: "Kitchen store" });
  });

  it("is undone as a whole, and the undo reads as one line too", async () => {
    const milk = await newItem("milk");
    await json(await record(milk, "receipt", 9, mainId), 200);
    await json(await call("POST", "/transfers",
      { itemId: milk, fromId: mainId, toId: kitchenId, quantity: 9 }), 200);
    const move = (await history(milk)).find((m) => m.kind === "transfer")!;

    await json(await call("POST", `/movements/${move.id}/reverse`, {}), 200);
    const m = await item(milk);
    expect(m.byStore).toEqual({ [mainId]: 9 });

    const rows = await history(milk);
    expect(rows.filter((r) => r.reversesKind === "transfer")).toHaveLength(1);
    expect(rows.find((r) => r.kind === "transfer")!.reversed).toBe(true);
  });

  it("refuses a move to the store it is in, into a switched-off store, or of more than is there", async () => {
    const rava = await newItem("rava");
    await json(await record(rava, "receipt", 3, mainId), 200);
    const same = await json(await call("POST", "/transfers",
      { itemId: rava, fromId: mainId, toId: mainId, quantity: 1 }), 409);
    expect(same.reason).toBe("It is already there.");
    const off = await json(await call("POST", "/transfers",
      { itemId: rava, fromId: mainId, toId: spareId, quantity: 1 }), 409);
    expect(off.reason).toMatch(/STOPS spare store is switched off/);
    const much = await json(await call("POST", "/transfers",
      { itemId: rava, fromId: mainId, toId: kitchenId, quantity: 4 }), 409);
    expect(much.reason).toMatch(/There are 3 kg of STOPS rava in Main store, and this would move 4/);
    expect((await item(rava)).byStore).toEqual({ [mainId]: 3 });
  });
});

describe("an issue and the outlet it went to (D22-20)", () => {
  const outletAt = async (code: string) => (await sql(
    `insert into pos_outlets (hotel_id, code, name, staff_id)
     select id, 'STOPS', $2, $3 from hotels where code = $1
     on conflict (hotel_id, code) do update set name = excluded.name, is_active = true
     returning id::text`, [code, `${TAG} outlet ${code}`, keeper])).rows[0].id as string;

  it("lists this hotel's outlets, and the history names the one an issue went to", async () => {
    const here = await outletAt(HOTEL);
    const there = await outletAt("AGR");
    const outlets = ((await json(await call("GET", ""), 200)).outlets) as { id: string }[];
    expect(outlets.map((o) => o.id)).toContain(here);
    expect(outlets.map((o) => o.id)).not.toContain(there);

    const oil = await newItem("oil");
    await json(await record(oil, "receipt", 5, mainId), 200);
    await json(await record(oil, "issue", 2, mainId, { outletId: here }), 200);
    const issue = (await history(oil)).find((m) => m.kind === "issue") as Movement & { outlet: string };
    expect(issue.outlet).toBe(`${TAG} outlet ${HOTEL}`);
  });

  it("refuses another property's outlet, and an outlet on anything but an issue", async () => {
    const there = await outletAt("AGR");
    const here = await outletAt(HOTEL);
    const jeera = await newItem("jeera");
    await json(await record(jeera, "receipt", 5, mainId), 200);

    const elsewhere = await json(await record(jeera, "issue", 1, mainId, { outletId: there }), 409);
    expect(elsewhere.reason).toBe("That is not an outlet at this property.");
    const onReceipt = await json(await record(jeera, "receipt", 1, mainId, { outletId: here }), 409);
    expect(onReceipt.reason).toBe("Only an issue goes to an outlet.");
    expect((await item(jeera)).onHand).toBe(5);
  });
});
