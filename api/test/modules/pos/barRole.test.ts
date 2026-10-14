import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { READ_RULES, WRITE_RULES, allows } from "../../../src/roleGate.ts";
import { RESOURCES, grantsFor } from "../../../src/permissions.ts";

/* ══════════════════════════════════════════════════════════════════
   THE BAR ROLE, AND THE WAITER'S KOT REPRINT (the owner's D27-324 (2), (4))

   A Bar person has the waiter's rights, sees only the bar's menu sections
   and orders only from them: a dish is the bar's when it prints on the Bar
   KOT (its section's kind, else its tax heading's). The server refuses the
   rest in a sentence, and the database behind it. A waiter and a Bar person
   read their order's KOTs, to reprint one from the order screen.

   Its own section, dish, people and orders, removed afterwards.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";

async function sql<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}
const call = (who: string, method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method,
    headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const reason = async (res: Response) => ((await res.json()) as { reason: string }).reason;

async function person(role: string): Promise<string> {
  const id = (await sql<{ id: string }>(
    `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
     on conflict (email) do update set is_active = true returning id::text`,
    [`barrole-${role}@fidato.in`, `BARROLE ${role}`, `test-uid-barrole-${role}`]))[0]!.id;
  await sql("delete from staff_hotels where staff_id = $1", [id]);
  await sql(`insert into staff_hotels (staff_id, hotel_id, role)
             select $1, id, $2 from hotels where code = '5EL'`, [id, role]);
  return id;
}

let bar = "";
let waiter = "";
let drinks = "";
let beer = "";
let tikka = "";
const orders: string[] = [];

type Menu = { categories: { id: string; name: string; items: { id: string; name: string }[] }[] };
type OrderRead = { id: string; lines: { id: string; name: string; qty: number; kotNo?: number | null; kotKindId?: string | null }[] };

const open = async (who: string, table: string) => {
  const res = await call(who, "POST", "/till/orders", { outlet: "REST", table });
  expect(res.status, await res.clone().text()).toBe(200);
  const { id } = (await res.json()) as { id: string };
  orders.push(id);
  return id;
};

beforeAll(async () => {
  /* A drinks section by its heading (Bar), so it prints on the Bar KOT. */
  drinks = (await sql<{ id: string }>(
    `insert into pos_menu_categories (hotel_id, name, tax_kind)
     select id, 'BARROLE drinks', 'bar' from hotels where code = '5EL' returning id::text`))[0]!.id;
  beer = (await sql<{ id: string }>(
    `insert into pos_menu_items (hotel_id, category_id, name, price, tax_rate)
     select hotel_id, id, 'BARROLE beer', 300, 18 from pos_menu_categories where id = $1
     returning id::text`, [drinks]))[0]!.id;
  tikka = (await sql<{ id: string }>(
    `select i.id::text from pos_menu_items i join hotels h on h.id = i.hotel_id
      where h.code = '5EL' and i.name = 'Paneer Tikka'`))[0]!.id;
  waiter = await person("pos");
  bar = await person("bar");
});

afterAll(async () => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try {
    await db.query("alter table pos_order_lines disable trigger pos_order_lines_frozen");
    for (const id of orders) {
      await db.query("delete from pos_kot_prints where order_id = $1", [id]);
      await db.query("delete from pos_order_lines where order_id = $1", [id]);
      await db.query("delete from pos_orders where id = $1", [id]);
    }
  } finally {
    await db.query("alter table pos_order_lines enable trigger pos_order_lines_frozen");
    await db.end();
  }
  await sql("delete from pos_menu_items where id = $1", [beer]);
  await sql("delete from pos_menu_categories where id = $1", [drinks]);
  for (const id of [bar, waiter].filter(Boolean)) {
    await sql("delete from staff_hotels where staff_id = $1", [id]);
    await sql("update staff set is_active = false where id = $1", [id]);
  }
  await closePool();
});

describe("the Bar role has exactly the waiter's rights (D27-324 (2))", () => {
  it("in the matrix", () => {
    for (const r of RESOURCES) expect(grantsFor("bar", r), r).toEqual(grantsFor("pos", r));
  });

  it("at every door of the server", () => {
    for (const [key, rule] of [...Object.entries(WRITE_RULES), ...Object.entries(READ_RULES)]) {
      expect(allows(rule, "bar"), key).toBe(allows(rule, "pos"));
    }
  });
});

