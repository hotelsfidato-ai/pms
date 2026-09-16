import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { readDate, readCost } from "../../../src/modules/equipment/equipment.ts";
import { EQUIPMENT_COLUMNS } from "../../../../src/modules/equipment/importColumns.ts";

/* ══════════════════════════════════════════════════════════════════
   THE EQUIPMENT REGISTER — what it does, through the API

   Who may is grants.test.ts. This file is what happens when they do:

     a cost nobody typed comes back null, never 0
     a tag that is taken is refused, naming the next free number
     part of a counted line moves as its own line, and the lines add up
     LEAVING THE STORE (S12–S15): housekeeping asks, with a reason; the
       thing stays in the store; the Inventory Manager approves in the
       ONE approvals inbox and it is then where it was sent — or refuses,
       and it stays, with the reason beside it. Part of a count becomes
       its own line when asked. Into another store needs nobody.
     RETIRING (S16): a Hotel Manager's retirement of a tagged item waits
       in the same inbox; the Inventory Manager approves it; the record
       names who asked and who agreed. The GM's goes straight through.
     NAMES: whoever may approve sees who did each thing; housekeeping
       sees a dash (the owner's answer, 16 September)
     an import's dry run writes nothing, gives blank tags a number, and
       rejects a row it cannot read — with its line number
     every column of the website's template lands

   Everything is named EQTEST-R and removed afterwards.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const admin = async () =>
  new (await import("pg")).default.Pool({ connectionString: SUPER });

const sql = async (text: string, params: unknown[] = []) => {
  const db = await admin();
  try { return await db.query(text, params); } finally { await db.end(); }
};

let hotelId: string;
let rooms: { id: string; number: string }[];
let store: string;
let store2: string;
let lobby: string;
let gm: string;
let hm: string;
let keeper: string;
let housekeeping: string;
let accountant: string;

const call = (staffId: string, path: string, method = "GET", body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method,
    headers: { "x-dev-staff-id": staffId, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

async function json<T = Record<string, unknown>>(res: Response, status = 200): Promise<T> {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
}

interface Item {
  id: string; name: string; tag: string | null; quantity: number; place: string;
  placeKind: string | null; roomId: string | null; locationId: string | null;
  status: string; unitCost: number | null; totalCost: number | null;
  warrantyEnds: string | null; amcEnds: string | null; category: string | null;
  supplier: string | null; purchaseDate: string | null; splitFrom: string | null;
  leaving: { moveId: string; approvalId: string; to: string | null; reason: string | null; by: string | null } | null;
  leavingRefused: { to: string | null; note: string | null } | null;
  retireRequest: { approvalId: string; by: string | null; reason: string | null } | null;
  retireRefused: { note: string | null } | null;
  retired: { by: string | null; requestedBy: string | null; reason: string | null } | null;
}
interface Entry {
  kind: string; quantity: number; from: string | null; to: string | null; place: string | null;
  who: string | null; note: string | null;
  decision: { status: string; by: string | null; note: string | null } | null;
}
interface QueueRow {
  id: string; kind: string; subject: { table: string; id: string };
  mayDecide: boolean; blockedBecause?: string; requestedBy: string | null;
}

const person = async (key: string, role: string) => {
  const { rows } = await sql(
    `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
     on conflict (email) do update set is_active = true, full_name = excluded.full_name
     returning id::text`,
    [`eqr-${key}@fidato.in`, `EQTEST-R ${key}`, `test-uid-eqr-${key}`]);
  const id = rows[0].id as string;
  await sql("delete from staff_hotels where staff_id = $1", [id]);
  await sql("insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)", [id, hotelId, role]);
  return id;
};

const clear = async () => {
  const db = await admin();
  try {
    await db.query("begin");
    await db.query("alter table equipment_history disable trigger equipment_history_append_only");
    await db.query("alter table equipment_moves disable trigger equipment_moves_append_only");
    await db.query(`create temp table eq_gone on commit drop as
                      select id from equipment_items where name like 'EQTEST-R %'`);
    await db.query("delete from equipment_history where item_id in (select id from eq_gone)");
    await db.query(`create temp table eq_moves on commit drop as
                      select id from equipment_moves where item_id in (select id from eq_gone)`);
    await db.query("delete from equipment_moves where id in (select id from eq_moves)");
    await db.query(`delete from approvals where subject_id in (select id from eq_gone)
                                         or subject_id in (select id from eq_moves)`);
    await db.query("delete from equipment_items where id in (select id from eq_gone)");
    await db.query("alter table equipment_moves enable trigger equipment_moves_append_only");
    await db.query("alter table equipment_history enable trigger equipment_history_append_only");
    await db.query("delete from equipment_categories where name like 'EQTEST-R%'");
    /* 094's tables refuse the application a delete; the fixtures go as the
       superuser, the way shared.sql removes its own. */
    await db.query("delete from locations where name like 'EQTEST-R%'");
    await db.query("delete from suppliers where name like 'EQTEST-R%'");
    await db.query("commit");
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally {
    await db.end();
  }
};

