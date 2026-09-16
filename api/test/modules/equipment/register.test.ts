import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { readDate, readCost } from "../../../src/modules/equipment/equipment.ts";
import { EQUIPMENT_SPEC } from "../../../../src/modules/equipment/importSpec.ts";

/* ══════════════════════════════════════════════════════════════════
   THE EQUIPMENT REGISTER — what it does, through the API

   Who may is grants.test.ts. This file is what happens when they do:

     a cost nobody typed comes back null, never 0
     a tag that is taken is refused, naming the next free number
     part of a counted line moves as its own line, and the lines add up
     a Hotel Manager's retirement of a tagged item WAITS; the GM's
       approval makes it final; the record names who asked and who agreed
     a retired item does not move
     an import's dry run writes nothing, gives blank tags a number, and
       rejects a row it cannot read — with its line number
     a refusal leaves no category behind (root MEMORY 243)

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
let gm: string;
let hm: string;
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
  roomId: string | null; status: string; unitCost: number | null; totalCost: number | null;
  warrantyEnds: string | null; amcEnds: string | null; category: string | null;
  splitFrom: string | null;
  retireRequest: { by: string; reason: string } | null;
  retired: { by: string; requestedBy: string | null; reason: string } | null;
}
interface History { kind: string; quantity: number; from: string | null; to: string | null; who: string | null; note: string | null }

const person = async (key: string, role: string) => {
  const { rows } = await sql(
    `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
     on conflict (email) do update set is_active = true, full_name = excluded.full_name
     returning id::text`,
    [`eqr-${key}@fidato.in`, `EQTEST-R ${key}`, `test-uid-eqr-${key}`]);
  const id = rows[0].id as string;
  await sql("delete from staff_hotels where staff_id = $1", [id]);
  await sql(
    `insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)`, [id, hotelId, role]);
  return id;
};

const clear = async () => {
  const db = await admin();
  try {
    await db.query("begin");
    await db.query("alter table equipment_history disable trigger equipment_history_append_only");
    await db.query(
      `delete from equipment_history where item_id in
         (select id from equipment_items where name like 'EQTEST-R %')`);
    await db.query("delete from equipment_items where name like 'EQTEST-R %'");
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

const list = async (who = gm) =>
  (await json<{ items: Item[] }>(await call(who, "/equipment"))).items
    .filter((i) => i.name.startsWith("EQTEST-R "));

const page = async (id: string) =>
  json<{ item: Item; history: History[] }>(await call(gm, `/equipment/items/${id}`));

beforeAll(async () => {
  hotelId = (await sql("select id::text from hotels where code = '5EL'")).rows[0].id;
  rooms = (await sql(
    `select id::text, number from rooms where hotel_id = $1 and is_active
      order by length(number), number limit 2`, [hotelId])).rows;
  await clear();
  gm = await person("gm", "gm");
  hm = await person("hm", "hotel_manager");
  accountant = await person("accountant", "finance");
});

afterAll(async () => {
  await clear();
  const ids = [gm, hm, accountant];
  await sql("delete from staff_hotels where staff_id = any($1)", [ids]);
  await sql("update staff set is_active = false where id = any($1)", [ids]);
  await closePool();
});

describe("reading what somebody typed", () => {
  it("reads a date written day first, or as the calendar writes it — and nothing else", () => {
    expect(readDate("14/03/2025")).toBe("2025-03-14");
    expect(readDate("4-3-2025")).toBe("2025-03-04");
    expect(readDate("2025-03-14")).toBe("2025-03-14");
    expect(readDate("03/14/2025")).toBeNull();     // month first: said, not guessed
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
    const options = await json<{ nextTag: string }>(await call(gm, "/equipment/options"));
    expect(options.nextTag).toMatch(/^EQ-\d{4,}$/);

    const added = await json<{ id: string }>(await call(gm, "/equipment", "POST", {
      name: "EQTEST-R LED TV", heldAs: "tagged", tag: options.nextTag, roomId: rooms[0]!.id,
      category: "EQTEST-R Electronics",
    }));
    const { item, history } = await page(added.id);
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
    const [tv] = (await list()).filter((i) => i.name === "EQTEST-R LED TV");
    const res = await call(gm, "/equipment", "POST", {
      name: "EQTEST-R Second TV", heldAs: "tagged", tag: ` ${tv!.tag!.toLowerCase()}`,
      roomId: rooms[0]!.id,
    });
    const body = await json<{ reason: string }>(res, 409);
    expect(body.reason).toMatch(/is already on another item here\. The next free number is EQ-\d{4,}\./);
  });

  it("puts a typed category with different capitals under the one already there", async () => {
    await json(await call(gm, "/equipment", "POST", {
      name: "EQTEST-R Soundbar", heldAs: "counted", quantity: 1, roomId: rooms[0]!.id,
      category: "eqtest-r electronics ",
    }));
    const n = (await sql(
      "select count(*)::int as n from equipment_categories where lower(name) like 'eqtest-r%'")).rows[0].n;
    expect(n).toBe(1);
  });

  it("leaves no category behind when it refuses (MEMORY 243)", async () => {
    const res = await call(gm, "/equipment", "POST", {
      name: "EQTEST-R Microwave", heldAs: "counted", quantity: 1, roomId: rooms[0]!.id,
      category: "EQTEST-R Never made", purchaseDate: "31/02/2025",
    });
    await json(res, 409);
    const n = (await sql(
      "select count(*)::int as n from equipment_categories where name = 'EQTEST-R Never made'")).rows[0].n;
    expect(n).toBe(0);
  });

  it("works out a counted line's total from its per-piece cost", async () => {
    const added = await json<{ id: string }>(await call(gm, "/equipment", "POST", {
      name: "EQTEST-R Kettle", heldAs: "counted", quantity: 12, roomId: rooms[0]!.id,
      unitCost: "1200", purchaseDate: "01/04/2025", warrantyEnds: "2026-03-31",
    }));
    const { item } = await page(added.id);
    expect(item.unitCost).toBe(1200);
    expect(item.totalCost).toBe(14400);
    expect(item.warrantyEnds).toBe("2026-03-31");
  });
});

describe("part of a count", () => {
  it("moves 2 of 12 as their own line, records both steps, and the lines still add up", async () => {
    const [kettles] = (await list()).filter((i) => i.name === "EQTEST-R Kettle");
    const moved = await json<{ id: string; split: boolean; quantity: number }>(
      await call(gm, `/equipment/items/${kettles!.id}/move`, "POST",
        { roomId: rooms[1]!.id, count: 2, note: "Two for the new room" }));
    expect(moved.split).toBe(true);
    expect(moved.quantity).toBe(2);

    const lines = (await list()).filter((i) => i.name === "EQTEST-R Kettle");
    expect(lines.map((l) => l.quantity).sort((a, b) => a - b)).toEqual([2, 10]);
    expect(lines.find((l) => l.quantity === 2)!.roomId).toBe(rooms[1]!.id);

    const { history } = await page(moved.id);
    /* Newest first: moved, then the split it came from. */
    expect(history.map((h) => h.kind)).toEqual(["moved", "split"]);
    expect(history[0]!.from).toBe(`Room ${rooms[0]!.number}`);
    expect(history[0]!.to).toBe(`Room ${rooms[1]!.number}`);
    expect(history[0]!.note).toBe("Two for the new room");
  });

  it("refuses to move more than the line holds, and writes nothing", async () => {
    const [ten] = (await list()).filter((i) => i.name === "EQTEST-R Kettle" && i.quantity === 10);
    const res = await call(gm, `/equipment/items/${ten!.id}/move`, "POST",
      { roomId: rooms[1]!.id, count: 11 });
    await json(res, 409);
    const lines = (await list()).filter((i) => i.name === "EQTEST-R Kettle");
    expect(lines).toHaveLength(2);
  });

  it("lets a Hotel Manager retire part of a counted line straight away", async () => {
    const [ten] = (await list()).filter((i) => i.name === "EQTEST-R Kettle" && i.quantity === 10);
    const done = await json<{ requested: boolean; split: boolean }>(
      await call(hm, `/equipment/items/${ten!.id}/retire`, "POST", { reason: "Element burnt out", count: 1 }));
    expect(done.requested).toBe(false);
    expect(done.split).toBe(true);
    const lines = (await list()).filter((i) => i.name === "EQTEST-R Kettle");
    expect(lines.filter((l) => l.status === "retired").map((l) => l.quantity)).toEqual([1]);
    expect(lines.reduce((n, l) => n + l.quantity, 0)).toBe(12);
  });
});