describe("a Bar person sees and orders only the bar's dishes", () => {
  it("reads only the sections that print on the Bar KOT", async () => {
    const res = await call(bar, "GET", "/till/menu");
    expect(res.status, await res.clone().text()).toBe(200);
    const names = ((await res.json()) as Menu).categories.map((c) => c.name);
    expect(names).toContain("BARROLE drinks");
    expect(names).not.toContain("Starters");

    /* A waiter still reads the whole menu. */
    const all = ((await (await call(waiter, "GET", "/till/menu")).json()) as Menu).categories.map((c) => c.name);
    expect(all).toEqual(expect.arrayContaining(["BARROLE drinks", "Starters"]));
  });

  it("orders a drink, and is refused a kitchen dish in a sentence - nothing written", async () => {
    const id = await open(bar, "BARROLE1");
    const drink = await call(bar, "POST", `/till/orders/${id}/lines`, { itemId: beer, qty: 2 });
    expect(drink.status, await drink.clone().text()).toBe(200);

    const food = await call(bar, "POST", `/till/orders/${id}/lines`, { itemId: tikka, qty: 1 });
    expect(food.status).toBe(409);
    expect(await reason(food)).toBe("Paneer Tikka is not on the bar's menu. A waiter orders it.");

    const batch = await call(bar, "POST", "/till/orders/batch", {
      orderId: id, lines: [{ itemId: beer, qty: 1 }, { itemId: tikka, qty: 1 }] });
    expect(batch.status).toBe(409);

    const lines = (await sql<{ name: string; qty: string }>(
      "select name, qty::text from pos_order_lines where order_id = $1 order by id", [id]));
    expect(lines).toEqual([{ name: "BARROLE beer", qty: "2" }]);
  });

  it("may not raise the count of a kitchen dish a waiter put on", async () => {
    const id = await open(waiter, "BARROLE2");
    const added = await call(waiter, "POST", `/till/orders/${id}/lines`, { itemId: tikka, qty: 1 });
    expect(added.status, await added.clone().text()).toBe(200);
    const line = ((await added.json()) as OrderRead).lines.find((l) => l.name === "Paneer Tikka")!;

    const more = await call(bar, "POST", `/till/orders/${id}/lines/${line.id}/qty`, { qty: 2 });
    expect(more.status).toBe(409);
    expect(await reason(more)).toBe("Paneer Tikka is not on the bar's menu. A waiter orders it.");
  });

  it("is refused by the database too, whatever route is taken", async () => {
    const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
    const client = await db.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.user_id', $1, true)", [bar]);
      await expect(client.query(
        `insert into pos_order_lines (order_id, hotel_id, item_id, name, qty, unit_price, tax_rate, added_by)
         select $1, hotel_id, id, name, 1, price, 5, $2::uuid from pos_menu_items where id = $3`,
        [orders[0], bar, tikka])).rejects.toThrow(/bar's dishes/);
    } finally {
      await client.query("rollback");
      client.release();
      await db.end();
    }
  });
});

describe("a waiter and a Bar person reprint their order's KOT (D27-324 (4))", () => {
  it("the order says each line's KOT and its kind, and the KOT reads back", async () => {
    for (const who of [bar, waiter]) {
      const id = await open(who, who === bar ? "BARROLE3" : "BARROLE4");
      expect((await call(who, "POST", `/till/orders/${id}/lines`, { itemId: beer, qty: 1 })).status).toBe(200);
      const sent = await call(who, "POST", `/till/orders/${id}/kot`);
      expect(sent.status, await sent.clone().text()).toBe(200);
      const { kotNo } = (await sent.json()) as { kotNo: number };

      const order = (await (await call(who, "GET", `/till/orders/${id}`)).json()) as OrderRead;
      const line = order.lines.find((l) => l.name === "BARROLE beer")!;
      expect(line.kotNo).toBe(kotNo);
      const barKind = (await sql<{ id: string }>(
        `select k.id::text from pos_kot_kinds k join hotels h on h.id = k.hotel_id
          where h.code = '5EL' and k.role = 'bar'`))[0]!.id;
      expect(line.kotKindId).toBe(barKind);

      const slip = await call(who, "GET", `/till/orders/${id}/kot/${kotNo}?kind=${barKind}`);
      expect(slip.status, await slip.clone().text()).toBe(200);
      expect(((await slip.json()) as { kind: { name: string } }).kind.name).toBe("Bar");
    }
  });
});