const all = async (who = gm) =>
  (await json<{ items: Item[] }>(await call(who, "/equipment"))).items
    .filter((i) => i.name.startsWith("EQTEST-R "));
const named = async (name: string, who = gm) => (await all(who)).filter((i) => i.name === name);
const page = async (id: string, who = gm) =>
  json<{ item: Item; history: Entry[] }>(await call(who, `/equipment/items/${id}`));
const queue = async (who: string) =>
  (await json<{ rows: QueueRow[] }>(await call(who, "/approvals"))).rows;
const add = async (body: Record<string, unknown>, who = gm) =>
  (await json<{ id: string }>(await call(who, "/equipment", "POST", body))).id;

beforeAll(async () => {
  hotelId = (await sql("select id::text from hotels where code = '5EL'")).rows[0].id;
  rooms = (await sql(
    `select id::text, number from rooms where hotel_id = $1 and is_active
      order by length(number), number limit 2`, [hotelId])).rows;
  await clear();
  const place = async (name: string, kind: string) => (await sql(
    `insert into locations (hotel_id, name, kind) values ($1, $2, $3) returning id::text`,
    [hotelId, name, kind])).rows[0].id as string;
  store = await place("EQTEST-R Main store", "store");
  store2 = await place("EQTEST-R Kitchen store", "store");
  lobby = await place("EQTEST-R Lobby", "public_area");
  gm = await person("gm", "gm");
  hm = await person("hm", "hotel_manager");
  keeper = await person("keeper", "stores");
  housekeeping = await person("housekeeping", "housekeeping");
  accountant = await person("accountant", "finance");
});

afterAll(async () => {
  await clear();
  const ids = [gm, hm, keeper, housekeeping, accountant];
  await sql("delete from staff_hotels where staff_id = any($1)", [ids]);
  await sql("update staff set is_active = false where id = any($1)", [ids]);
  await closePool();
});

describe("reading what somebody typed", () => {
  it("reads a date written day first, or as the calendar writes it — and nothing else", () => {
    expect(readDate("14/03/2025")).toBe("2025-03-14");
    expect(readDate("4-3-2025")).toBe("2025-03-04");
    expect(readDate("2025-03-14")).toBe("2025-03-14");
    expect(readDate("03/14/2025")).toBeNull();
    expect(readDate("31/02/2025")).toBeNull();
    expect(readDate("yesterday")).toBeNull();
  });

  it("reads a blank cost as not known — never zero", () => {
    expect(readCost("")).toBeNull();
    expect(readCost(null)).toBeNull();
    expect(readCost("₹32,000")).toBe(32000);
    expect(readCost("0")).toBe(0);
    expect(readCost("-5")).toBeUndefined();
    expect(readCost("about 500")).toBeUndefined();
  });
});

