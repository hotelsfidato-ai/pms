import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   A DISCOUNT IS THE GM'S (the owner's D27-352, 21 October)

   A discount or a promotion on a restaurant bill is for the GM, the owner
   and an administrator only. A waiter and the bar, who ring orders up,
   are refused by the server, not only by a hidden button.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "DISCWHO";
let owner = "";
let gm = "";
let waiter = "";
let bar = "";
let tikka = "";
const orders: string[] = [];

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const post = (who: string, path: string, body: unknown = {}) =>
  app.request(`/api/hotels/5EL${path}`, {
    method: "POST",
    headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

async function openBill(table: string): Promise<string> {
  const opened = await post(owner, "/till/orders", { outlet: "REST", table: `${TAG} ${table}` });
  expect(opened.status, await opened.clone().text()).toBe(200);
  const { id } = (await opened.json()) as { id: string };
  orders.push(id);
  expect((await post(owner, `/till/orders/${id}/lines`, { itemId: tikka, qty: 1 })).status).toBe(200);
  return id;
}

const tenOff = { type: "percent", value: 10, reason: "Regular guest" };

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
  gm = await person("discwho-gm@fidato.in", "DISCWHO Manager", "gm");
  waiter = await person("discwho-waiter@fidato.in", "DISCWHO Waiter", "pos");
  bar = await person("discwho-bar@fidato.in", "DISCWHO Bar", "bar");
  const res = await app.request("/api/hotels/5EL/till/menu", { headers: { "x-dev-staff-id": owner } });
  const menu = (await res.json()) as { categories: { items: { id: string; name: string }[] }[] };
  tikka = menu.categories.flatMap((c) => c.items).find((i) => i.name === "Paneer Tikka")!.id;
});

afterAll(async () => {
  for (const id of orders) await post(owner, `/till/orders/${id}/abandon`, { reason: "discount test" });
  await sql("delete from staff_hotels where staff_id = any($1::uuid[])", [[gm, waiter, bar]]);
  await closePool();
});

describe("D27-352: a discount is for the GM, the owner and an administrator", () => {
  it("a waiter and the bar are refused a discount, a promotion and clearing one", async () => {
    const id = await openBill("refused");
    for (const who of [waiter, bar]) {
      expect((await post(who, `/till/orders/${id}/discount`, tenOff)).status).toBe(403);
      expect((await post(who, `/till/orders/${id}/promotion`, { promotionId: null })).status).toBe(403);
      expect((await post(who, `/till/orders/${id}/discount/clear`)).status).toBe(403);
    }
    const [o] = await sql<{ discount_value: string | null }>(
      "select discount_value::text from pos_orders where id = $1", [id]);
    expect(o!.discount_value, "no discount went on").toBeNull();
  });

  it("the GM gives one", async () => {
    const id = await openBill("gm");
    const res = await post(gm, `/till/orders/${id}/discount`, tenOff);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as { discount: number }).discount).toBeGreaterThan(0);
  });
});
