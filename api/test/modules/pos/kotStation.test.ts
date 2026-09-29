import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE KOT STATION (D27-159, D27-161, D27-167)

   One device per outlet prints every KOT. Switched on by the kitchen
   manager, the owner, an administrator or the GM - never the chef; on
   elsewhere moves it; off only from the station. The station is told what
   to print: sent since it was switched on, not yet printed, on the business
   date. The first claim prints; a second tab's is told no; a device that is
   not the station is refused.

   On an outlet of its own (KOTST), removed afterwards.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const OUTLET = "KOTST";
const A = "device-aaaa-1111";
const B = "device-bbbb-2222";

async function sql<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

let owner = "";
let chef = "";
let kitchen = "";
let tikka = "";

const call = (who: string, method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method,
    headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

async function person(role: string): Promise<string> {
  const email = `kotst-${role}@fidato.in`;
  const id = (await sql<{ id: string }>(
    `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
     on conflict (email) do update set is_active = true returning id::text`,
    [email, `KOTST ${role}`, `test-uid-kotst-${role}`]))[0]!.id;
  await sql("delete from staff_hotels where staff_id = $1", [id]);
  await sql(`insert into staff_hotels (staff_id, hotel_id, role)
             select $1, id, $2 from hotels where code = '5EL'`, [id, role]);
  return id;
}

/** A docket at the test outlet: an order, a dish, sent. */
async function docket(): Promise<{ orderId: string; kotNo: number }> {
  const opened = await call(owner, "POST", "/till/orders", { outlet: OUTLET });
  expect(opened.status, await opened.clone().text()).toBe(200);
  const { id } = (await opened.json()) as { id: string };
  expect((await call(owner, "POST", `/till/orders/${id}/lines`, { itemId: tikka, qty: 1 })).status).toBe(200);
  const sent = await call(owner, "POST", `/till/orders/${id}/kot`);
  expect(sent.status, await sent.clone().text()).toBe(200);
  return { orderId: id, kotNo: ((await sent.json()) as { kotNo: number }).kotNo };
}

const poll = async (device: string) =>
  (await (await call(kitchen, "POST", `/till/kot-station/${OUTLET}/poll`, { device })).json()) as {
    station: boolean;
    due?: { orderId: string; kotNo: number }[];
    recent?: { orderId: string; kotNo: number; printedAt: string | null }[];
  };
const switchOn = (who: string, device: string, name = "Kitchen PC") =>
  call(who, "POST", `/till/kot-station/${OUTLET}`, { device, name, on: true });
const claim = (device: string, d: { orderId: string; kotNo: number }) =>
  call(chef, "POST", `/till/orders/${d.orderId}/kot/${d.kotNo}/printed`, { device });
const stationOf = async (device: string) => {
  const res = await call(chef, "GET", `/till/kot-station?device=${device}`);
  expect(res.status, await res.clone().text()).toBe(200);
  const body = (await res.json()) as {
    outlets: { code: string; station: { name: string; mine: boolean; online: boolean } | null }[];
  };
  return body.outlets.find((o) => o.code === OUTLET)!.station;
};

beforeAll(async () => {
  owner = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  chef = await person("chef");
  kitchen = await person("kitchen_manager");
  await sql(`insert into pos_outlets (hotel_id, code, name, category, staff_id)
             select id, $1, 'KOT station test', 'food', $2 from hotels where code = '5EL'`,
  [OUTLET, owner]);
  const res = await call(owner, "GET", "/till/menu");
  const menu = (await res.json()) as { categories: { items: { id: string; name: string }[] }[] };
  tikka = menu.categories.flatMap((c) => c.items).find((i) => i.name === "Paneer Tikka")!.id;
});

afterAll(async () => {
  await sql("delete from pos_kot_prints where order_id in (select o.id from pos_orders o join pos_outlets ou on ou.id = o.outlet_id where ou.code = $1)", [OUTLET]);
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try {
    await db.query("alter table pos_order_lines disable trigger pos_order_lines_frozen");
    await db.query(`delete from pos_orders where outlet_id in
                      (select id from pos_outlets where code = $1)`, [OUTLET]);
  } finally {
    await db.query("alter table pos_order_lines enable trigger pos_order_lines_frozen");
    await db.end();
  }
  await sql("delete from pos_outlets where code = $1", [OUTLET]);
  for (const id of [chef, kitchen]) {
    await sql("delete from staff_hotels where staff_id = $1", [id]);
    await sql("update staff set is_active = false where id = $1", [id]);
  }
  await closePool();
});

describe("switching the KOT printer (D27-161)", () => {
  it("is not the chef's; wants a name; on elsewhere moves it; off only from the station", async () => {
    expect((await switchOn(chef, A)).status).toBe(403);
    expect(await stationOf(A)).toBeNull();

    const nameless = await switchOn(kitchen, A, "  ");
    expect(nameless.status).toBe(409);
    expect(((await nameless.json()) as { reason: string }).reason)
      .toBe("Type a name for this device, for example Kitchen PC.");

    expect((await switchOn(kitchen, A)).status).toBe(200);
    expect(await stationOf(A)).toMatchObject({ name: "Kitchen PC", mine: true, online: true });
    expect(await stationOf(B)).toMatchObject({ mine: false });

    expect((await switchOn(owner, B, "Till PC")).status).toBe(200);
    expect(await stationOf(A)).toMatchObject({ name: "Till PC", mine: false });

    const stale = await call(kitchen, "POST", `/till/kot-station/${OUTLET}`, { device: A, on: false });
    expect(stale.status).toBe(409);
    expect(await stationOf(B)).toMatchObject({ name: "Till PC", mine: true });
  });
});

describe("what the station prints (D27-159, D27-167)", () => {
  it("prints what was sent since it was switched on, once, and only on the station", async () => {
    const before = await docket();
    expect((await switchOn(kitchen, A)).status).toBe(200);
    const after = await docket();

    expect(await poll(B)).toEqual({ station: false });
    const due = (await poll(A)).due!;
    expect(due.map((d) => d.orderId)).toEqual([after.orderId]);
    expect(due.map((d) => d.orderId)).not.toContain(before.orderId);

    const refused = await claim(B, after);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { reason: string }).reason)
      .toBe("This device is not the KOT printer here.");

    const first = await claim(A, after);
    expect(first.status, await first.clone().text()).toBe(200);
    expect(await first.json()).toEqual({ ok: true, claimed: true });
    expect(await (await claim(A, after)).json()).toEqual({ ok: true, claimed: false });

    const next = await poll(A);
    expect(next.due).toEqual([]);
    expect(next.recent!.find((r) => r.orderId === after.orderId)!.printedAt).not.toBeNull();
  });

  it("catches up on the business date only: an older missed KOT waits for a reprint", async () => {
    const old = await docket();
    const today = await docket();
    await sql("update pos_orders set business_date = business_date - 1 where id = $1", [old.orderId]);

    const due = (await poll(A)).due!.map((d) => d.orderId);
    expect(due).toContain(today.orderId);
    expect(due).not.toContain(old.orderId);
  });
});