describe("adding", () => {
  it("keeps a cost and a warranty nobody typed as null, never 0 and never expired", async () => {
    const options = await json<{ nextTag: string; places: { id: string; kind: string }[] }>(
      await call(gm, "/equipment/options"));
    expect(options.nextTag).toMatch(/^EQ-\d{4,}$/);
    expect(options.places.find((p) => p.id === store)?.kind).toBe("store");

    const id = await add({
      name: "EQTEST-R LED TV", heldAs: "tagged", tag: options.nextTag, roomId: rooms[0]!.id,
      category: "EQTEST-R Electronics",
    });
    const { item, history } = await page(id);
    expect(item.unitCost).toBeNull();
    expect(item.totalCost).toBeNull();
    expect(item.warrantyEnds).toBeNull();
    expect(item.amcEnds).toBeNull();
    expect(item.place).toBe(`Room ${rooms[0]!.number}`);
    expect(item.category).toBe("EQTEST-R Electronics");
    expect(history.map((h) => h.kind)).toEqual(["added"]);
    expect(history[0]!.who).toBe("EQTEST-R gm");
  });

  it("refuses a tag that is taken, in any capitals, naming the next free number", async () => {
    const [tv] = await named("EQTEST-R LED TV");
    const body = await json<{ reason: string }>(await call(gm, "/equipment", "POST", {
      name: "EQTEST-R Second TV", heldAs: "tagged", tag: ` ${tv!.tag!.toLowerCase()}`,
      roomId: rooms[0]!.id,
    }), 409);
    expect(body.reason).toMatch(/is already on another item here\. The next free number is EQ-\d{4,}\./);
  });

  it("puts a typed category with different capitals under the one already there", async () => {
    await add({ name: "EQTEST-R Soundbar", heldAs: "counted", quantity: 1, roomId: rooms[0]!.id,
                category: "eqtest-r electronics " });
    const n = (await sql(
      "select count(*)::int as n from equipment_categories where lower(name) like 'eqtest-r%'")).rows[0].n;
    expect(n).toBe(1);
  });

  it("leaves no category and no item behind when it refuses (MEMORY 243)", async () => {
    await json(await call(gm, "/equipment", "POST", {
      name: "EQTEST-R Microwave", heldAs: "counted", quantity: 1, roomId: rooms[0]!.id,
      category: "EQTEST-R Never made", purchaseDate: "31/02/2025",
    }), 409);
    expect((await sql(
      "select count(*)::int as n from equipment_categories where name = 'EQTEST-R Never made'")).rows[0].n).toBe(0);
    expect(await named("EQTEST-R Microwave")).toHaveLength(0);
  });

  it("works out a counted line's total from its per-piece cost", async () => {
    const id = await add({
      name: "EQTEST-R Kettle", heldAs: "counted", quantity: 12, roomId: rooms[0]!.id,
      unitCost: "1200", purchaseDate: "01/04/2025", warrantyEnds: "2026-03-31",
    });
    const { item } = await page(id);
    expect(item.unitCost).toBe(1200);
    expect(item.totalCost).toBe(14400);
  });
});

describe("part of a count", () => {
  it("moves 2 of 12 as their own line, records both steps, and the lines still add up", async () => {
    const [kettles] = await named("EQTEST-R Kettle");
    const moved = await json<{ id: string; split: boolean; quantity: number; requested: boolean }>(
      await call(gm, `/equipment/items/${kettles!.id}/move`, "POST",
        { roomId: rooms[1]!.id, count: 2, note: "Two for the new room" }));
    expect(moved).toMatchObject({ split: true, quantity: 2, requested: false });

    const lines = await named("EQTEST-R Kettle");
    expect(lines.map((l) => l.quantity).sort((a, b) => a - b)).toEqual([2, 10]);
    expect(lines.find((l) => l.quantity === 2)!.roomId).toBe(rooms[1]!.id);

    const { history } = await page(moved.id);
    expect(history.map((h) => h.kind)).toEqual(["moved", "split"]);
    expect(history[0]).toMatchObject({
      from: `Room ${rooms[0]!.number}`, to: `Room ${rooms[1]!.number}`, note: "Two for the new room",
    });
  });

  it("refuses to move more than the line holds, and writes nothing", async () => {
    const [ten] = (await named("EQTEST-R Kettle")).filter((i) => i.quantity === 10);
    await json(await call(gm, `/equipment/items/${ten!.id}/move`, "POST",
      { roomId: rooms[1]!.id, count: 11 }), 409);
    expect(await named("EQTEST-R Kettle")).toHaveLength(2);
  });

  it("lets a Hotel Manager retire part of a counted line straight away", async () => {
    const [ten] = (await named("EQTEST-R Kettle")).filter((i) => i.quantity === 10);
    const done = await json<{ requested: boolean; split: boolean }>(
      await call(hm, `/equipment/items/${ten!.id}/retire`, "POST", { reason: "Element burnt out", count: 1 }));
    expect(done).toMatchObject({ requested: false, split: true });
    const lines = await named("EQTEST-R Kettle");
    expect(lines.filter((l) => l.status === "retired").map((l) => l.quantity)).toEqual([1]);
    expect(lines.reduce((n, l) => n + l.quantity, 0)).toBe(12);
  });
});

