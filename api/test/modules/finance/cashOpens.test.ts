import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE DESK'S DRAWER OPENS BY ITSELF - the owner's D27-200 and D27-201

   No counting step after the night audit. A receptionist's drawer opens
   the first time they take cash (the payment's own test is in
   billControls) or record money in or out - on the float a close handed
   to them BY NAME, and ₹0 for anyone else. A kept float is carried into
   one drawer, once: cashier_float_claims' primary key is the rule. A
   handover to somebody whose drawer is already open adds to it.
   Everything is tagged CASHOPEN and put away afterwards.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "CASHOPEN";

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const as = (who: string, method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method,
    headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const people: Record<string, string> = {};
const ids = () => Object.values(people);

/** The person's open drawer, if any. */
const drawer = async (who: string) => (await sql<{ id: string; opening: string }>(
  "select id::text, opening_cash::text as opening from cashier_shifts where staff_id = $1 and closed_at is null",
  [who]))[0];
/** Money in: the smallest act that needs a drawer, so it opens one. */
const cashIn = (who: string, amount = 10) =>
  as(who, "POST", "/cashier-shift/movements", { kind: "top_up", amount, reason: `${TAG} change` });
/** Counts `notes` x ₹500 and closes, keeping `kept` for `to`. */
async function close(who: string, notes: number, kept: number, to?: string) {
  expect((await as(who, "POST", "/cashier-shift/count",
    { denominations: [{ value: 500, count: notes }] })).status).toBe(200);
  return as(who, "POST", "/cashier-shift/close",
    { varianceReason: `${TAG} counted`, keptCash: kept, ...(to ? { handOverTo: to } : {}) });
}

beforeAll(async () => {
  for (const key of ["anil", "bina", "chitra"]) {
    const [p] = await sql<{ id: string }>(
      `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
       on conflict (email) do update set is_active = true returning id::text`,
      [`cashopen-${key}@fidato.in`, `${TAG} ${key}`, `test-uid-cashopen-${key}`]);
    people[key] = p!.id;
    await sql("delete from staff_hotels where staff_id = $1", [p!.id]);
    await sql(
      "insert into staff_hotels (staff_id, hotel_id, role) select $1, id, 'front_desk' from hotels where code = '5EL'",
      [p!.id]);
  }
  await sql("delete from cashier_shifts where staff_id = any($1) or handed_to = any($1)", [ids()]);
});

afterAll(async () => {
  await sql("delete from cashier_shifts where staff_id = any($1) or handed_to = any($1)", [ids()]);
  await sql("delete from staff_hotels where staff_id = any($1)", [ids()]);
  await sql("update staff set is_active = false where id = any($1)", [ids()]);
  await closePool();
});

describe("a drawer opens by itself (D27-200)", () => {
  it("at ₹0 for somebody nothing was handed to, on their first money in or out", async () => {
    const { anil } = people;
    expect(await drawer(anil!)).toBeUndefined();
    const view = (await (await as(anil!, "GET", "/cashier-shift")).json()) as { shift: unknown; waiting: number };
    expect([view.shift, view.waiting]).toEqual([null, 0]);
    /* Looking at Cashiering opens nothing: an open drawer must be counted before the audit. */
    expect(await drawer(anil!)).toBeUndefined();

    const refused = await as(anil!, "POST", "/cashier-shift/movements", { kind: "top_up", amount: 10 });
    expect(refused.status).toBe(409);
    expect(await drawer(anil!), "a refusal opens nothing").toBeUndefined();

    expect((await cashIn(anil!, 2000)).status).toBe(200);
    expect(Number((await drawer(anil!))!.opening)).toBe(0);
  });
});

describe("a kept float names the next person, and is carried once (D27-201)", () => {
  it("is refused above ₹0 with nobody named; ₹0 needs no name", async () => {
    const { anil } = people;
    const nameless = await close(anil!, 4, 1500);
    expect(nameless.status).toBe(409);
    expect(((await nameless.json()) as { reason: string }).reason).toMatch(/who takes/i);
    expect(await drawer(anil!), "still open").toBeTruthy();
  });

  it("waits for the person it was handed to; anyone else starts at ₹0", async () => {
    const { anil, bina, chitra } = people;
    const handed = await close(anil!, 4, 1500, bina);
    expect(handed.status, await handed.clone().text()).toBe(200);

    const waiting = (await (await as(bina!, "GET", "/cashier-shift")).json()) as { waiting: number };
    expect(waiting.waiting).toBe(1500);

    expect((await cashIn(chitra!)).status).toBe(200);
    expect(Number((await drawer(chitra!))!.opening), "not handed to her").toBe(0);

    expect((await cashIn(bina!)).status).toBe(200);
    expect(Number((await drawer(bina!))!.opening)).toBe(1500);
  });

  it("is not carried a second time", async () => {
    const { bina } = people;
    /* 1500 + 10 in = 1510 expected; 3 x 500 counted, a difference with its reason; nothing kept. */
    const closed = await close(bina!, 3, 0);
    expect(closed.status, await closed.clone().text()).toBe(200);
    expect((await cashIn(bina!)).status).toBe(200);
    expect(Number((await drawer(bina!))!.opening)).toBe(0);

    /* And the database refuses a second taker whatever the code does. */
    const [claim] = await sql<{ closed: string }>(
      `select c.closed_shift_id::text as closed from cashier_float_claims c
         join cashier_shifts s on s.id = c.closed_shift_id where s.handed_to = $1`, [bina]);
    await expect(sql(
      "insert into cashier_float_claims (closed_shift_id, taken_by_shift_id) values ($1, $2)",
      [claim!.closed, (await drawer(bina!))!.id])).rejects.toThrow(/duplicate key/);
  });

  it("is added to the drawer of somebody already open, and not carried again", async () => {
    const { bina, chitra } = people;
    /* Chitra's drawer is open at ₹0 (above); Bina hands her 500 of her count. */
    const handed = await close(bina!, 2, 500, chitra);
    expect(handed.status, await handed.clone().text()).toBe(200);
    expect(Number((await drawer(chitra!))!.opening)).toBe(500);

    const closed = await close(chitra!, 1, 0);
    expect(closed.status, await closed.clone().text()).toBe(200);
    expect((await cashIn(chitra!)).status).toBe(200);
    expect(Number((await drawer(chitra!))!.opening), "taken up when it was added").toBe(0);
  });

  it("a float counted in by hand takes up what was handed, so it is never added on top", async () => {
    const { anil, chitra } = people;
    /* Chitra keeps 500 for Anil; Anil counts his float in on Cashiering instead of waiting. */
    expect((await close(chitra!, 1, 500, anil)).status).toBe(200);
    const open = await as(anil!, "POST", "/cashier-shift/open", { opening: 500 });
    expect(open.status, await open.clone().text()).toBe(200);
    expect(Number((await drawer(anil!))!.opening)).toBe(500);
    const after = await sql<{ waiting: string }>(
      `select app.cashier_float_waiting(h.id, $1)::text as waiting from hotels h where h.code = '5EL'`, [anil]);
    expect(Number(after[0]!.waiting)).toBe(0);
  });
});
