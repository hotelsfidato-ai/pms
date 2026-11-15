import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE KOT SAYS WHERE THE TABLE IS (the owner, 16 November)

   Restaurant and Bar number their tables alike, so "Table No: 4" alone
   sent the kitchen to the wrong one. The docket carries the table's
   section beside its outlet; an order on no table of the floor has none.
   At 5EL, on a free table of the demo's A/C and Bar sections; the orders
   are removed afterwards (MEMORY 476).
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";

let owner = "";
let roti = "";
const orders: string[] = [];

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}
const call = (method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method,
    headers: { "x-dev-staff-id": owner, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** A free table of a 5EL section, by the section's name. */
const freeTable = async (section: string) => (await sql<{ id: string }>(
  `select t.id::text from pos_tables t
     join pos_sections s on s.id = t.section_id and s.name = $1
     join hotels h on h.id = s.hotel_id and h.code = '5EL'
    where t.is_active and not exists (select 1 from pos_orders o
      where o.table_id = t.id and o.status = 'open')
    order by t.label limit 1`, [section]))[0]!.id;

/** A Butter Roti sent to the kitchen; the docket the KOT station reads. */
async function docketOf(where: { tableId?: string; table?: string; orderType?: string }) {
  const res = await call("POST", "/till/orders/batch",
    { outlet: "REST", orderType: "dine_in", ...where, lines: [{ itemId: roti, qty: 1 }], send: true });
  expect(res.status, await res.clone().text()).toBe(200);
  const o = (await res.json()) as { id: string; kotNo: number };
  orders.push(o.id);
  const d = await call("GET", `/till/orders/${o.id}/kot/${o.kotNo}`);
  expect(d.status, await d.clone().text()).toBe(200);
  return (await d.json()) as { outlet: string; section?: string | null };
}

beforeAll(async () => {
  owner = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  const res = await call("GET", "/till/menu");
  roti = ((await res.json()) as { categories: { items: { id: string; name: string }[] }[] })
    .categories.flatMap((c) => c.items).find((i) => i.name === "Butter Roti")!.id;
});

afterAll(async () => {
  await sql("delete from pos_kot_prints where order_id = any($1::uuid[])", [orders]);
  await sql("delete from pos_order_lines where order_id = any($1::uuid[])", [orders]);
  await sql("delete from pos_orders where id = any($1::uuid[])", [orders]);
  await closePool();
});

describe("the KOT names the table's section", () => {
  it("an A/C table's docket says A/C, a Bar table's says Bar, both in the outlet", async () => {
    const ac = await docketOf({ tableId: await freeTable("A/C") });
    expect(ac.section).toBe("A/C");
    const bar = await docketOf({ tableId: await freeTable("Bar") });
    expect(bar.section).toBe("Bar");
    expect(bar.outlet).toBe(ac.outlet);
  });

  it("an order on no table of the floor has no section", async () => {
    const poolside = await docketOf({ table: "Poolside" });
    expect(poolside.section ?? null).toBeNull();
  });
});
