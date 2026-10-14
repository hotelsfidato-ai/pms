import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   A REPRINTED KOT PRINTS AT THE STATION (the owner's D27-329 (2), (5))

   Reprint - on the order pad, the Till or the Terminal - asks the server.
   The reprint waits for the computer that prints that KOT's kind, where the
   KOT first went (the kitchen's or the bar's), and that computer prints it
   through its own ask and claim, as it prints a new KOT - never on the
   device where Reprint was pressed. Offline, it waits there and the answer
   says so; with no computer for the kind, it is refused. Who: whoever takes
   orders (the waiter, the Bar, and those above), as the pad's Reprint.

   The 5EL demo's Beverages section is sent to the Bar for the test and put
   back; computers, people and orders it makes go at the end.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const KITCHEN_PC = "device-reprint-kitchen";
const BAR_PC = "device-reprint-bar";

async function sql<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

let owner = "";
let waiter = "";
let bar = "";
let chef = "";
let tikka = "";
let lime = "";
let beverages = "";
let kitchenKind = "";
let barKind = "";
const orders: string[] = [];

const call = (who: string, method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method,
    headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const reason = async (res: Response) => ((await res.json()) as { reason: string }).reason;

async function person(role: string): Promise<string> {
  const email = `reprint-${role}@fidato.in`;
  const id = (await sql<{ id: string }>(
    `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
     on conflict (email) do update set is_active = true returning id::text`,
    [email, `REPRINT ${role}`, `test-uid-reprint-${role}`]))[0]!.id;
  await sql("delete from staff_hotels where staff_id = $1", [id]);
  await sql(`insert into staff_hotels (staff_id, hotel_id, role)
             select $1, id, $2 from hotels where code = '5EL'`, [id, role]);
  return id;
}

const thisComputer = (device: string, name: string, kindIds: string[]) =>
  call(owner, "POST", "/till/kot-setup/this-computer", { device, name, kindIds, bills: false });

type Slip = { orderId: string; kotNo: number; kindId: string; kind: string };
type Reprint = Slip & { id: string };
const poll = async (device: string) =>
  (await (await call(chef, "POST", "/till/kot-stations/poll", { device })).json()) as {
    due: Slip[]; reprints?: Reprint[];
  };
const reprintsOf = async (device: string, orderId: string) =>
  ((await poll(device)).reprints ?? []).filter((r) => r.orderId === orderId);

const reprint = (who: string, orderId: string, kotNo: number, kind: unknown) =>
  call(who, "POST", `/till/orders/${orderId}/kot/${kotNo}/reprint`, { kind });
const claim = (device: string, id: string) =>
  call(chef, "POST", `/till/kot-reprints/${id}/printed`, { device });

/** A Paneer Tikka (the kitchen's) and a Fresh Lime Soda (the bar's), sent,
    and both slips printed by their computers - the KOT as it stands when a
    slip is lost. */
async function sentAndPrinted(): Promise<{ orderId: string; kotNo: number }> {
  const opened = await call(owner, "POST", "/till/orders", { outlet: "REST", table: "REPRINT" });
  expect(opened.status, await opened.clone().text()).toBe(200);
  const { id } = (await opened.json()) as { id: string };
  orders.push(id);
  expect((await call(owner, "POST", `/till/orders/${id}/lines`, { itemId: tikka, qty: 1 })).status).toBe(200);
  expect((await call(owner, "POST", `/till/orders/${id}/lines`, { itemId: lime, qty: 2 })).status).toBe(200);
  const sent = await call(owner, "POST", `/till/orders/${id}/kot`);
  expect(sent.status, await sent.clone().text()).toBe(200);
  const kotNo = ((await sent.json()) as { kotNo: number }).kotNo;
  for (const device of [KITCHEN_PC, BAR_PC]) {
    for (const s of (await poll(device)).due.filter((x) => x.orderId === id)) {
      const printed = await call(chef, "POST", `/till/orders/${id}/kot/${kotNo}/printed`, { device, kind: s.kindId });
      expect(await printed.json()).toEqual({ ok: true, claimed: true });
    }
  }
  return { orderId: id, kotNo };
}

beforeAll(async () => {
  owner = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  waiter = await person("pos");
  bar = await person("bar");
  chef = await person("chef");
  const menu = (await (await call(owner, "GET", "/till/menu")).json()) as {
    categories: { id: string; name: string; items: { id: string; name: string }[] }[];
  };
  tikka = menu.categories.flatMap((c) => c.items).find((i) => i.name === "Paneer Tikka")!.id;
  const drinks = menu.categories.find((c) => c.name === "Beverages")!;
  beverages = drinks.id;
  lime = drinks.items[0]!.id;
  const kinds = (await sql<{ id: string; role: string }>(
    `select id::text, role from pos_kot_kinds
      where hotel_id = (select id from hotels where code = '5EL') and role is not null`));
  kitchenKind = kinds.find((k) => k.role === "food")!.id;
  barKind = kinds.find((k) => k.role === "bar")!.id;
  await sql("update pos_menu_categories set kot_kind_id = $2 where id = $1", [beverages, barKind]);
  expect((await thisComputer(KITCHEN_PC, "Kitchen PC", [kitchenKind])).status).toBe(200);
  expect((await thisComputer(BAR_PC, "Bar PC", [barKind])).status).toBe(200);
});

afterAll(async () => {
  await sql("update pos_menu_categories set kot_kind_id = null where id = $1", [beverages]);
  await sql(`delete from pos_kot_reprints where order_id = any($1::uuid[])`, [orders]).catch(() => {});
  await sql(`delete from pos_kot_prints where order_id = any($1::uuid[])`, [orders]);
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try {
    await db.query("alter table pos_order_lines disable trigger pos_order_lines_frozen");
    for (const id of orders) {
      await db.query("delete from pos_order_lines where order_id = $1", [id]);
      await db.query("delete from pos_orders where id = $1", [id]);
    }
  } finally {
    await db.query("alter table pos_order_lines enable trigger pos_order_lines_frozen");
    await db.end();
  }
  await sql(`update pos_kot_kinds set station_id = null, station_since = null
              where station_id in (select id from pos_kot_stations where device like 'device-reprint-%')`);
  await sql("update pos_kot_stations set is_active = false where device like 'device-reprint-%'");
  for (const id of [waiter, bar, chef]) {
    await sql("delete from staff_hotels where staff_id = $1", [id]);
    await sql("update staff set is_active = false where id = $1", [id]);
  }
  await closePool();
});

describe("a reprint goes to the computer that prints the KOT's kind (D27-329 (2))", () => {
  it("waits for that computer alone, which prints it once, claimed first; the KOT stays printed", async () => {
    const d = await sentAndPrinted();
    const asked = await reprint(waiter, d.orderId, d.kotNo, barKind);
    expect(asked.status, await asked.clone().text()).toBe(200);
    expect(await asked.json()).toMatchObject({ ok: true, station: { name: "Bar PC", online: true } });

    const atBar = await reprintsOf(BAR_PC, d.orderId);
    expect(atBar.map((r) => [r.kotNo, r.kind, r.kindId])).toEqual([[d.kotNo, "Bar", barKind]]);
    expect(await reprintsOf(KITCHEN_PC, d.orderId), "not the kitchen's to print").toEqual([]);
    expect((await poll(BAR_PC)).due.some((x) => x.orderId === d.orderId), "not a new KOT").toBe(false);

    expect(await (await claim(KITCHEN_PC, atBar[0]!.id)).json(), "only the Bar's computer claims it")
      .toEqual({ ok: true, claimed: false });
    expect(await (await claim(BAR_PC, atBar[0]!.id)).json()).toEqual({ ok: true, claimed: true });
    expect(await (await claim(BAR_PC, atBar[0]!.id)).json(), "a second tab prints nothing")
      .toEqual({ ok: true, claimed: false });
    expect(await reprintsOf(BAR_PC, d.orderId), "printed once").toEqual([]);
  });

  it("the Bar person reprints too, and the kitchen's slip goes to the kitchen's computer", async () => {
    const d = await sentAndPrinted();
    const asked = await reprint(bar, d.orderId, d.kotNo, kitchenKind);
    expect(asked.status, await asked.clone().text()).toBe(200);
    expect(await asked.json()).toMatchObject({ ok: true, station: { name: "Kitchen PC" } });
    expect((await reprintsOf(KITCHEN_PC, d.orderId)).map((r) => r.kind)).toEqual(["Kitchen"]);
    expect(await reprintsOf(BAR_PC, d.orderId)).toEqual([]);
  });

  it("the computer offline: the reprint waits there, and the answer says so", async () => {
    const d = await sentAndPrinted();
    await sql(`update pos_kot_stations set seen_at = now() - interval '2 hours' where device = $1`, [BAR_PC]);
    const asked = await reprint(waiter, d.orderId, d.kotNo, barKind);
    const body = (await asked.json()) as { station: { name: string; online: boolean; seenAt: string | null } };
    expect(body.station).toMatchObject({ name: "Bar PC", online: false });
    expect(body.station.seenAt, "when it was last seen").toBeTruthy();
    expect((await reprintsOf(BAR_PC, d.orderId)).length, "printed when it is back").toBe(1);
  });

  it("is refused with no computer for the kind, a slip the KOT does not have, or no kind", async () => {
    const d = await sentAndPrinted();
    expect(await reason(await reprint(waiter, d.orderId, 9999, barKind))).toBe("No such KOT.");
    expect(await reason(await reprint(waiter, d.orderId, d.kotNo, undefined))).toBe("Which KOT?");
    expect((await thisComputer(BAR_PC, "Bar PC", [])).status).toBe(200);
    const none = await reprint(waiter, d.orderId, d.kotNo, barKind);
    expect(none.status).toBe(409);
    expect(await reason(none)).toMatch(/^No computer prints Bar KOTs/);
    expect((await thisComputer(BAR_PC, "Bar PC", [barKind])).status).toBe(200);
  });

  it("is for those who take orders: not the chef", async () => {
    const d = await sentAndPrinted();
    expect((await reprint(chef, d.orderId, d.kotNo, barKind)).status).toBe(403);
  });
});
