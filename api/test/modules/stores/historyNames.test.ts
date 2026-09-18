import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   WHO MOVED IT — STO-4, and what an undo undid — STO-6

   An item's history named a mover through `staff`, whose row policies show
   most roles only themselves. So the store keeper saw no names but their
   own, and could not answer "who took the towels". The owner, 16 September:
   the Inventory Manager sees who moved stock; the GM and the owner already
   do; everybody else keeps today's view.

   The refusal of names to the others is half the point: a file that only
   proved the Inventory Manager sees them would pass if EVERYBODY did.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

const TAG = "STO4TEST";
const HOTEL = "5EL";

type Movement = { id: string; who: string | null; note: string | null;
                  isReversal: boolean; reversesKind: string | null };

const ids = new Map<string, string>();
let itemId: string;
let mainId: string;

const call = (staffId: string, method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/${HOTEL}/stores${path}`, {
    method,
    headers: { "x-dev-staff-id": staffId, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const person = async (key: string, role: string) => {
  const { rows } = await sql(
    `insert into staff (email, full_name, firebase_uid)
     values ($1, $2, $3)
     on conflict (email) do update set is_active = true, full_name = excluded.full_name
     returning id::text`,
    [`sto4-${key}@fidato.in`, `${TAG} ${key}`, `test-uid-sto4-${key}`]);
  const id = rows[0].id as string;
  await sql("delete from staff_hotels where staff_id = $1", [id]);
  await sql(
    `insert into staff_hotels (staff_id, hotel_id, role)
     select $1, id, $2 from hotels where code = $3`, [id, role, HOTEL]);
  ids.set(key, id);
  return id;
};

const history = async (asKey: string) => {
  const res = await call(ids.get(asKey)!, "GET", `/items/${itemId}/movements`);
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as { movements: Movement[] }).movements;
};

const noted = (rows: Movement[], note: string) => rows.find((m) => m.note === note)!;

beforeAll(async () => {
  mainId = (await sql(
    `select l.id::text from locations l join hotels h on h.id = l.hotel_id
      where h.code = $1 and l.name = 'Main store'`, [HOTEL])).rows[0].id as string;
  await person("inventory", "stores");
  await person("manager", "hotel_manager");
  await person("housekeeper", "housekeeping");
  await person("kitchen", "kitchen_manager");
  await person("gm", "gm");

  const added = await call(ids.get("manager")!, "POST", "/items",
    { name: `${TAG} towels`, unit: "piece" });
  expect(added.status, await added.clone().text()).toBe(200);
  itemId = ((await added.json()) as { id: string }).id;

  /* The hotel manager receives; the Inventory Manager issues and then
     undoes that issue. */
  for (const [key, body] of [
    ["manager", { kind: "receipt", quantity: 20, unitCost: 300, note: `${TAG} delivery` }],
    ["inventory", { kind: "issue", quantity: 2, note: `${TAG} issue` }],
  ] as const) {
    const res = await call(ids.get(key)!, "POST", "/movements", { itemId, locationId: mainId, ...body });
    expect(res.status, await res.clone().text()).toBe(200);
  }
  const issue = noted(await history("inventory"), `${TAG} issue`);
  const undo = await call(ids.get("inventory")!, "POST", `/movements/${issue.id}/reverse`,
    { note: `${TAG} undo` });
  expect(undo.status, await undo.clone().text()).toBe(200);
});

afterAll(async () => {
  const all = [...ids.values()];
  await sql("delete from staff_hotels where staff_id = any($1)", [all]);
  await sql("update staff set is_active = false where id = any($1)", [all]);
  await closePool();
});

describe("who moved stock, in an item's history (STO-4)", () => {
  it("the Inventory Manager sees the name of a colleague who moved it", async () => {
    const rows = await history("inventory");
    expect(noted(rows, `${TAG} delivery`).who).toBe(`${TAG} manager`);
    expect(noted(rows, `${TAG} issue`).who).toBe(`${TAG} inventory`);
  });

  it("the GM sees it too, as before", async () => {
    expect(noted(await history("gm"), `${TAG} delivery`).who).toBe(`${TAG} manager`);
  });

  it("housekeeping keeps today's view — no colleague's name", async () => {
    expect(noted(await history("housekeeper"), `${TAG} delivery`).who).toBeNull();
  });

  it("the kitchen manager keeps today's view — no colleague's name", async () => {
    expect(noted(await history("kitchen"), `${TAG} delivery`).who).toBeNull();
  });
});

describe("what an undo undid (STO-6)", () => {
  it("names the kind of the movement it reversed", async () => {
    const rows = await history("inventory");
    const undo = noted(rows, `${TAG} undo`);
    expect(undo.isReversal).toBe(true);
    expect(undo.reversesKind).toBe("issue");
    expect(noted(rows, `${TAG} delivery`).reversesKind).toBeNull();
  });
});