describe("leaving the store (S12–S15)", () => {
  let fridge: string;

  it("is asked for by housekeeping, with a reason, and the fridge stays in the store", async () => {
    fridge = await add({ name: "EQTEST-R Fridge", heldAs: "tagged", tag: "EQTEST-R-F1", locationId: store });

    const noReason = await json<{ reason: string }>(
      await call(housekeeping, `/equipment/items/${fridge}/move`, "POST", { roomId: rooms[0]!.id }), 409);
    expect(noReason.reason).toMatch(/Why is it leaving the store/);

    const asked = await json<{ requested: boolean; approvalId: string }>(
      await call(housekeeping, `/equipment/items/${fridge}/move`, "POST",
        { roomId: rooms[0]!.id, note: "Guest in the room needs a fridge" }));
    expect(asked.requested).toBe(true);

    const { item } = await page(fridge, keeper);
    expect(item.locationId).toBe(store);
    expect(item.placeKind).toBe("store");
    expect(item.leaving).toMatchObject({
      approvalId: asked.approvalId, to: `Room ${rooms[0]!.number}`,
      reason: "Guest in the room needs a fridge", by: "EQTEST-R housekeeping",
    });
  });

  it("does not let housekeeping move things between rooms themselves (the owner's answer)", async () => {
    const [tv] = await named("EQTEST-R LED TV");
    const body = await json<{ reason: string }>(
      await call(housekeeping, `/equipment/items/${tv!.id}/move`, "POST", { roomId: rooms[1]!.id }), 403);
    expect(body.reason).toMatch(/Anybody who can see equipment may ask for something to leave the store/);
  });

  it("will not take a second request while the first waits", async () => {
    const body = await json<{ reason: string }>(
      await call(housekeeping, `/equipment/items/${fridge}/move`, "POST",
        { locationId: lobby, note: "Or the lobby" }), 409);
    expect(body.reason).toMatch(/waiting in the approvals inbox/);
  });

  it("is in the ONE inbox for the Inventory Manager, with who asked — and the asker may not decide", async () => {
    const { item } = await page(fridge, keeper);
    const row = (await queue(keeper)).find((r) => r.id === item.leaving!.approvalId)!;
    expect(row).toMatchObject({
      kind: "equipment_issue", subject: { table: "equipment_moves", id: item.leaving!.moveId },
      mayDecide: true, requestedBy: "EQTEST-R housekeeping",
    });
    const mine = (await queue(housekeeping)).find((r) => r.id === item.leaving!.approvalId)!;
    expect(mine.mayDecide).toBe(false);
  });

  it("happens when the Inventory Manager approves it in the inbox", async () => {
    const { item } = await page(fridge, keeper);
    await json(await call(keeper, `/approvals/${item.leaving!.approvalId}/approved`, "POST", {}));

    const after = await page(fridge, keeper);
    expect(after.item.roomId).toBe(rooms[0]!.id);
    expect(after.item.leaving).toBeNull();
    expect(after.history[0]).toMatchObject({
      kind: "move_asked", from: "EQTEST-R Main store", to: `Room ${rooms[0]!.number}`,
      who: "EQTEST-R housekeeping", decision: { status: "approved", by: "EQTEST-R keeper" },
    });
  });

  it("stays where it was when refused, with the reason beside it", async () => {
    const heater = await add({ name: "EQTEST-R Heater", heldAs: "tagged", tag: "EQTEST-R-H1", locationId: store });
    const asked = await json<{ approvalId: string }>(
      await call(housekeeping, `/equipment/items/${heater}/move`, "POST",
        { locationId: lobby, note: "Cold lobby" }));
    await json(await call(keeper, `/approvals/${asked.approvalId}/rejected`, "POST",
      { note: "The lobby has one already." }));

    const { item } = await page(heater, housekeeping);
    expect(item.locationId).toBe(store);
    expect(item.leaving).toBeNull();
    expect(item.leavingRefused).toMatchObject({ to: "EQTEST-R Lobby", note: "The lobby has one already." });
  });

  it("splits part of a count off when asked; approved, those pieces are where they went", async () => {
    const hangers = await add({ name: "EQTEST-R Hanger", heldAs: "counted", quantity: 10, locationId: store });
    const asked = await json<{ id: string; split: boolean; requested: boolean; approvalId: string }>(
      await call(housekeeping, `/equipment/items/${hangers}/move`, "POST",
        { roomId: rooms[1]!.id, count: 3, note: "Room short of hangers" }));
    expect(asked).toMatchObject({ split: true, requested: true });

    let lines = await named("EQTEST-R Hanger");
    expect(lines.map((l) => [l.quantity, l.locationId, l.leaving !== null]).sort()).toEqual(
      [[10 - 3, store, false], [3, store, true]].sort());

    await json(await call(gm, `/approvals/${asked.approvalId}/approved`, "POST", {}));
    lines = await named("EQTEST-R Hanger");
    expect(lines.find((l) => l.quantity === 3)!.roomId).toBe(rooms[1]!.id);
    expect(lines.reduce((n, l) => n + l.quantity, 0)).toBe(10);
  });

  it("needs nobody to go into another store", async () => {
    const shelf = await add({ name: "EQTEST-R Shelf", heldAs: "tagged", tag: "EQTEST-R-S1", locationId: store });
    const moved = await json<{ requested: boolean }>(
      await call(gm, `/equipment/items/${shelf}/move`, "POST", { locationId: store2 }));
    expect(moved.requested).toBe(false);
    expect((await page(shelf)).item.locationId).toBe(store2);
  });

  it("asks even the Inventory Manager — and the GM decides that one", async () => {
    const oven = await add({ name: "EQTEST-R Oven", heldAs: "tagged", tag: "EQTEST-R-O1", locationId: store });
    const asked = await json<{ requested: boolean; approvalId: string }>(
      await call(keeper, `/equipment/items/${oven}/move`, "POST", { locationId: lobby, note: "For the buffet" }));
    expect(asked.requested).toBe(true);
    expect((await queue(keeper)).find((r) => r.id === asked.approvalId)!.mayDecide).toBe(false);
    expect((await queue(gm)).find((r) => r.id === asked.approvalId)!.mayDecide).toBe(true);
  });
});

