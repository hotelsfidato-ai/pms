import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE STORE LIKE THE CALENDAR (D27-238, the owner's answers D27-242)

   A delivery's GST and expiry; an issue's department as typed; breakage
   for crockery only, with who; crockery in use at a restaurant place;
   what the tiles read; the fourteen days, valued at the running average,
   with the till's sales only for a role that may read reports.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "STDAYS";
const HOTEL = "5EL";
const pool = new pg.Pool({ connectionString: SUPER });
const sql = async <T>(text: string, values: unknown[] = []) => (await pool.query(text, values)).rows as T[];

let keeper = "";
let gm = "";
let mainId = "";
let restaurantId = "";

const as = (who: string) => (method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/${HOTEL}/stores${path}`, {
    method,
    headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const json = async (res: Response, status: number) => {
  expect(res.status, await res.clone().text()).toBe(status);
  return res.json() as Promise<Record<string, unknown>>;
};
const call = (method: string, path: string, body?: unknown) => as(keeper)(method, path, body);
const newItem = async (name: string, extra = {}) =>
  (await json(await call("POST", "/items", { name: `${TAG} ${name}`, unit: "piece", ...extra }), 200)).id as string;
const move = (body: Record<string, unknown>) => call("POST", "/movements", { locationId: mainId, ...body });

type Item = {
  id: string; crockery: boolean; received: boolean; byStore: Record<string, number>;
  today: Record<string, string[]>; lastCounted: Record<string, string>;
};
const itemOf = async (id: string) =>
  ((await json(await call("GET", ""), 200)).items as Item[]).find((i) => i.id === id)!;

async function person(email: string, role: string): Promise<string> {
  const [row] = await sql<{ id: string }>(
    `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
     on conflict (email) do update set is_active = true returning id::text`,
    [email, `${TAG} ${role}`, `test-uid-${email}`]);
  await sql("delete from staff_hotels where staff_id = $1", [row!.id]);
  await sql(`insert into staff_hotels (staff_id, hotel_id, role)
             select $1, id, $2 from hotels where code = $3`, [row!.id, role, HOTEL]);
  return row!.id;
}

beforeAll(async () => {
  keeper = await person("stdays-keeper@fidato.in", "stores");
  gm = await person("stdays-gm@fidato.in", "gm");
  mainId = (await sql<{ id: string }>(
    `select l.id::text from locations l join hotels h on h.id = l.hotel_id
      where h.code = $1 and l.name = 'Main store'`, [HOTEL]))[0]!.id;
  /* A place the hotel adds in Places and suppliers; the migration adds none. */
  restaurantId = (await sql<{ id: string }>(
    `insert into locations (hotel_id, name, kind)
     select id, $2, 'restaurant' from hotels where code = $1
     on conflict (hotel_id, name) do update set is_active = true returning id::text`,
    [HOTEL, `${TAG} Restaurant`]))[0]!.id;
});

afterAll(async () => {
  await pool.end();
  await closePool();
});

describe("a delivery's GST and expiry, an issue's department (D27-238)", () => {
  it("records the GST, all three or none, and the expiry, on a delivery only", async () => {
    const rice = await newItem("rice");
    await json(await move({
      itemId: rice, kind: "receipt", quantity: 10, unitCost: 100,
      gstRate: 5, gstAmount: 50, gstClaimable: false, expiresOn: "2027-01-31",
    }), 200);
    const [row] = await sql<{ rate: string; amount: string; claimable: boolean; expires: string }>(
      `select gst_rate::text as rate, gst_amount::text as amount, gst_claimable as claimable,
              expires_on::text as expires
         from stock_movements where item_id = $1`, [rice]);
    expect(row).toEqual({ rate: "5.00", amount: "50.00", claimable: false, expires: "2027-01-31" });

    expect((await json(await move({ itemId: rice, kind: "receipt", quantity: 1, unitCost: 100, gstRate: 5 }), 409)).reason)
      .toBe("GST is the rate, the amount and whether it can be claimed - all three, or none.");
    expect((await json(await move({
      itemId: rice, kind: "issue", quantity: 1, outletId: null, gstRate: 5, gstAmount: 5, gstClaimable: true,
    }), 409)).reason).toBe("GST and an expiry are a delivery's.");
  });

  it("keeps an issue's department as typed, trimmed; a department on a delivery is refused", async () => {
    const soap = await newItem("soap");
    await json(await move({ itemId: soap, kind: "receipt", quantity: 10, unitCost: 20 }), 200);
    await json(await move({ itemId: soap, kind: "issue", quantity: 2, outletId: null, department: "  Front Office " }), 200);
    expect((await sql<{ d: string }>(
      "select department as d from stock_movements where item_id = $1 and kind = 'issue'", [soap]))[0]!.d)
      .toBe("Front Office");
    expect((await json(await move({ itemId: soap, kind: "receipt", quantity: 1, department: "Kitchen" }), 409)).reason)
      .toBe("A department is an issue's.");
  });
});

describe("crockery and cutlery (D27-242 Q10, Q11)", () => {
  it("moves into use at a restaurant place, breaks there with who, and is counted there", async () => {
    const plate = await newItem("plate", { crockery: true });
    await json(await move({ itemId: plate, kind: "receipt", quantity: 20, unitCost: 150 }), 200);
    await json(await call("POST", "/transfers", { itemId: plate, fromId: mainId, toId: restaurantId, quantity: 12 }), 200);

    expect((await json(await move({ itemId: plate, kind: "breakage", quantity: 1, locationId: restaurantId }), 409)).reason)
      .toBe("Who broke it? Choose Not known if nobody knows.");
    await json(await move({ itemId: plate, kind: "breakage", quantity: 2, locationId: restaurantId, brokenBy: keeper }), 200);
    await json(await move({ itemId: plate, kind: "breakage", quantity: 1, locationId: restaurantId, brokenBy: null }), 200);

    const item = await itemOf(plate);
    expect(item.crockery).toBe(true);
    expect(item.byStore).toEqual({ [mainId]: 8, [restaurantId]: 9 });
    expect(item.today["breakage"]).toEqual([restaurantId]);

    await json(await call("POST", "/counts", {
      locationId: restaurantId, lines: [{ itemId: plate, book: 9, counted: 9 }],
    }), 200);
    expect(Object.keys((await itemOf(plate)).lastCounted)).toEqual([restaurantId]);

    const history = (await json(await call("GET", `/items/${plate}/movements`), 200)).movements as
      { kind: string; brokenBy: string | null }[];
    expect(history.filter((m) => m.kind === "breakage").map((m) => m.brokenBy))
      .toEqual([null, `${TAG} stores`]);
  });

  it("refuses breakage of anything but crockery, and a person who does not work here", async () => {
    const tea = await newItem("tea");
    await json(await move({ itemId: tea, kind: "receipt", quantity: 5, unitCost: 10 }), 200);
    expect((await json(await move({ itemId: tea, kind: "breakage", quantity: 1, brokenBy: null }), 409)).reason)
      .toBe("Breakage is recorded for crockery and cutlery. Anything else is waste.");
    const cup = await newItem("cup", { crockery: true });
    await json(await move({ itemId: cup, kind: "receipt", quantity: 5, unitCost: 10 }), 200);
    expect((await json(await move({
      itemId: cup, kind: "breakage", quantity: 1, brokenBy: "00000000-0000-0000-0000-000000000000",
    }), 409)).reason).toBe("That person does not work here. Choose Not known if nobody knows.");
    expect((await json(await call("POST", "/transfers", {
      itemId: tea, fromId: mainId, toId: restaurantId, quantity: 1,
    }), 409)).reason).toBe("That is not a store at this property.");
  });
});

describe("the monthly crockery count (D27-242 Q11)", () => {
  it("rings the bell for a place holding crockery that was never counted, and stops once it is", async () => {
    const barId = (await sql<{ id: string }>(
      `insert into locations (hotel_id, name, kind)
       select id, $2, 'bar' from hotels where code = $1
       on conflict (hotel_id, name) do update set is_active = true returning id::text`,
      [HOTEL, `${TAG} Bar`]))[0]!.id;
    const glass = await newItem("glass", { crockery: true });
    await json(await move({ itemId: glass, kind: "receipt", quantity: 6, unitCost: 80 }), 200);
    await json(await call("POST", "/transfers", { itemId: glass, fromId: mainId, toId: barId, quantity: 6 }), 200);

    const bell = async () => ((await (await app.request(`/api/hotels/${HOTEL}/notifications`, {
      headers: { "x-dev-staff-id": keeper },
    })).json()) as { title: string }[]).map((n) => n.title);
    expect(await bell()).toContain(`Crockery in ${TAG} Bar: never counted`);

    await json(await call("POST", "/counts", { locationId: barId, lines: [{ itemId: glass, book: 6, counted: 6 }] }), 200);
    expect((await bell()).some((t) => t.startsWith(`Crockery in ${TAG} Bar`))).toBe(false);
  });
});

describe("the fourteen days (D27-238, D27-242 Q1, Q4, Q5)", () => {
  it("values a delivery at what was paid and an issue at the running average; sales only for a role that reads reports", async () => {
    const dal = await newItem("dal");
    await json(await move({ itemId: dal, kind: "receipt", quantity: 10, unitCost: 100 }), 200);
    await json(await move({ itemId: dal, kind: "issue", quantity: 5, outletId: null }), 200);
    await json(await move({ itemId: dal, kind: "receipt", quantity: 5, unitCost: 130 }), 200);
    await json(await move({ itemId: dal, kind: "issue", quantity: 4, outletId: null }), 200);

    const days = await json(await call("GET", "/days"), 200);
    expect((days.days as string[]).length).toBe(14);
    expect((days.days as string[]).at(-1)).toBe(days.today);
    const mine = (days.rows as { itemId: string; kind: string; quantity: number; value: number | null }[])
      .filter((r) => r.itemId === dal)
      .map(({ kind, quantity, value }) => ({ kind, quantity, value }))
      .sort((a, b) => a.kind.localeCompare(b.kind));
    /* Issued: 5 at 100, then 4 at (5 x 100 + 5 x 130) / 10 = 115. */
    expect(mine).toEqual([
      { kind: "issue", quantity: -9, value: 960 },
      { kind: "receipt", quantity: 15, value: 1650 },
    ]);
    expect(days.foodCostBasis).toBe("before_gst");
    expect(days.sales, "the Inventory Manager does not read reports").toBeNull();
    expect(typeof days.occupied).toBe("object");

    const forGm = await json(await as(gm)("GET", "/days"), 200);
    expect(forGm.sales).not.toBeNull();
  });
});
