import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { lotsLeft, type Move } from "../../../src/modules/stores/expiry.ts";

/* ══════════════════════════════════════════════════════════════════
   EXPIRY ALERTS ON STOCK (the owner's D27-383, item 11)

   What is past its use-by and still on a shelf, and what is within the
   hotel's warning (7 days to start, migration "expiry warning"): per
   item and store, first expiring first out, the quantity left of each
   delivery. An item with no use-by is never listed. The Store's tiles read
   it; the bell tells whoever corrects the counts; Waste takes it off.
   ══════════════════════════════════════════════════════════════════ */

const SUPER = process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "EXPIRY";
const HOTEL = "5EL";
const pool = new pg.Pool({ connectionString: SUPER });
const sql = async <T>(text: string, values: unknown[] = []) => (await pool.query(text, values)).rows as T[];

let keeper = "", gm = "", cook = "", desk = "", mainId = "", kitchenId = "", today = "";
const day = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const as = (who: string, method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/${HOTEL}${path}`, {
    method, headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const ok = async (res: Response) => {
  expect(res.status, await res.clone().text()).toBe(200);
  return res.json() as Promise<Record<string, unknown>>;
};
type Lot = { storeId: string; quantity: number; useBy: string; receivedOn: string; expired: boolean };
type Item = { id: string; name: string; expiry: Lot[] };
const store = async () => (await ok(await as(keeper, "GET", "/stores"))) as { expiry: { warnDays: number }; items: Item[] };
const lotsOf = async (id: string) => (await store()).items.find((i) => i.id === id)!.expiry;
const newItem = async (name: string) =>
  (await ok(await as(keeper, "POST", "/stores/items", { name: `${TAG} ${name}`, unit: "litre" }))).id as string;
const receive = (itemId: string, quantity: number, expiresOn?: string) =>
  as(keeper, "POST", "/stores/movements", { itemId, locationId: mainId, kind: "receipt", quantity, unitCost: 50,
    ...(expiresOn ? { expiresOn } : {}) });

async function person(key: string, role: string): Promise<string> {
  const [row] = await sql<{ id: string }>(
    `insert into staff (email, full_name) values ($1, $2)
     on conflict (email) do update set is_active = true returning id::text`, [`expiry-${key}@fidato.in`, `${TAG} ${key}`]);
  await sql("delete from staff_hotels where staff_id = $1", [row!.id]);
  await sql("insert into staff_hotels (staff_id, hotel_id, role) select $1, id, $2 from hotels where code = $3",
    [row!.id, role, HOTEL]);
  return row!.id;
}

beforeAll(async () => {
  keeper = await person("keeper", "stores");
  gm = await person("gm", "gm");
  cook = await person("cook", "kitchen_manager");
  desk = await person("desk", "front_desk");
  const places = await sql<{ id: string; name: string }>(
    `select l.id::text, l.name from locations l join hotels h on h.id = l.hotel_id
      where h.code = $1 and l.name in ('Main store', 'Kitchen store')`, [HOTEL]);
  mainId = places.find((p) => p.name === "Main store")!.id;
  kitchenId = places.find((p) => p.name === "Kitchen store")!.id;
  today = (await sql<{ d: string }>(
    "select to_char((now() at time zone timezone)::date, 'YYYY-MM-DD') as d from hotels where code = $1", [HOTEL]))[0]!.d;
});

afterAll(async () => {
  await sql("update hotels set expiry_warn_days = 7 where code = $1", [HOTEL]);
  await pool.end();
  await closePool();
});

/* ── The reading itself: pure, the movements in the order written ───── */

const m = (id: number, over: Partial<Move>): Move => ({
  id: String(id), item: "milk", place: "main", kind: "receipt", quantity: 0, useBy: null,
  day: "2026-11-01", reverses: null, transfer: null, ...over,
});
const left = (moves: Move[]) => lotsLeft(moves)
  .map((l) => `${l.place} ${l.quantity} ${l.useBy ?? "none"}`).sort();

describe("what is left of each delivery: first expiring, first out", () => {
  it("takes from the earliest use-by first, and a delivery with none last", () => {
    expect(left([
      m(1, { quantity: 10, useBy: "2026-11-20" }),
      m(2, { quantity: 10, useBy: "2026-11-10" }),
      m(3, { quantity: 4 }),
      m(4, { kind: "issue", quantity: -15 }),
    ])).toEqual(["main 4 none", "main 5 2026-11-20"]);
  });

  it("a move carries each piece's use-by to the other store, and its undo brings them back", () => {
    const moves = [
      m(1, { quantity: 10, useBy: "2026-11-20" }),
      m(2, { quantity: 5, useBy: "2026-11-10" }),
      /* The half going in written first: still read after the half going out. */
      m(3, { kind: "transfer", place: "kitchen", quantity: 8, transfer: "t1" }),
      m(4, { kind: "transfer", quantity: -8, transfer: "t1" }),
    ];
    expect(left(moves)).toEqual(["kitchen 3 2026-11-20", "kitchen 5 2026-11-10", "main 7 2026-11-20"]);
    expect(left([...moves,
      m(5, { kind: "adjustment", quantity: -8, place: "kitchen", reverses: "3" }),
      m(6, { kind: "adjustment", quantity: 8, reverses: "4" }),
    ])).toEqual(["main 10 2026-11-20", "main 5 2026-11-10"]);
  });

  it("an undone delivery is gone, and an undone issue puts back exactly what it took", () => {
    expect(left([
      m(1, { quantity: 10, useBy: "2026-11-20" }),
      m(2, { quantity: 6, useBy: "2026-11-10" }),
      m(3, { kind: "issue", quantity: -4 }),
      m(4, { kind: "adjustment", quantity: 4, reverses: "3" }),
      m(5, { kind: "adjustment", quantity: -10, reverses: "1" }),
    ])).toEqual(["main 6 2026-11-10"]);
  });

  it("stock gone below nothing is owed, and the next delivery pays it first", () => {
    expect(left([
      m(1, { quantity: 2, useBy: "2026-11-10" }),
      m(2, { kind: "issue", quantity: -5 }),
      m(3, { quantity: 10, useBy: "2026-11-30" }),
    ])).toEqual(["main 7 2026-11-30"]);
  });
});

/* ── Through the Store and the bell ────────────────────────────────── */

describe("the Store lists what is past or near its use-by, per store, oldest first", () => {
  let milk = "", paneer = "", rice = "", salt = "";

  it("lists what is left of each delivery: expired, and within 7 days; never one with no use-by", async () => {
    milk = await newItem("milk");
    paneer = await newItem("paneer");
    rice = await newItem("rice");
    salt = await newItem("salt");
    await ok(await receive(milk, 6, day(-1)));
    await ok(await receive(milk, 4, day(3)));
    await ok(await receive(paneer, 2, day(7)));
    await ok(await receive(rice, 20, day(30)));
    await ok(await receive(salt, 5));

    const s = await store();
    expect(s.expiry.warnDays).toBe(7);
    expect(await lotsOf(milk)).toEqual([
      { storeId: mainId, quantity: 6, useBy: day(-1), receivedOn: expect.any(String), expired: true },
      { storeId: mainId, quantity: 4, useBy: day(3), receivedOn: expect.any(String), expired: false },
    ]);
    expect((await lotsOf(paneer)).map((l) => [l.quantity, l.expired]), "the seventh day is within 7").toEqual([[2, false]]);
    expect(await lotsOf(rice), "a use-by a month away is not listed").toEqual([]);
    expect(await lotsOf(salt), "no use-by: never an alert, never a guess").toEqual([]);
  });

  it("an issue takes the expiring first; moved to the kitchen, the use-by goes with it", async () => {
    await ok(await as(keeper, "POST", "/stores/movements",
      { itemId: milk, locationId: mainId, kind: "issue", quantity: 2, outletId: null }));
    expect((await lotsOf(milk)).map((l) => [l.quantity, l.expired])).toEqual([[4, true], [4, false]]);
    await ok(await as(keeper, "POST", "/stores/transfers", { itemId: milk, fromId: mainId, toId: kitchenId, quantity: 3 }));
    expect((await lotsOf(milk)).map((l) => [l.storeId === kitchenId ? "kitchen" : "main", l.quantity, l.expired]))
      .toEqual([["kitchen", 3, true], ["main", 1, true], ["main", 4, false]]);
  });

  it("the bell tells the Inventory Manager and the GM, and not reception", async () => {
    type Note = { id: string; title: string; body: string; link: string };
    const bell = async (who: string) => (await ok(await as(who, "GET", "/notifications"))) as unknown as Note[];
    for (const who of [keeper, gm]) {
      const notes = await bell(who);
      const expired = notes.find((n) => n.id.startsWith("stock-expired-"));
      expect(expired?.title).toMatch(/past the use-by, still on the shelf$/);
      expect(expired?.body).toContain(`${TAG} milk - Kitchen store: 3 litre, use by`);
      expect(expired?.link).toBe(`/h/${HOTEL}/stores?tile=expired`);
      expect(notes.find((n) => n.id.startsWith("stock-expiring-"))?.title).toMatch(/to use within 7 days$/);
    }
    expect((await bell(desk)).filter((n) => n.id.startsWith("stock-")), "reception is not told").toEqual([]);
  });

  it("Waste takes the expired delivery off, and it leaves the list", async () => {
    for (const [place, quantity] of [[kitchenId, 3], [mainId, 1]] as const) {
      await ok(await as(keeper, "POST", "/stores/movements",
        { itemId: milk, locationId: place, kind: "wastage", quantity, note: "Past its use-by" }));
    }
    expect((await lotsOf(milk)).map((l) => [l.quantity, l.expired])).toEqual([[4, false]]);
  });

  it("the warning is the hotel's: set by the owner, an Admin or the GM, 1 to 90 days; then 30 lists the rice", async () => {
    for (const who of [cook, keeper]) {
      const refused = await as(who, "PUT", "/stores/expiry-warning", { days: 30 });
      expect(refused.status).toBe(403);
      expect(((await refused.json()) as { reason: string }).reason).toBe(
        "How early the Store warns of a use-by is set by the owner, an administrator or the general manager. "
        + "Ask one of them.");
    }
    expect((await store()).expiry, "the screen is told the Inventory Manager may not").toMatchObject({ mayChange: false });
    for (const days of [0, 91, 2.5, "7"]) {
      const bad = await as(gm, "PUT", "/stores/expiry-warning", { days });
      expect(bad.status, String(days)).toBe(409);
      expect(((await bad.json()) as { reason: string }).reason)
        .toBe("Warn from 1 to 90 days before the use-by date: a whole number of days.");
    }
    expect((await store()).expiry.warnDays, "nothing changed").toBe(7);

    await ok(await as(gm, "PUT", "/stores/expiry-warning", { days: 30 }));
    const s = (await ok(await as(gm, "GET", "/stores"))) as { expiry: { warnDays: number; mayChange: boolean } };
    expect(s.expiry).toMatchObject({ warnDays: 30, mayChange: true });
    expect((await lotsOf(rice)).map((l) => [l.quantity, l.useBy])).toEqual([[20, day(30)]]);
    expect(await lotsOf(salt)).toEqual([]);
  });
});
