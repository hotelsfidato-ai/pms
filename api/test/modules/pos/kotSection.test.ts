import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE KOT SECTION OF RESTAURANT SETUP (the owner's D27-292)

   KOT kinds - Kitchen and Bar to start, renamed, more added, the two never
   switched off; a computer prints the kinds ticked on it, one computer per
   kind (ticking elsewhere moves it, and starts afresh); routing per menu
   section, pre-filled from the heading and stamped when sent; one Send,
   one number, one slip per kind, claimed per kind; the bill printer:
   INTERIM BILL, BILL, BILL · DUPLICATE, Print here. Replaces D27-159's
   one-device-per-outlet station (kotStation.test.ts until 9 October).

   The 5EL demo's Beverages section is sent to the Bar for the test and put
   back; computers, kinds and orders it makes go at the end.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const A = "device-kotsec-aaaa";
const B = "device-kotsec-bbbb";

async function sql<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

let owner = "";
let chef = "";
let kitchen = "";
let tikka = "";
let lime = "";
let beverages = "";
let main = "";
const orders: string[] = [];

const call = (who: string, method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method,
    headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const reason = async (res: Response) => ((await res.json()) as { reason: string }).reason;

async function person(role: string): Promise<string> {
  const email = `kotsec-${role}@fidato.in`;
  const id = (await sql<{ id: string }>(
    `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
     on conflict (email) do update set is_active = true returning id::text`,
    [email, `KOTSEC ${role}`, `test-uid-kotsec-${role}`]))[0]!.id;
  await sql("delete from staff_hotels where staff_id = $1", [id]);
  await sql(`insert into staff_hotels (staff_id, hotel_id, role)
             select $1, id, $2 from hotels where code = '5EL'`, [id, role]);
  return id;
}

type Setup = {
  kinds: { id: string; name: string; role: string | null; fixed: boolean; sections: number;
           station: { name: string; mine: boolean; online: boolean } | null }[];
  stations: { id: string; name: string; mine: boolean; printsBills: boolean; kinds: string[] }[];
  sections: { id: string; name: string; heading: string | null; own: string | null; kind: string }[];
  billPrinter: { name: string } | null;
  me: string | null;
};
const setup = async (device = A, who = chef) => {
  const res = await call(who, "GET", `/till/kot-setup?device=${device}`);
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as Setup;
};
const kind = async (name: string) => (await setup()).kinds.find((k) => k.name === name)!;
const thisComputer = (device: string, name: string, kindIds: string[], bills = false, who = kitchen) =>
  call(who, "POST", "/till/kot-setup/this-computer", { device, name, kindIds, bills });

type Slip = { orderId: string; kotNo: number; kindId: string; kind: string; printedAt: string | null };
const poll = async (device: string) =>
  (await (await call(chef, "POST", "/till/kot-stations/poll", { device })).json()) as {
    station: false | { name: string; kinds: { id: string; name: string }[]; printsBills: boolean };
    due?: Slip[]; recent?: Slip[]; bills?: { id: string; orderId: string; heading: string }[];
  };

/** An order with a Paneer Tikka (food) and a Fresh Lime Soda (drink), sent. */
async function sendBoth(): Promise<{ orderId: string; kotNo: number }> {
  const opened = await call(owner, "POST", "/till/orders", { outlet: "REST", table: "KOTSEC" });
  expect(opened.status, await opened.clone().text()).toBe(200);
  const { id } = (await opened.json()) as { id: string };
  orders.push(id);
  expect((await call(owner, "POST", `/till/orders/${id}/lines`, { itemId: tikka, qty: 1 })).status).toBe(200);
  expect((await call(owner, "POST", `/till/orders/${id}/lines`, { itemId: lime, qty: 2 })).status).toBe(200);
  const sent = await call(owner, "POST", `/till/orders/${id}/kot`);
  expect(sent.status, await sent.clone().text()).toBe(200);
  return { orderId: id, kotNo: ((await sent.json()) as { kotNo: number }).kotNo };
}

beforeAll(async () => {
  owner = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  chef = await person("chef");
  kitchen = await person("kitchen_manager");
  const res = await call(owner, "GET", "/till/menu");
  const menu = (await res.json()) as {
    categories: { id: string; name: string; items: { id: string; name: string }[] }[];
  };
  const items = menu.categories.flatMap((c) => c.items);
  tikka = items.find((i) => i.name === "Paneer Tikka")!.id;
  const drinks = menu.categories.find((c) => c.name === "Beverages")!;
  beverages = drinks.id;
  lime = drinks.items[0]!.id;
  main = menu.categories.find((c) => c.name === "Starters")!.id;
});

afterAll(async () => {
  await sql("update pos_menu_categories set kot_kind_id = null where id = any($1::uuid[])", [[beverages, main]]);
  await sql(`delete from pos_kot_prints where order_id = any($1::uuid[])`, [orders]);
  await sql(`delete from pos_bill_prints where order_id = any($1::uuid[])`, [orders]);
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
              where station_id in (select id from pos_kot_stations where device like 'device-kotsec-%')`);
  await sql(`update pos_order_lines set kot_kind_id = null
              where kot_kind_id in (select id from pos_kot_kinds where role is null
                                      and hotel_id = (select id from hotels where code = '5EL'))`);
  await sql(`update pos_kot_kinds set is_active = false where role is null
              and hotel_id = (select id from hotels where code = '5EL')`);
  await sql("update pos_kot_stations set is_active = false where device like 'device-kotsec-%'");
  for (const id of [chef, kitchen]) {
    await sql("delete from staff_hotels where staff_id = $1", [id]);
    await sql("update staff set is_active = false where id = $1", [id]);
  }
  await closePool();
});

describe("the KOT kinds", () => {
  it("start as Kitchen and Bar, are added and renamed, and the two are never switched off", async () => {
    const first = await setup();
    expect(first.kinds.map((k) => [k.name, k.fixed])).toEqual([["Kitchen", true], ["Bar", true]]);

    expect((await call(chef, "POST", "/till/kot-setup/kinds", { name: "Tandoor" })).status,
      "not the chef's").toBe(403);
    expect((await call(kitchen, "POST", "/till/kot-setup/kinds", { name: "Tandoor" })).status).toBe(200);
    expect(await reason(await call(kitchen, "POST", "/till/kot-setup/kinds", { name: " tandoor " })))
      .toMatch(/already a tandoor KOT/);
    expect(await reason(await call(kitchen, "POST", "/till/kot-setup/kinds", { name: "Dessert KOT" })))
      .toMatch(/the slip adds KOT/);

    const tandoor = await kind("Tandoor");
    expect((await call(kitchen, "PATCH", `/till/kot-setup/kinds/${tandoor.id}`, { name: "Tandoor oven" })).status).toBe(200);
    const kitchenKind = await kind("Kitchen");
    expect(await reason(await call(kitchen, "POST", `/till/kot-setup/kinds/${kitchenKind.id}/off`)))
      .toMatch(/Kitchen stays/);
    expect((await call(kitchen, "POST", `/till/kot-setup/kinds/${tandoor.id}/off`)).status).toBe(200);
    expect((await setup()).kinds.map((k) => k.name)).toEqual(["Kitchen", "Bar"]);
  });
});

describe("which section prints where", () => {
  it("is pre-filled from the heading, and a section is sent elsewhere and back", async () => {
    const s = await setup();
    const kitchenId = s.kinds.find((k) => k.name === "Kitchen")!.id;
    const barId = s.kinds.find((k) => k.name === "Bar")!.id;
    const drinks = s.sections.find((x) => x.id === beverages)!;
    expect([drinks.own, drinks.kind], "a restaurant-heading section prints in the kitchen").toEqual([null, kitchenId]);

    expect((await call(kitchen, "POST", `/till/kot-setup/sections/${beverages}`, { kindId: barId })).status).toBe(200);
    expect((await setup()).sections.find((x) => x.id === beverages)!.kind).toBe(barId);
    expect((await call(kitchen, "POST", `/till/kot-setup/sections/${main}`, { kindId: barId })).status).toBe(200);
    expect((await call(kitchen, "POST", `/till/kot-setup/sections/${main}`, { kindId: null })).status).toBe(200);
    expect((await setup()).sections.find((x) => x.id === main)!.kind, "back to its heading").toBe(kitchenId);
  });
});

describe("this computer, and one computer per kind", () => {
  it("wants a name; ticking a kind elsewhere moves it; the bills move too; nothing ticked leaves the list", async () => {
    const k = await kind("Kitchen");
    const b = await kind("Bar");
    expect(await reason(await thisComputer(A, "  ", [k.id]))).toMatch(/Type a name for this computer/);
    expect((await thisComputer(A, "Kitchen PC", [k.id, b.id], false, chef)).status, "not the chef's").toBe(403);

    expect((await thisComputer(A, "Kitchen PC", [k.id, b.id])).status).toBe(200);
    let s = await setup(A);
    expect(s.kinds.map((x) => x.station?.name)).toEqual(["Kitchen PC", "Kitchen PC"]);
    expect(s.kinds[0]!.station!.mine).toBe(true);

    expect((await thisComputer(B, "Bar PC", [b.id], true, owner)).status).toBe(200);
    s = await setup(A);
    expect(s.kinds.map((x) => x.station?.name)).toEqual(["Kitchen PC", "Bar PC"]);
    expect(s.billPrinter?.name).toBe("Bar PC");

    expect((await thisComputer(A, "Kitchen PC", [k.id], true)).status).toBe(200);
    expect((await setup(A)).billPrinter?.name, "one bill printer: it moved").toBe("Kitchen PC");

    const barPc = (await setup(B)).stations.find((x) => x.name === "Bar PC")!;
    expect(await reason(await call(kitchen, "POST", `/till/kot-setup/stations/${barPc.id}/remove`)))
      .toMatch(/Bar PC still prints/);
  });
});

describe("one Send, one number, one slip per kind", () => {
  it("splits the docket by kind, each claimed only by its computer, and stamped when sent", async () => {
    const d = await sendBoth();
    const kitchenDue = (await poll(A)).due!.filter((x) => x.orderId === d.orderId);
    const barDue = (await poll(B)).due!.filter((x) => x.orderId === d.orderId);
    expect(kitchenDue.map((x) => [x.kotNo, x.kind])).toEqual([[d.kotNo, "Kitchen"]]);
    expect(barDue.map((x) => [x.kotNo, x.kind])).toEqual([[d.kotNo, "Bar"]]);

    const docket = async (kindId: string) =>
      (await (await call(chef, "GET", `/till/orders/${d.orderId}/kot/${d.kotNo}?kind=${kindId}`)).json()) as {
        kind: { name: string }; lines: { name: string; qty: number }[];
      };
    const food = await docket(kitchenDue[0]!.kindId);
    const drink = await docket(barDue[0]!.kindId);
    expect([food.kind.name, food.lines.map((l) => l.name)]).toEqual(["Kitchen", ["Paneer Tikka"]]);
    expect(drink.kind.name).toBe("Bar");
    expect(drink.lines.map((l) => l.qty)).toEqual([2]);

    const claim = (device: string, kindId: string) =>
      call(chef, "POST", `/till/orders/${d.orderId}/kot/${d.kotNo}/printed`, { device, kind: kindId });
    expect(await reason(await claim(A, barDue[0]!.kindId))).toBe("This computer does not print that KOT.");
    expect(await (await claim(A, kitchenDue[0]!.kindId)).json()).toEqual({ ok: true, claimed: true });
    expect(await (await claim(A, kitchenDue[0]!.kindId)).json()).toEqual({ ok: true, claimed: false });
    expect((await poll(A)).due!.some((x) => x.orderId === d.orderId), "the kitchen's slip is printed").toBe(false);
    expect((await poll(B)).due!.some((x) => x.orderId === d.orderId), "the bar's still waits").toBe(true);

    /* The drinks go back to the kitchen; the KOT already sent still reprints at the bar. */
    await call(kitchen, "POST", `/till/kot-setup/sections/${beverages}`, { kindId: null });
    expect((await docket(barDue[0]!.kindId)).lines.map((l) => l.qty), "stamped when sent").toEqual([2]);
    await call(kitchen, "POST", `/till/kot-setup/sections/${beverages}`, { kindId: barDue[0]!.kindId });
  });

  it("a kind moved to another computer starts afresh, and catches up on the business date only", async () => {
    const before = await sendBoth();
    const b = await kind("Bar");
    expect((await thisComputer(A, "Kitchen PC", [(await kind("Kitchen")).id, b.id], true)).status).toBe(200);
    const after = await sendBoth();
    const old = await sendBoth();
    /* Renamed too: today's next order number is worked from today's orders,
       and would be this one's again. */
    await sql(`update pos_orders set business_date = business_date - 1, order_no = order_no || '-Y'
                where id = $1`, [old.orderId]);

    const due = (await poll(A)).due!.filter((x) => x.kind === "Bar").map((x) => x.orderId);
    expect(due).toContain(after.orderId);
    expect(due, "sent before the Bar came here").not.toContain(before.orderId);
    expect(due, "yesterday's waits for a reprint").not.toContain(old.orderId);
    expect((await poll(B)).due!.filter((x) => x.kind === "Bar"), "B no longer prints the Bar").toEqual([]);
  });
});

describe("the bill printer", () => {
  it("INTERIM before payment, BILL after, then DUPLICATE; claimed once; Print here takes it off the list", async () => {
    const d = await sendBoth();
    const ask = async () =>
      (await (await call(owner, "POST", `/till/orders/${d.orderId}/bill-print`)).json()) as {
        ok: boolean; heading: string; sentTo: { name: string; online: boolean } | null; jobId?: string;
      };
    await poll(A);
    const interim = await ask();
    expect([interim.heading, interim.sentTo]).toEqual(["interim", { name: "Kitchen PC", online: true }]);
    const job = (await poll(A)).bills!.find((x) => x.orderId === d.orderId)!;
    expect(job.heading).toBe("interim");
    const claim = () => call(chef, "POST", `/till/bill-prints/${job.id}/printed`, { device: A });
    expect(await (await claim()).json()).toEqual({ ok: true, claimed: true });
    expect(await (await claim()).json()).toEqual({ ok: true, claimed: false });

    const paid = await call(owner, "POST", `/till/orders/${d.orderId}/settle`, { method: "upi" });
    expect(paid.status, await paid.clone().text()).toBe(200);
    expect((await ask()).heading).toBe("bill");
    expect((await ask()).heading).toBe("duplicate");

    /* Print here: the waiting one comes off the bill printer's list. */
    const here = await call(owner, "POST", `/till/orders/${d.orderId}/bill-print/here`);
    expect(await here.json()).toEqual({ ok: true, heading: "duplicate" });
    expect((await poll(A)).bills!.filter((x) => x.orderId === d.orderId)).toEqual([]);
  });

  /* AN EARLIER DAY'S BILL (the team's feedback of 18 October, item 7a; the
     owner, 20 October): found by its day or its number, and asked again it
     prints at the bill printer as a DUPLICATE - not only today's bills. */
  it("finds a paid bill of an earlier day, and prints it again at the bill printer", async () => {
    expect((await thisComputer(A, "Kitchen PC", [(await kind("Kitchen")).id, (await kind("Bar")).id], true)).status).toBe(200);
    const d = await sendBoth();
    expect((await call(owner, "POST", `/till/orders/${d.orderId}/settle`, { method: "upi" })).status).toBe(200);
    expect((await call(owner, "POST", `/till/orders/${d.orderId}/bill-print`)).status).toBe(200);
    /* That bill printed on its day; the order is moved three days back. */
    await sql("update pos_bill_prints set printed_at = now() where order_id = $1 and printed_at is null", [d.orderId]);
    const [o] = await sql<{ day: string; no: string }>(
      `update pos_orders set business_date = business_date - 3, order_no = order_no || '-E'
        where id = $1 returning to_char(business_date, 'YYYY-MM-DD') as day, order_no as no`, [d.orderId]);

    const found = async (q: string) =>
      ((await (await call(owner, "GET", `/till/bills?${q}`)).json()) as { bills: { id: string; businessDate: string }[] })
        .bills;
    expect((await found(`date=${o!.day}`)).find((b) => b.id === d.orderId)?.businessDate).toBe(o!.day);
    expect((await found(`no=${encodeURIComponent(o!.no.slice(-6))}`)).map((b) => b.id)).toContain(d.orderId);
    const neither = await call(owner, "GET", "/till/bills");
    expect(neither.status).toBe(409);
    expect(await reason(neither)).toBe("Pick a day, or type the bill's number.");

    const again = (await (await call(owner, "POST", `/till/orders/${d.orderId}/bill-print`)).json()) as { heading: string };
    expect(again.heading).toBe("duplicate");
    expect((await poll(A)).bills!.find((x) => x.orderId === d.orderId)?.heading, "an earlier day's duplicate prints too")
      .toBe("duplicate");
  });

  it("with no bill printer, the bill opens where it was asked (sentTo null)", async () => {
    expect((await thisComputer(A, "Kitchen PC", [(await kind("Kitchen")).id, (await kind("Bar")).id], false)).status).toBe(200);
    const d = await sendBoth();
    const res = await call(owner, "POST", `/till/orders/${d.orderId}/bill-print`);
    expect(await res.json()).toEqual({ ok: true, heading: "interim", sentTo: null });
  });

  it("a computer's shortest slip: set by the kitchen manager, 60 to 400 mm, blank puts it back (D27-363)", async () => {
    expect((await thisComputer(A, "Kitchen PC", [(await kind("Kitchen")).id], false)).status).toBe(200);
    const me = (await setup(A)).stations.find((s) => s.mine) as unknown as { id: string; slipMm: number | null };
    expect(me.slipMm).toBeNull();
    const set = (slipMm: unknown, who = kitchen) => call(who, "POST", `/till/kot-setup/stations/${me.id}/print`, { slipMm });
    expect(await reason(await set(50))).toBe("The shortest slip is whole mm, from 60 to 400.");
    expect((await set(180)).status).toBe(200);
    expect(((await setup(A)).stations.find((s) => s.mine) as unknown as { slipMm: number | null }).slipMm).toBe(180);
    expect((await set(null)).status).toBe(200);
    expect(((await setup(A)).stations.find((s) => s.mine) as unknown as { slipMm: number | null }).slipMm).toBeNull();
  });
});