describe("retiring a tagged item", () => {
  it("waits for the GM when a Hotel Manager asks, and records who asked and who agreed", async () => {
    const [tv] = (await list()).filter((i) => i.name === "EQTEST-R LED TV");

    const asked = await json<{ requested: boolean }>(
      await call(hm, `/equipment/items/${tv!.id}/retire`, "POST", { reason: "Screen cracked" }));
    expect(asked.requested).toBe(true);

    let { item } = await page(tv!.id);
    expect(item.status).toBe("in_use");
    expect(item.retireRequest).toMatchObject({ by: "EQTEST-R hm", reason: "Screen cracked" });

    /* While it waits, it does not wander off. */
    await json(await call(hm, `/equipment/items/${tv!.id}/move`, "POST", { roomId: rooms[1]!.id }), 409);
    /* And a second request is refused. */
    await json(await call(hm, `/equipment/items/${tv!.id}/retire`, "POST", { reason: "Again" }), 409);

    await json(await call(gm, `/equipment/items/${tv!.id}/retire/approve`, "POST"));
    ({ item } = await page(tv!.id));
    expect(item.status).toBe("retired");
    expect(item.retired).toMatchObject({
      by: "EQTEST-R gm", requestedBy: "EQTEST-R hm", reason: "Screen cracked",
    });

    const { history } = await page(tv!.id);
    expect(history.map((h) => h.kind)).toEqual(["retired", "retire_requested", "added"]);
  });

  it("goes straight through when the GM retires one", async () => {
    const added = await json<{ id: string }>(await call(gm, "/equipment", "POST", {
      name: "EQTEST-R Old fridge", heldAs: "tagged", tag: "EQTEST-R-FRIDGE", roomId: rooms[1]!.id,
    }));
    const done = await json<{ requested: boolean }>(
      await call(gm, `/equipment/items/${added.id}/retire`, "POST", { reason: "Sold" }));
    expect(done.requested).toBe(false);
    expect((await page(added.id)).item.status).toBe("retired");
  });

  it("refuses a retirement with no reason", async () => {
    const [bar] = (await list()).filter((i) => i.name === "EQTEST-R Soundbar");
    await json(await call(gm, `/equipment/items/${bar!.id}/retire`, "POST", { reason: " " }), 409);
    expect((await page(bar!.id)).item.status).toBe("in_use");
  });

  it("keeps a retired item exactly as it was", async () => {
    const [tv] = (await list()).filter((i) => i.name === "EQTEST-R LED TV");
    await json(await call(gm, `/equipment/items/${tv!.id}/move`, "POST", { roomId: rooms[1]!.id }), 409);
    await json(await call(gm, `/equipment/items/${tv!.id}`, "PATCH", { name: "EQTEST-R renamed" }), 409);
    await json(await call(gm, `/equipment/items/${tv!.id}/status`, "POST", { status: "under_repair" }), 409);
  });
});

