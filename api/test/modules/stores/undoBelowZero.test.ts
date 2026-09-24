import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   AN UNDO MAY NOT LEAVE LESS THAN NOTHING — STO-11

   50 kg of rice received, 12 issued, then the delivery undone: the shelf
   read −12 kg. The Issue button already refuses to overdraw; an undo did
   not ask. The owner, 16 September: refuse it, and say why.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

const TAG = "STO11TEST";
const HOTEL = "5EL";
let keeper: string;
let mainId: string;
let kitchenId: string;

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

const move = async (itemId: string, kind: string, quantity: number, locationId = mainId) =>
  (await json(await call("POST", "/movements", {
    itemId, locationId, kind, quantity, ...(kind === "receipt" ? { unitCost: 90 } : {}),
    ...(kind === "issue" ? { outletId: null } : {}),   // not an outlet (D22-20)
  }), 200)).id as string;

const onHand = async (itemId: string) => Number((await sql(
  "select app.stock_on_hand($1)::text as n", [itemId])).rows[0].n);

const reversals = async (movementId: string) => Number((await sql(
  "select count(*)::int as n from stock_movements where reverses_id = $1",
  [movementId])).rows[0].n);

beforeAll(async () => {
  const storeNamed = async (name: string) => (await sql(
    `select l.id::text from locations l join hotels h on h.id = l.hotel_id
      where h.code = $1 and l.name = $2`, [HOTEL, name])).rows[0].id as string;
  mainId = await storeNamed("Main store");
  kitchenId = await storeNamed("Kitchen store");

  const { rows } = await sql(
    `insert into staff (email, full_name, firebase_uid)
     values ('sto11-keeper@fidato.in', '${TAG} keeper', 'test-uid-sto11')
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

describe("undoing a movement (STO-11)", () => {
  it("refuses an undo that would take the shelf below zero, says why, and writes nothing", async () => {
    const rice = await newItem("rice");
    const delivery = await move(rice, "receipt", 50);
    await move(rice, "issue", 12);

    const body = await json(await call("POST", `/movements/${delivery}/reverse`, {}), 409);
    expect(body.ok).toBe(false);
    expect(body.reason).toMatch(/would leave −12 kg of STO11TEST rice in Main store - 12 kg of it has already gone out/);
    expect(body.reason).toMatch(/Correct the count instead/);

    expect(await reversals(delivery)).toBe(0);
    expect(await onHand(rice)).toBe(38);
  });

  it("still lets an undo through that leaves the shelf at zero or more", async () => {
    const oil = await newItem("oil");
    const delivery = await move(oil, "receipt", 10);

    await json(await call("POST", `/movements/${delivery}/reverse`, {}), 200);
    expect(await reversals(delivery)).toBe(1);
    expect(await onHand(oil)).toBe(0);
  });

  it("refuses to undo a move when the store it went into has already used some (106)", async () => {
    const flour = await newItem("flour");
    await move(flour, "receipt", 10);
    const moved = await json(await call("POST", "/transfers", {
      itemId: flour, fromId: mainId, toId: kitchenId, quantity: 10,
    }), 200);
    await move(flour, "issue", 4, kitchenId);

    const { rows } = await sql(
      "select id::text from stock_movements where transfer_id = $1 and quantity > 0",
      [moved.transferId]);
    const body = await json(await call("POST", `/movements/${rows[0].id}/reverse`, {}), 409);
    expect(body.reason).toMatch(/Undoing this move would leave −4 kg of STO11TEST flour in Kitchen store/);
    expect(Number((await sql(
      "select count(*)::int as n from stock_movements m join stock_movements t on t.id = m.reverses_id where t.transfer_id = $1",
      [moved.transferId])).rows[0].n)).toBe(0);
  });

  it("lets an issue be undone — it only puts stock back", async () => {
    const soap = await newItem("soap");
    await move(soap, "receipt", 5);
    const issue = await move(soap, "issue", 5);

    await json(await call("POST", `/movements/${issue}/reverse`, {}), 200);
    expect(await onHand(soap)).toBe(5);
  });
});
