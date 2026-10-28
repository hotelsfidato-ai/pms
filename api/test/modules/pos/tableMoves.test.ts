import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { openTillDay } from "../../drawer.ts";

/* ══════════════════════════════════════════════════════════════════
   TABLE SHIFTING (the owner's D27-370, 27 October)

   Move: an open dine-in order to a free table of its section - its KOTs
   and bill go with it, the old table is free, who and when are kept.
   Join: another table's open order comes onto this one and is closed as
   joined - no sale, no void, not closed unpaid. No slip for either.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "TMOVE";
let owner = "";
let waiter = "";
let viewer = "";
let tikka = "";
let section = "";
let other = "";
const table: Record<string, string> = {};
let putAwayTillDay: () => Promise<void>;

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const call = (who: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, body === undefined
    ? { headers: { "x-dev-staff-id": who } }
    : {
        method: "POST",
        headers: { "x-dev-staff-id": who, "content-type": "application/json" },
        body: JSON.stringify(body),
      });

interface Order {
  id: string; orderNo: string; status: string; table: string | null; payable: number;
  lines: { kotNo: number | null; qty: number }[];
  moves: { from: string; to: string; joined: boolean; by: string | null; at: string }[];
}

/** An open bill on a table, `qty` Paneer Tikka sent to the kitchen. */
async function openOn(label: string, qty = 1, by = owner): Promise<Order> {
  const opened = await call(by, "/till/orders", { outlet: "REST", tableId: table[label] });
  expect(opened.status, await opened.clone().text()).toBe(200);
  const { id } = (await opened.json()) as { id: string };
  expect((await call(by, `/till/orders/${id}/lines`, { itemId: tikka, qty })).status).toBe(200);
  expect((await call(by, `/till/orders/${id}/kot`, {})).status).toBe(200);
  return (await (await call(by, `/till/orders/${id}`)).json()) as Order;
}

const move = (who: string, id: string, label: string) => call(who, `/till/orders/${id}/move`, { tableId: table[label] });
const join = (who: string, id: string, label: string) => call(who, `/till/orders/${id}/join`, { tableId: table[label] });
const reason = async (res: Response) => ((await res.json()) as { reason: string }).reason;

/** What Tables shows on a table. */
async function tile(label: string): Promise<{ state: string; orderId: string | null }> {
  const floor = (await (await call(owner, "/till/floor?outlet=REST")).json()) as {
    sections: { tables: { label: string; state: string; orderId: string | null }[] }[] };
  return floor.sections.flatMap((s) => s.tables).find((t) => t.label === label)!;
}

const abandoned = async () => (await sql<{ n: number }>(
  `select abandoned_orders as n from app.pos_day_summary(
     (select o.id from pos_outlets o join hotels h on h.id = o.hotel_id where h.code = '5EL' and o.code = 'REST'),
     (select app.business_date(id) from hotels where code = '5EL'))`))[0]!.n;