describe("importing the opening register", () => {
  const rowsFor = () => [
    { name: "EQTEST-R Split AC", heldAs: "tag", room: rooms[0]!.number, unitCost: "",
      purchaseDate: "14/03/2025", warrantyEnds: "13/03/2027", category: "EQTEST-R Appliance" },
    { name: "EQTEST-R Hanger", heldAs: "count", quantity: "20", room: rooms[1]!.number },
    { name: "EQTEST-R Nowhere", heldAs: "count", quantity: "2", room: "NO-SUCH-ROOM" },
    { name: "EQTEST-R Lost cost", heldAs: "tag", room: rooms[0]!.number, unitCost: "about 500" },
  ];

  it("dry-runs without writing, numbers a blank tag, and rejects what it cannot read", async () => {
    const report = await json<{
      dryRun: boolean; creates: number; rejected: number;
      verdicts: { line: number; action: string; detail: string }[];
    }>(await call(gm, "/equipment/import", "POST", { dryRun: true, rows: rowsFor() }));

    expect(report.dryRun).toBe(true);
    expect(report.creates).toBe(2);
    expect(report.rejected).toBe(2);
    expect(report.verdicts.map((v) => [v.line, v.action])).toEqual([
      [2, "create"], [3, "create"], [4, "rejected"], [5, "rejected"],
    ]);
    expect(report.verdicts[0]!.detail).toMatch(/^tag EQ-\d{4,} \(given\) · Room .+ · cost not known$/);
    expect(report.verdicts[2]!.detail).toBe("There is no room NO-SUCH-ROOM at this property.");
    expect((await list()).some((i) => i.name === "EQTEST-R Split AC")).toBe(false);
  });

  it("applies the rows it can read, with nothing invented for the blanks", async () => {
    await json(await call(gm, "/equipment/import", "POST", { dryRun: false, rows: rowsFor() }));
    const items = await list();
    const ac = items.find((i) => i.name === "EQTEST-R Split AC")!;
    expect(ac.tag).toMatch(/^EQ-\d{4,}$/);
    expect(ac.unitCost).toBeNull();
    expect(ac.warrantyEnds).toBe("2027-03-13");
    expect(items.find((i) => i.name === "EQTEST-R Hanger")!.quantity).toBe(20);
    expect(items.some((i) => i.name === "EQTEST-R Nowhere")).toBe(false);

    const { history } = await page(ac.id);
    expect(history[0]).toMatchObject({ kind: "added", note: "Imported from a file" });
  });
});

