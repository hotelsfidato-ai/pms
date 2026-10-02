import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE STORE'S SECOND PART (D22-38) — the owner's D25-12 to D25-19

   Levels per store, and the list of what is below one; the count sheet,
   each difference one correction with who and why, refused whole if the
   book moved; cylinders full and empty, the empties asked at the swap;
   the deposit typed on the item.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

const TAG = "STLCC";
const HOTEL = "5EL";
let keeper: string;
let mainId: string;
let kitchenId: string;

type Item = {
  id: string; onHand: number; byStore: Record<string, number>;
  levels: Record<string, number>; lowIn: string[]; low: boolean;
  cylinder: boolean; empties: number; emptiesByStore: Record<string, number>;
  cylindersOnDeposit: number | null; depositPerCylinder: number | null;
  depositHeld: number | null; inUse: number | null;
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

const newItem = async (name: string, unit = "kg", extra = {}) =>
  (await json(await call("POST", "/items", { name: `${TAG} ${name}`, unit, ...extra }), 200)).id as string;

const receive = (itemId: string, quantity: number, locationId: string, extra = {}) =>
  call("POST", "/movements", { itemId, locationId, kind: "receipt", quantity, unitCost: 50, ...extra });

const item = async (id: string) =>
  ((await json(await call("GET", ""), 200)).items as Item[]).find((i) => i.id === id)!;

const movements = async (itemId: string) => (await sql(
  `select kind, quantity::float as quantity, empty, note, moved_by::text as by
     from stock_movements where item_id = $1 order by id`, [itemId])).rows as {
  kind: string; quantity: number; empty: boolean; note: string | null; by: string;
}[];

beforeAll(async () => {
  const placeAt = async (name: string) => (await sql(
    `select l.id::text from locations l join hotels h on h.id = l.hotel_id
      where h.code = $1 and l.name = $2`, [HOTEL, name])).rows[0].id as string;
  mainId = await placeAt("Main store");
  kitchenId = await placeAt("Kitchen store");

  const { rows } = await sql(
    `insert into staff (email, full_name, firebase_uid)
     values ('stlcc-keeper@fidato.in', '${TAG} keeper', 'test-uid-stlcc')
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

describe("levels per store (D25-12, D25-14)", () => {
  it("'Warn me below' on a new item is the Main store's level, and the other stores have none", async () => {
    const rice = await newItem("rice", "kg", { reorderLevel: 20 });
    const r = await item(rice);
    expect(r.levels).toEqual({ [mainId]: 20 });
  });

  it("lists an item below its level in THAT store only, and never an item with no level", async () => {
    const dal = await newItem("dal");
    await json(await receive(dal, 30, mainId), 200);
    await json(await receive(dal, 3, kitchenId), 200);
    expect((await item(dal)).lowIn).toEqual([]);           // no level is never "below"

    await json(await call("PATCH", `/items/${dal}`, { levels: { [kitchenId]: 5, [mainId]: 10 } }), 200);
    const d = await item(dal);
    expect(d.levels).toEqual({ [kitchenId]: 5, [mainId]: 10 });
    expect(d.lowIn).toEqual([kitchenId]);                  // 3 ≤ 5 in the kitchen; 30 > 10 in Main
    expect(d.low).toBe(true);

    await json(await call("PATCH", `/items/${dal}`, { levels: { [kitchenId]: null } }), 200);
    expect((await item(dal)).lowIn).toEqual([]);           // cleared is no level again
  });

  it("refuses a level below zero and a store at another property", async () => {
    const oil = await newItem("oil", "litre");
    expect((await json(await call("PATCH", `/items/${oil}`, { levels: { [mainId]: -1 } }), 409)).reason)
      .toBe("A level is zero or more, or blank for none.");
    const theirs = (await sql(
      `select l.id::text from locations l join hotels h on h.id = l.hotel_id
        where h.code = 'AGR' and l.name = 'Main store'`)).rows[0].id as string;
    expect((await json(await call("PATCH", `/items/${oil}`, { levels: { [theirs]: 1 } }), 409)).reason)
      .toBe("That is not a store at this property.");
    expect((await item(oil)).levels).toEqual({});
  });
});

describe("the count sheet (D25-15, D25-16, D25-17)", () => {
  it("records each difference as ONE correction, by whoever saved, with the reason; a match writes nothing", async () => {
    const soap = await newItem("soap", "piece");
    const salt = await newItem("salt");
    await json(await receive(soap, 40, mainId), 200);
    await json(await receive(salt, 10, mainId), 200);

    const body = await json(await call("POST", "/counts", {
      locationId: mainId,
      lines: [
        { itemId: soap, book: 40, counted: 37, reason: "three in the laundry" },
        { itemId: salt, book: 10, counted: 10 },
      ],
    }), 200);
    expect(body).toMatchObject({ ok: true, recorded: 1, matched: 1 });

    const soapRows = await movements(soap);
    expect(soapRows.at(-1)).toEqual({
      kind: "adjustment", quantity: -3, empty: false,
      note: "Count of Main store - three in the laundry", by: keeper,
    });
    expect((await movements(salt)).length).toBe(1);        // the receipt, nothing more
    expect((await item(soap)).byStore[mainId]).toBe(37);
  });

  it("keeps every counted line, matched or not, with who and the correction it wrote (D27-238)", async () => {
    const towel = await newItem("towel", "piece");
    const sheet = await newItem("sheet", "piece");
    await json(await receive(towel, 20, mainId), 200);
    await json(await receive(sheet, 8, mainId), 200);

    await json(await call("POST", "/counts", {
      locationId: mainId,
      lines: [{ itemId: towel, book: 20, counted: 18 }, { itemId: sheet, book: 8, counted: 8 }],
    }), 200);

    const kept = (await sql(
      `select c.item_id::text as item, c.location_id::text as place, c.book::float as book,
              c.counted::float as counted, c.counted_by::text as by, m.quantity::float as corrected
         from stock_count_lines c left join stock_movements m on m.id = c.movement_id
        where c.item_id = any($1) order by c.counted`, [[towel, sheet]])).rows;
    expect(kept).toEqual([
      { item: sheet, place: mainId, book: 8, counted: 8, by: keeper, corrected: null },
      { item: towel, place: mainId, book: 20, counted: 18, by: keeper, corrected: -2 },
    ]);
  });

  it("refuses the whole save, naming the item, when the book moved since the sheet opened - and writes nothing", async () => {
    const tea = await newItem("tea");
    const sugar = await newItem("sugar");
    await json(await receive(tea, 5, mainId), 200);
    await json(await receive(sugar, 5, mainId), 200);
    await json(await receive(tea, 2, mainId), 200);        // arrives after the sheet was opened at 5

    const body = await json(await call("POST", "/counts", {
      locationId: mainId,
      lines: [
        { itemId: tea, book: 5, counted: 4 },
        { itemId: sugar, book: 5, counted: 1 },
      ],
    }), 409);
    expect(body.reason).toBe(
      `${TAG} tea moved in Main store since the count was opened - count it again. Nothing was saved.`);
    expect((await movements(sugar)).length).toBe(1);       // sugar's difference was not written either
  });

  it("refuses a sheet with nothing counted, and a count below zero", async () => {
    const rope = await newItem("rope", "m");
    expect((await json(await call("POST", "/counts", { locationId: mainId, lines: [] }), 409)).reason)
      .toBe("Nothing was counted - type a count on at least one line.");
    expect((await json(await call("POST", "/counts",
      { locationId: mainId, lines: [{ itemId: rope, book: 0, counted: -1 }] }), 409)).reason)
      .toBe("A count is zero or more.");
  });
});

describe("cylinders full and empty (D25-18) and the deposit (D25-19)", () => {
  it("asks for the empties on an issue and a delivery, every time, and keeps them apart from full", async () => {
    const lpg = await newItem("LPG", "cylinder");

    expect((await json(await receive(lpg, 3, kitchenId), 409)).reason)
      .toBe("How many empties did the supplier take back? 0 is an answer.");
    await json(await receive(lpg, 3, kitchenId, { emptiesTaken: 0 }), 200);

    const issue = (extra = {}) => call("POST", "/movements",
      { itemId: lpg, locationId: kitchenId, kind: "issue", quantity: 1, outletId: null, ...extra });
    expect((await json(await issue(), 409)).reason)
      .toBe("How many empties came back from the kitchen? 0 is an answer.");
    const out = await json(await issue({ emptiesBack: 1 }), 200);
    expect(out).toMatchObject({ onHandHere: 2, emptiesHere: 1 });

    const l = await item(lpg);
    expect(l.cylinder).toBe(true);
    expect(l.onHand).toBe(2);                              // full only
    expect(l.empties).toBe(1);
    expect(l.emptiesByStore).toEqual({ [kitchenId]: 1 });
  });

  it("takes empties back with a delivery, and refuses more than the store holds", async () => {
    const co2 = await newItem("CO2", "cylinders");
    await json(await receive(co2, 2, kitchenId, { emptiesTaken: 0 }), 200);
    await json(await call("POST", "/movements", { itemId: co2, locationId: kitchenId,
      kind: "issue", quantity: 2, outletId: null, emptiesBack: 2 }), 200);

    expect((await json(await receive(co2, 2, kitchenId, { emptiesTaken: 3 }), 409)).reason).toBe(
      `There are 2 empty cylinders of ${TAG} CO2 in Kitchen store, and this says the supplier took 3. `
      + "Count the empties first if the store holds more.");
    await json(await receive(co2, 2, kitchenId, { emptiesTaken: 2 }), 200);
    const c = await item(co2);
    expect(c.onHand).toBe(2);
    expect(c.empties).toBe(0);
  });

  it("refuses empties on an item not counted in cylinders", async () => {
    const flour = await newItem("flour");
    expect((await json(await receive(flour, 1, mainId, { emptiesTaken: 0 }), 409)).reason)
      .toBe("Only an item counted in cylinders has empties.");
    expect((await json(await call("PATCH", `/items/${flour}`, { cylindersOnDeposit: 2 }), 409)).reason)
      .toBe("Only an item counted in cylinders has a deposit.");
  });

  it("counts the empties on the sheet, and an undo of empties takes back empties, not full", async () => {
    const lpg = await newItem("LPG two", "cylinder");
    await json(await receive(lpg, 4, kitchenId, { emptiesTaken: 0 }), 200);
    await json(await call("POST", "/counts", {
      locationId: kitchenId, lines: [{ itemId: lpg, empty: true, book: 0, counted: 2 }] }), 200);
    let l = await item(lpg);
    expect([l.onHand, l.empties]).toEqual([4, 2]);

    const counted = (await sql(
      "select id::text from stock_movements where item_id = $1 and empty order by id desc limit 1",
      [lpg])).rows[0].id as string;
    await json(await call("POST", `/movements/${counted}/reverse`, {}), 200);
    l = await item(lpg);
    expect([l.onHand, l.empties]).toEqual([4, 0]);
  });

  it("shows the deposit as a dash until typed, then what is held and what is at the kitchen", async () => {
    const lpg = await newItem("LPG three", "cylinder");
    await json(await receive(lpg, 2, kitchenId, { emptiesTaken: 0 }), 200);
    await json(await call("POST", "/movements", { itemId: lpg, locationId: kitchenId,
      kind: "issue", quantity: 1, outletId: null, emptiesBack: 1 }), 200);

    let l = await item(lpg);
    expect([l.cylindersOnDeposit, l.depositPerCylinder, l.depositHeld, l.inUse]).toEqual([null, null, null, null]);

    await json(await call("PATCH", `/items/${lpg}`, { cylindersOnDeposit: 4, depositPerCylinder: 1700 }), 200);
    l = await item(lpg);
    expect(l.depositHeld).toBe(6800);
    expect(l.inUse).toBe(2);                               // 4 on deposit - 1 full - 1 empty

    expect((await json(await call("PATCH", `/items/${lpg}`, { cylindersOnDeposit: 1.5 }), 409)).reason)
      .toBe("Cylinders on deposit is a whole number, or blank.");
  });
});
