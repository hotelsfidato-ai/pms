import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE RESTAURANT BILL'S HSN/SAC (the owner's D27-344, 19 October)

   The bill carries the code of each kind its lines sell under, from
   Settings > Taxes, as an invoice line carries its own; none set, none sent
   (the paper prints a dash). A kind's code may be an HSN: 4, 6 or 8 digits.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "SACTEST";
let owner = "";
let tikka = "";
let kind = "";
let was: string | null = null;
let category = "";
let kindWas: string | null = null;

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

beforeAll(async () => {
  owner = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  const res = await call("GET", "/till/menu");
  const menu = (await res.json()) as { categories: { items: { id: string; name: string }[] }[] };
  tikka = menu.categories.flatMap((c) => c.items).find((i) => i.name === "Paneer Tikka")!.id;
  /* Its category sells under the restaurant kind for this test (a fresh
     database may have none set), put back after. */
  const [c] = await sql<{ id: string; kind: string | null }>(
    `select c.id::text, c.tax_kind as kind from pos_menu_items i join pos_menu_categories c on c.id = i.category_id
      where i.id = $1`, [tikka]);
  category = c!.id;
  kindWas = c!.kind;
  kind = "restaurant";
  await sql("update pos_menu_categories set tax_kind = $2 where id = $1", [category, kind]);
  was = (await sql<{ code: string }>(
    "select sac_code as code from tax_sac t join hotels h on h.id = t.hotel_id where h.code = '5EL' and t.kind = $1",
    [kind]))[0]?.code ?? null;
});

afterAll(async () => {
  await call("PUT", `/tax/${kind}/sac`, { sacCode: was });
  await sql("update pos_menu_categories set tax_kind = $2 where id = $1", [category, kindWas]);
  /* As cashLimit.test.ts clears its bills: the lines' freeze is the till's
     guard on a real bill, not on a test's. */
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER, max: 1 });
  try {
    await db.query("alter table pos_order_lines disable trigger pos_order_lines_frozen");
    await db.query("delete from pos_orders where table_ref like $1", [`${TAG}%`]);
  } finally {
    await db.query("alter table pos_order_lines enable trigger pos_order_lines_frozen");
    await db.end();
  }
  await closePool();
});

const bill = async () => {
  const opened = await call("POST", "/till/orders", { outlet: "REST", table: `${TAG} bill` });
  expect(opened.status, await opened.clone().text()).toBe(200);
  const { id } = (await opened.json()) as { id: string };
  const added = await call("POST", `/till/orders/${id}/lines`, { itemId: tikka, qty: 1 });
  expect(added.status, await added.clone().text()).toBe(200);
  return ((await (await call("GET", `/till/orders/${id}`)).json()) as { hotelSac: string | null }).hotelSac;
};

describe("the restaurant bill's HSN/SAC", () => {
  it("carries the code of the kind its lines sell under, and nothing where none is set", async () => {
    const set = await call("PUT", `/tax/${kind}/sac`, { sacCode: "996331" });
    expect(set.status, `${kind}: ${await set.clone().text()}`).toBe(200);
    expect(await bill()).toBe("996331");
    expect((await call("PUT", `/tax/${kind}/sac`, { sacCode: null })).status).toBe(200);
    expect(await bill()).toBeNull();
  });

  it("takes an HSN of 4 or 8 digits, and refuses anything else in words", async () => {
    expect((await call("PUT", `/tax/${kind}/sac`, { sacCode: "22011010" })).status).toBe(200);
    expect((await call("PUT", `/tax/${kind}/sac`, { sacCode: "2201" })).status).toBe(200);
    const bad = await call("PUT", `/tax/${kind}/sac`, { sacCode: "22011" });
    expect(bad.status).toBe(409);
    expect(await bad.text()).toContain("An HSN or SAC code is 4, 6 or 8 digits");
  });
});