describe("retiring a tagged item (S16)", () => {
  it("waits in the inbox when a Hotel Manager asks; the Inventory Manager's approval makes it final", async () => {
    const [tv] = await named("EQTEST-R LED TV");

    const asked = await json<{ requested: boolean; approvalId: string }>(
      await call(hm, `/equipment/items/${tv!.id}/retire`, "POST", { reason: "Screen cracked" }));
    expect(asked.requested).toBe(true);

    let { item } = await page(tv!.id, keeper);
    expect(item.status).toBe("in_use");
    expect(item.retireRequest).toMatchObject({
      approvalId: asked.approvalId, by: "EQTEST-R hm", reason: "Screen cracked",
    });
    const row = (await queue(keeper)).find((r) => r.id === asked.approvalId)!;
    expect(row).toMatchObject({ kind: "equipment_retire", mayDecide: true });

    /* While it waits, it does not wander off, and nobody retires it behind the inbox. */
    await json(await call(hm, `/equipment/items/${tv!.id}/move`, "POST", { roomId: rooms[1]!.id }), 409);
    await json(await call(gm, `/equipment/items/${tv!.id}/retire`, "POST", { reason: "Again" }), 409);

    await json(await call(keeper, `/approvals/${asked.approvalId}/approved`, "POST", {}));
    ({ item } = await page(tv!.id, keeper));
    expect(item.status).toBe("retired");
    expect(item.retireRequest).toBeNull();
    expect(item.retired).toMatchObject({
      by: "EQTEST-R keeper", requestedBy: "EQTEST-R hm", reason: "Screen cracked",
    });
    const { history } = await page(tv!.id, keeper);
    expect(history.map((h) => h.kind)).toEqual(["retire_asked", "added"]);
    expect(history[0]!.decision).toMatchObject({ status: "approved", by: "EQTEST-R keeper" });
  });

  it("keeps an item retired in the inbox exactly as it was", async () => {
    const [tv] = await named("EQTEST-R LED TV");
    await json(await call(gm, `/equipment/items/${tv!.id}/move`, "POST", { roomId: rooms[1]!.id }), 409);
    await json(await call(gm, `/equipment/items/${tv!.id}`, "PATCH", { name: "EQTEST-R renamed" }), 409);
    await json(await call(gm, `/equipment/items/${tv!.id}/status`, "POST", { status: "under_repair" }), 409);
  });

  it("leaves it in use when refused, with the reason beside it", async () => {
    const lamp = await add({ name: "EQTEST-R Lamp", heldAs: "tagged", tag: "EQTEST-R-L1", roomId: rooms[1]!.id });
    const asked = await json<{ approvalId: string }>(
      await call(hm, `/equipment/items/${lamp}/retire`, "POST", { reason: "Old" }));
    await json(await call(keeper, `/approvals/${asked.approvalId}/rejected`, "POST", { note: "Needs only a bulb." }));
    const { item } = await page(lamp);
    expect(item.status).toBe("in_use");
    expect(item.retireRefused).toMatchObject({ note: "Needs only a bulb." });
  });

  it("goes straight through when the GM retires one", async () => {
    const old = await add({ name: "EQTEST-R Old fridge", heldAs: "tagged", tag: "EQTEST-R-OF", roomId: rooms[1]!.id });
    const done = await json<{ requested: boolean }>(
      await call(gm, `/equipment/items/${old}/retire`, "POST", { reason: "Sold" }));
    expect(done.requested).toBe(false);
    expect((await page(old)).item.retired).toMatchObject({ by: "EQTEST-R gm", requestedBy: null });
  });

  it("refuses a retirement with no reason", async () => {
    const [bar] = await named("EQTEST-R Soundbar");
    await json(await call(gm, `/equipment/items/${bar!.id}/retire`, "POST", { reason: " " }), 409);
    expect((await page(bar!.id)).item.status).toBe("in_use");
  });
});