beforeAll(async () => {
  owner = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  const person = async (email: string, name: string, role: string) => {
    const [s] = await sql<{ id: string }>(
      `insert into staff (email, full_name) values ($1, $2)
       on conflict (email) do update set is_active = true returning id::text`, [email, name]);
    await sql(
      `insert into staff_hotels (staff_id, hotel_id, role)
       select $1, id, $2 from hotels where code = '5EL'
       on conflict (staff_id, hotel_id) do update set role = excluded.role`, [s!.id, role]);
    return s!.id;
  };
  waiter = await person("tmove-waiter@fidato.in", "TMOVE Waiter", "pos");
  viewer = await person("tmove-viewer@fidato.in", "TMOVE Viewer", "read_only");

  const mk = async (name: string) => (await sql<{ id: string }>(
    `insert into pos_sections (hotel_id, outlet_id, name)
     select o.hotel_id, o.id, $1 from pos_outlets o join hotels h on h.id = o.hotel_id
      where h.code = '5EL' and o.code = 'REST' returning id::text`, [name]))[0]!.id;
  section = await mk(`${TAG} A`);
  other = await mk(`${TAG} B`);
  for (const [s, labels] of [[section, ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9"]], [other, ["X1"]]] as const) {
    for (const l of labels) {
      table[l] = (await sql<{ id: string }>(
        `insert into pos_tables (hotel_id, section_id, label)
         select hotel_id, id, $2 from pos_sections where id = $1 returning id::text`, [s, `${TAG}${l}`]))[0]!.id;
    }
  }
  const menu = (await (await call(owner, "/till/menu")).json()) as { categories: { items: { id: string; name: string }[] }[] };
  tikka = menu.categories.flatMap((c) => c.items).find((i) => i.name === "Paneer Tikka")!.id;
  putAwayTillDay = await openTillDay("5EL");
});

afterAll(async () => {
  await putAwayTillDay();
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  const mine = `select id from pos_orders where table_id in (select t.id from pos_tables t
                  join pos_sections s on s.id = t.section_id where s.name like '${TAG}%')`;
  try {
    await db.query("alter table pos_order_lines disable trigger pos_order_lines_frozen");
    await db.query(`delete from pos_table_moves where order_id in (${mine})`);
    await db.query(`delete from pos_kot_prints where order_id in (${mine})`);
    await db.query(`delete from pos_order_lines where order_id in (${mine})`);
    await db.query("alter table pos_orders disable trigger pos_orders_joined_stays");
    await db.query(`update pos_orders set joined_into = null, status = 'abandoned', abandoned_reason = 'test'
                     where id in (${mine}) and status = 'joined'`);
    await db.query(`delete from pos_orders where id in (${mine})`);
    await db.query("delete from pos_sections where name like $1", [`${TAG}%`]);
    await db.query("delete from staff_hotels where staff_id = any($1::uuid[])", [[waiter, viewer]]);
  } finally {
    await db.query("alter table pos_order_lines enable trigger pos_order_lines_frozen");
    await db.query("alter table pos_orders enable trigger pos_orders_joined_stays");
    await db.end();
  }
  await closePool();
});

describe("Move to another table", () => {
  it("moves an open order, with its KOTs and its bill, to a free table; the old one is free", async () => {
    const o = await openOn("M1", 1, waiter);
    const kotNo = o.lines[0]!.kotNo!;
    const res = await move(waiter, o.id, "M2");
    expect(res.status, await res.clone().text()).toBe(200);
    const moved = (await res.json()) as Order;
    expect(moved.table).toBe(`${TAG}M2`);
    expect(moved.payable).toBe(o.payable);
    expect(moved.moves).toEqual([{ from: `${TAG}M1`, to: `${TAG}M2`, joined: false, by: "TMOVE Waiter", at: expect.stringMatching(/^\d\d:\d\d$/) }]);
    expect(await tile(`${TAG}M1`)).toMatchObject({ state: "blank", orderId: null });
    expect(await tile(`${TAG}M2`)).toMatchObject({ state: "kot", orderId: o.id });
    /* The KOT, read again (a reprint), heads with the new table. */
    const docket = (await (await call(waiter, `/till/orders/${o.id}/kot/${kotNo}`)).json()) as { table: string };
    expect(docket.table).toBe(`${TAG}M2`);
    /* No slip: nothing asked of a printer. */
    const [p] = await sql<{ n: number }>(
      `select (select count(*) from pos_kot_reprints where order_id = $1)
            + (select count(*) from pos_bill_prints where order_id = $1) as n`, [o.id]);
    expect(Number(p!.n)).toBe(0);
  });

  it("refuses a table with a bill on it, a table in another section, and a viewer", async () => {
    const a = await openOn("M3");
    const b = await openOn("M4");
    let res = await move(owner, a.id, "M4");
    expect(res.status).toBe(409);
    expect(await reason(res)).toBe(`${TAG}M4 already has ${b.orderNo} running on it. Join it instead, or choose a free table.`);
    res = await move(owner, a.id, "X1");
    expect(res.status).toBe(409);
    expect(await reason(res)).toMatch(/is in another section/);
    res = await move(viewer, a.id, "M5");
    expect(res.status).toBe(403);
    const [row] = await sql<{ table_ref: string }>("select table_ref from pos_orders where id = $1", [a.id]);
    expect(row!.table_ref).toBe(`${TAG}M3`);
    await sql("update pos_orders set status = 'abandoned', abandoned_reason = 'test', cleared_at = now() where id = any($1::uuid[])", [[a.id, b.id]]);
  });

  it("refuses a table whose finished bill is not cleared", async () => {
    const a = await openOn("M5");
    const b = await openOn("M6");
    await sql("update pos_orders set status = 'abandoned', abandoned_reason = 'test' where id = $1", [b.id]);
    const res = await move(owner, a.id, "M6");
    expect(res.status).toBe(409);
    expect(await reason(res)).toBe(`${TAG}M6 still has bill ${b.orderNo} on it. Clear the table first.`);
    await sql("update pos_orders set status = 'abandoned', abandoned_reason = 'test', cleared_at = now() where id = any($1::uuid[])", [[a.id, b.id]]);
  });
});

describe("Join another table", () => {
  it("puts the other table's lines and KOTs on this bill and closes it as joined, counted nowhere", async () => {
    const before = await abandoned();
    const a = await openOn("M7", 1, waiter);
    const b = await openOn("M8", 2, waiter);
    const bKot = b.lines[0]!.kotNo!;
    /* B's KOT was printed: its printed mark must go with it, or it prints again. */
    await sql(`insert into pos_kot_prints (hotel_id, order_id, kot_no)
               select hotel_id, id, $2 from pos_orders where id = $1`, [b.id, bKot]);

    const res = await join(waiter, a.id, "M8");
    expect(res.status, await res.clone().text()).toBe(200);
    const joined = (await res.json()) as Order;
    expect(joined.lines.reduce((s, l) => s + l.qty, 0)).toBe(3);
    expect(joined.payable).toBeCloseTo(a.payable + b.payable, 2);
    expect(joined.moves).toEqual([{ from: `${TAG}M8`, to: `${TAG}M7`, joined: true, by: "TMOVE Waiter", at: expect.any(String) }]);

    const [gone] = await sql<{ status: string; joined_into: string; cleared: boolean }>(
      "select status, joined_into::text, cleared_at is not null as cleared from pos_orders where id = $1", [b.id]);
    expect(gone).toEqual({ status: "joined", joined_into: a.id, cleared: true });
    expect(await tile(`${TAG}M8`)).toMatchObject({ state: "blank", orderId: null });
    const [print] = await sql<{ order_id: string }>(
      "select order_id::text from pos_kot_prints where kot_no = $1 and order_id = any($2::uuid[])", [bKot, [a.id, b.id]]);
    expect(print!.order_id).toBe(a.id);
    const docket = (await (await call(waiter, `/till/orders/${a.id}/kot/${bKot}`)).json()) as { table: string };
    expect(docket.table).toBe(`${TAG}M7`);
    /* Not a bill closed unpaid. */
    expect(await abandoned()).toBe(before);
    /* For good: the database keeps it joined. */
    await expect(sql("update pos_orders set status = 'open', joined_into = null where id = $1", [b.id]))
      .rejects.toThrow(/stays joined/);
  });

  it("refuses a discounted or held bill, and a table with no open bill", async () => {
    const a = await openOn("M9");
    let res = await join(owner, a.id, "M8");
    expect(res.status).toBe(409);
    expect(await reason(res)).toBe(`${TAG}M8 has no open bill to join. Move this order there instead.`);

    const b = await openOn("M8");
    const off = await call(owner, `/till/orders/${b.id}/discount`, { type: "percent", value: 5, reason: "regular" });
    expect(off.status, await off.clone().text()).toBe(200);
    res = await join(owner, a.id, "M8");
    expect(res.status).toBe(409);
    expect(await reason(res)).toBe(`Bill ${b.orderNo} has a discount or a round-off on it. Take it off before joining.`);

    expect((await call(owner, `/till/orders/${b.id}/discount/clear`, {})).status).toBe(200);
    await sql("update pos_orders set held_at = now() where id = $1", [b.id]);
    res = await join(owner, a.id, "M8");
    expect(res.status).toBe(409);
    expect(await reason(res)).toBe(`Bill ${b.orderNo} is held. Resume it before joining.`);
    const [still] = await sql<{ status: string }>("select status from pos_orders where id = $1", [b.id]);
    expect(still!.status).toBe("open");
  });
});