describe("the website's import template, read by the server", () => {
  it("lands every column it offers — none is silently ignored", async () => {
    /* The template is src/modules/equipment/importSpec.ts; the reader is
       the server. A column the template teaches and the server never
       reads would import as blank with no word said. So every field is
       filled, sent under the template's own field names, and looked for. */
    const place = (await sql(
      `insert into locations (hotel_id, name, kind) values ($1, 'EQTEST-R Lobby', 'public_area')
       on conflict (hotel_id, name) do update set is_active = true returning id::text`,
      [hotelId])).rows[0].id as string;
    await sql(
      `insert into suppliers (hotel_id, name) values ($1, 'EQTEST-R Electricals')
       on conflict (hotel_id, name) do nothing`, [hotelId]);

    const value: Record<string, string> = {
      name: "EQTEST-R Every column", category: "EQTEST-R Appliance", heldAs: "tag",
      tag: "EQTEST-R-ALL", quantity: "1", room: "", place: "EQTEST-R Lobby",
      supplier: "EQTEST-R Electricals", purchaseDate: "02/01/2025", unitCost: "45000",
      warrantyEnds: "01/01/2027", amcEnds: "31/12/2026", status: "under repair",
    };
    const fields = EQUIPMENT_SPEC.columns.map((c) => c.field);
    expect(fields.filter((f) => !(f in value)), "a template column this test does not fill").toEqual([]);
    const row = Object.fromEntries(fields.map((f) => [f, value[f]!]));

    await json(await call(gm, "/equipment/import", "POST", { dryRun: false, rows: [row] }));
    const landed = (await list()).find((i) => i.name === "EQTEST-R Every column")!;
    expect(landed).toMatchObject({
      category: "EQTEST-R Appliance", tag: "EQTEST-R-ALL", quantity: 1,
      place: "EQTEST-R Lobby", supplier: "EQTEST-R Electricals",
      purchaseDate: "2025-01-02", unitCost: 45000, warrantyEnds: "2027-01-01",
      amcEnds: "2026-12-31", status: "under_repair",
    });
    expect((landed as Item & { locationId: string }).locationId).toBe(place);
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