describe("names in the history (the owner's answer, 16 September)", () => {
  it("are seen by whoever may approve, and are a dash for housekeeping", async () => {
    const [tv] = await named("EQTEST-R LED TV");
    const forKeeper = await page(tv!.id, keeper);
    expect(forKeeper.history.find((h) => h.kind === "added")!.who).toBe("EQTEST-R gm");
    expect(forKeeper.item.retired!.requestedBy).toBe("EQTEST-R hm");

    const forHousekeeping = await page(tv!.id, housekeeping);
    expect(forHousekeeping.history.find((h) => h.kind === "added")!.who).toBeNull();
    expect(forHousekeeping.item.retired!.requestedBy).toBeNull();
    expect(forHousekeeping.item.retired!.by).toBeNull();
  });
});

describe("importing the opening register", () => {
  const rowsFor = () => [
    { name: "EQTEST-R Split AC", heldAs: "tag", room: rooms[0]!.number, unitCost: "",
      purchaseDate: "14/03/2025", warrantyEnds: "13/03/2027", category: "EQTEST-R Appliance" },
    { name: "EQTEST-R Iron", heldAs: "count", quantity: "20", place: "EQTEST-R Main store" },
    { name: "EQTEST-R Nowhere", heldAs: "count", quantity: "2", room: "NO-SUCH-ROOM" },
    { name: "EQTEST-R Lost cost", heldAs: "tag", room: rooms[0]!.number, unitCost: "about 500" },
  ];

  it("dry-runs without writing, numbers a blank tag, and rejects what it cannot read", async () => {
    const report = await json<{
      dryRun: boolean; creates: number; rejected: number;
      verdicts: { line: number; action: string; detail: string }[];
    }>(await call(gm, "/equipment/import", "POST", { dryRun: true, rows: rowsFor() }));

    expect(report).toMatchObject({ dryRun: true, creates: 2, rejected: 2 });
    expect(report.verdicts.map((v) => [v.line, v.action])).toEqual([
      [2, "create"], [3, "create"], [4, "rejected"], [5, "rejected"],
    ]);
    expect(report.verdicts[0]!.detail).toMatch(/^tag EQ-\d{4,} \(given\) · Room .+ · cost not known$/);
    expect(report.verdicts[2]!.detail).toBe("There is no room NO-SUCH-ROOM at this property.");
    expect(await named("EQTEST-R Split AC")).toHaveLength(0);
  });

  it("applies the rows it can read — into the store with no approval, since adding is not leaving", async () => {
    await json(await call(gm, "/equipment/import", "POST", { dryRun: false, rows: rowsFor() }));
    const [ac] = await named("EQTEST-R Split AC");
    expect(ac!.tag).toMatch(/^EQ-\d{4,}$/);
    expect(ac!.unitCost).toBeNull();
    expect(ac!.warrantyEnds).toBe("2027-03-13");
    const [iron] = await named("EQTEST-R Iron");
    expect(iron).toMatchObject({ quantity: 20, locationId: store, leaving: null });
    expect(await named("EQTEST-R Nowhere")).toHaveLength(0);
    const { history } = await page(ac!.id);
    expect(history[0]).toMatchObject({ kind: "added", note: "Imported from a file" });
  });
});

describe("the website's import template, read by the server", () => {
  it("lands every column it offers — none is silently ignored", async () => {
    await sql(
      `insert into suppliers (hotel_id, name) values ($1, 'EQTEST-R Electricals')
       on conflict (hotel_id, name) do nothing`, [hotelId]);

    const value: Record<string, string> = {
      name: "EQTEST-R Every column", category: "EQTEST-R Appliance", heldAs: "tag",
      tag: "EQTEST-R-ALL", quantity: "1", room: "", place: "EQTEST-R Lobby",
      supplier: "EQTEST-R Electricals", purchaseDate: "02/01/2025", unitCost: "45000",
      warrantyEnds: "01/01/2027", amcEnds: "31/12/2026", status: "under repair",
    };
    const fields = EQUIPMENT_COLUMNS.map((c) => c.field);
    expect(fields.filter((f) => !(f in value)), "a template column this test does not fill").toEqual([]);
    const row = Object.fromEntries(fields.map((f) => [f, value[f]!]));

    await json(await call(gm, "/equipment/import", "POST", { dryRun: false, rows: [row] }));
    const [landed] = await named("EQTEST-R Every column");
    expect(landed).toMatchObject({
      category: "EQTEST-R Appliance", tag: "EQTEST-R-ALL", quantity: 1,
      place: "EQTEST-R Lobby", locationId: lobby, supplier: "EQTEST-R Electricals",
      purchaseDate: "2025-01-02", unitCost: 45000, warrantyEnds: "2027-01-01",
      amcEnds: "2026-12-31", status: "under_repair",
    });
  });
});

describe("exporting", () => {
  it("gives the accountant the whole register, retired lines included", async () => {
    const out = await json<{ items: Item[] }>(await call(accountant, "/equipment/export"));
    const mine = out.items.filter((i) => i.name.startsWith("EQTEST-R "));
    expect(mine.some((i) => i.status === "retired")).toBe(true);
    expect(mine.some((i) => i.status === "in_use")).toBe(true);
  });
});
