import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE MINIBAR AND THE HOUSEKEEPING CHECKLISTS (D27-383 item 10, D27-396)

   Every refusal is tried, not asserted, and each one that comes after a
   write is shown to leave nothing behind (MEMORY 243): no bill line, no
   store movement, no record. A property of its own, made and removed here:
     101  a guest in the house
     102  a guest who has left (checked out)
     103  nobody has ever stayed in
   ══════════════════════════════════════════════════════════════════ */

const SUPER = process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const CODE = `MB${String(process.pid).slice(-2)}`;

const pool = async () => new (await import("pg")).default.Pool({ connectionString: SUPER });
const sql = async (text: string, params: unknown[] = []) => {
  const db = await pool();
  try { return await db.query(text, params); } finally { await db.end(); }
};

let hotel: string, owner: string, gm: string, desk: string, keeper: string, chef: string;
let inHouse: string, left: string, main: string, bar: string;
let water: string, nuts: string, beer: string, juice: string;

const call = async (who: string, path: string, method = "GET", body?: unknown) => {
  const res = await app.request(`/api/hotels/${CODE}${path}`, {
    method, headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> & { reason?: string } };
};
const count = async (table: string, where = "true") =>
  Number((await sql(`select count(*)::int as n from ${table} where hotel_id = $1 and ${where}`, [hotel])).rows[0].n);
const lines = () => count("folio_postings", "source_type = 'minibar'");
const moves = () => count("stock_movements", "department = 'Minibar'");
const roomState = async (n: string) =>
  (await sql("select housekeeping_status as s from rooms where hotel_id = $1 and number = $2", [hotel, n])).rows[0].s as string;

const person = async (key: string, role: string) => {
  const { rows } = await sql(
    `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
     on conflict (email) do update set is_active = true returning id::text`,
    [`mb-${key}@fidato.in`, `MBTEST ${key}`, `test-uid-mb-${key}`]);
  await sql("delete from staff_hotels where staff_id = $1", [rows[0].id]);
  await sql("insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)", [rows[0].id, hotel, role]);
  return rows[0].id as string;
};

const stay = async (status: string, room: string, released: boolean) => {
  const guest = (await sql("insert into guests (full_name) values ('Minibar Guest') returning id")).rows[0].id;
  const id = (await sql(
    `insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate, status)
     values ($1, app.next_reference($1), $2, (select id from room_types where hotel_id = $1 limit 1),
             current_date - 1, current_date + 1, 2000, $3) returning id::text`, [hotel, guest, status])).rows[0].id;
  await sql(
    `insert into room_assignments (hotel_id, reservation_id, room_id, from_date, to_date, reason, released_at)
     select $1, $2, id, current_date - 1, current_date + 1, 'arrival', $4
       from rooms where hotel_id = $1 and number = $3`,
    [hotel, id, room, released ? new Date().toISOString() : null]);
  return id as string;
};

beforeAll(async () => {
  owner = (await sql("select id::text from staff where email = 'owner@fidato.in'")).rows[0].id;
  const db = await pool();
  await db.query("select set_config('app.user_id', $1, false)", [owner]);
  hotel = (await db.query("select app.provision_property_unchecked($1, 'Minibar Test', 'Nowhere')::text as id", [CODE])).rows[0].id;
  await db.query("select app.bulk_create_rooms($1, 'STD', 1::smallint, 101, 103)", [hotel]);
  await db.query("select app.default_stores($1)", [hotel]);
  /* The restaurant's GST rule; alcohol's VAT rate comes later, by its test. */
  await db.query("insert into tax_rules (hotel_id, kind, over_amount, rate) values ($1, 'restaurant', 0, 5)", [hotel]);
  await db.end();
  main = (await sql("select id::text from locations where hotel_id = $1 and name = 'Main store'", [hotel])).rows[0].id;
  bar = (await sql("select id::text from locations where hotel_id = $1 and is_bar_store", [hotel])).rows[0].id;

  gm = await person("gm", "gm");
  desk = await person("desk", "front_desk");
  keeper = await person("keeper", "housekeeping");
  chef = await person("chef", "chef");
  inHouse = await stay("checked_in", "101", false);
  left = await stay("checked_out", "102", true);

  /* The Store's items, and what each store holds. */
  const item = async (name: string, liquor: string | null) =>
    (await sql(`insert into stock_items (hotel_id, name, unit, liquor, count_as, size_ml)
                values ($1, $2, 'bottle', $3, $4, $5) returning id::text`,
      [hotel, name, liquor, liquor ? "whole" : null, liquor ? 330 : null])).rows[0].id as string;
  const stockWater = await item("Water", null), stockNuts = await item("Nuts", null);
  const stockBeer = await item("Beer", "beer_mild"), stockJuice = await item("Juice", null);
  for (const [id, store, qty] of [[stockWater, main, 10], [stockNuts, main, 1], [stockBeer, bar, 5]] as const) {
    expect((await call(gm, "/stores/movements", "POST", { kind: "receipt", itemId: id, locationId: store, quantity: qty })).status).toBe(200);
  }
  const add = async (stockItemId: string, price: string, storeId: string) =>
    (await call(gm, "/minibar/items", "POST", { stockItemId, price, storeId })).body.data as { id: string };
  water = (await add(stockWater, "60", main)).id;
  nuts = (await add(stockNuts, "120", main)).id;
  beer = (await add(stockBeer, "250", bar)).id;
  juice = (await add(stockJuice, "", main)).id;
});

afterAll(async () => {
  const db = await pool();
  await db.query("select set_config('app.user_id', $1, false)", [owner]);
  await db.query("alter table folio_postings disable trigger folio_postings_append_only");
  await db.query("alter table stock_movements disable trigger stock_movements_append_only");
  await db.query("alter table hotels disable trigger hotels_no_delete");
  await db.query("delete from hotels where id = $1", [hotel]);
  await db.query("alter table hotels enable trigger hotels_no_delete");
  await db.query("alter table stock_movements enable trigger stock_movements_append_only");
  await db.query("alter table folio_postings enable trigger folio_postings_append_only");
  await db.query("update staff set is_active = false where email like 'mb-%@fidato.in'");
  await db.end();
  await closePool();
});

describe("the minibar list", () => {
  it("an item nobody priced is null, never 0", async () => {
    const list = (await call(gm, "/minibar")).body.items as { id: string; price: number | null }[];
    expect(list.find((i) => i.id === juice)!.price).toBeNull();
  });

  it("is the owner's, an administrator's or the GM's: reception and housekeeping are refused", async () => {
    for (const who of [desk, keeper]) {
      const res = await call(who, `/minibar/items/${water}`, "PATCH", { price: "1" });
      expect(res.status).toBe(403);
      expect(res.body.reason).toMatch(/minibar's items and prices is for the owner/);
    }
    expect((await call(gm, "/minibar")).body.items).toContainEqual(expect.objectContaining({ id: water, price: 60 }));
  });

  it("refuses a price of zero or nonsense", async () => {
    for (const price of ["0", "-5", "abc"]) {
      const res = await call(gm, `/minibar/items/${water}`, "PATCH", { price });
      expect(res.status).toBe(409);
      expect(res.body.reason).toMatch(/more than zero/);
    }
  });
});

describe("what was taken from a room", () => {
  it("is refused for a role outside the six, and writes nothing", async () => {
    const before = [await lines(), await moves(), await count("minibar_records")];
    const res = await call(chef, "/minibar/records", "POST", { room: "101", lines: [{ itemId: water, quantity: 1 }] });
    expect(res.status).toBe(403);
    expect(res.body.reason).toMatch(/reception or housekeeping/);
    expect([await lines(), await moves(), await count("minibar_records")]).toEqual(before);
  });

  it("refuses an item with no price - it cannot be charged", async () => {
    const res = await call(keeper, "/minibar/records", "POST", { room: "101", lines: [{ itemId: juice, quantity: 1 }] });
    expect(res.status).toBe(409);
    expect(res.body.reason).toMatch(/Juice has no price yet/);
  });

  it("puts a guest's take on their bill at the restaurant's GST, and issues the refill", async () => {
    const before = await moves();
    const res = await call(keeper, "/minibar/records", "POST", { room: "101", lines: [{ itemId: water, quantity: 2 }] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ status: "charged" });
    const { rows } = await sql(
      `select fp.description, fp.amount::float8, fp.tax_rate::float8, fp.tax_scheme, fp.category, f.reservation_id::text as stay
         from folio_postings fp join folios f on f.id = fp.folio_id
        where fp.hotel_id = $1 and fp.source_type = 'minibar'`, [hotel]);
    expect(rows).toEqual([{ description: "Minibar - Water x 2", amount: 120, tax_rate: 5, tax_scheme: "gst", category: "minibar", stay: inHouse }]);
    expect(await moves()).toBe(before + 1);
    expect(Number((await sql("select app.stock_on_hand(item_id, location_id)::int as n from stock_movements where hotel_id = $1 and department = 'Minibar'", [hotel])).rows[0].n)).toBe(8);
  });

  it("refuses a refill the store does not hold - and takes back the line before it", async () => {
    const before = [await lines(), await moves(), await count("minibar_records")];
    const res = await call(keeper, "/minibar/records", "POST", {
      room: "101", lines: [{ itemId: water, quantity: 1 }, { itemId: nuts, quantity: 2 }] });
    expect(res.status).toBe(409);
    expect(res.body.reason).toMatch(/There is 1 bottle of Nuts in Main store, and this would take out 2/);
    expect([await lines(), await moves(), await count("minibar_records")]).toEqual(before);
  });

  it("refuses a drink where the property does not serve alcohol, then bills it as VAT, never GST", async () => {
    const refused = await call(keeper, "/minibar/records", "POST", { room: "101", lines: [{ itemId: beer, quantity: 1 }] });
    expect(refused.status).toBe(409);
    expect(refused.body.reason).toMatch(/not switched on for alcohol/);

    await sql("insert into hotel_modules (hotel_id, module, is_enabled) values ($1, 'alcohol', true)", [hotel]);
    const noRate = await call(keeper, "/minibar/records", "POST", { room: "101", lines: [{ itemId: beer, quantity: 1 }] });
    expect(noRate.status).toBe(409);
    expect(noRate.body.reason).toMatch(/no VAT rate for alcohol/);

    await sql("insert into tax_rules (hotel_id, kind, over_amount, rate) values ($1, 'alcohol', 0, 10)", [hotel]);
    const ok = await call(keeper, "/minibar/records", "POST", { room: "101", lines: [{ itemId: beer, quantity: 2 }] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const { rows } = await sql(
      `select amount::float8, tax_rate::float8, tax_amount::float8, tax_scheme from folio_postings
        where hotel_id = $1 and source_type = 'minibar' and description like '%Beer%'`, [hotel]);
    expect(rows).toEqual([{ amount: 500, tax_rate: 10, tax_amount: 50, tax_scheme: "vat" }]);
  });

  it("refuses a room nobody has stayed in", async () => {
    const res = await call(keeper, "/minibar/records", "POST", { room: "103", lines: [{ itemId: water, quantity: 1 }] });
    expect(res.status).toBe(409);
    expect(res.body.reason).toMatch(/Nobody has stayed in room 103/);
  });
});

describe("the desk decides a waiting one", () => {
  it("a disputed take is not charged until the desk says; housekeeping may not decide; once only", async () => {
    const before = await lines();
    const rec = await call(keeper, "/minibar/records", "POST", { room: "101", lines: [{ itemId: water, quantity: 1 }], disputed: true });
    expect(rec.body.data).toMatchObject({ status: "waiting", waitingWhy: "disputed" });
    expect(await lines()).toBe(before);
    const id = (rec.body.data as { id: string }).id;

    const keeperTry = await call(keeper, `/minibar/records/${id}/decide`, "POST", { charge: true });
    expect(keeperTry.status).toBe(403);
    expect(keeperTry.body.reason).toMatch(/waiting minibar charge is for/);

    const noWhy = await call(desk, `/minibar/records/${id}/decide`, "POST", { charge: false });
    expect(noWhy.status).toBe(409);
    expect(noWhy.body.reason).toMatch(/Say why it is not charged/);

    expect((await call(desk, `/minibar/records/${id}/decide`, "POST", { charge: true })).status).toBe(200);
    expect(await lines()).toBe(before + 1);
    const again = await call(desk, `/minibar/records/${id}/decide`, "POST", { charge: false, note: "changed my mind" });
    expect(again.status).toBe(409);
    expect(again.body.reason).toMatch(/already decided/);
  });

  it("found after check-out: never added to the closed bill; the desk says why not", async () => {
    const before = await lines();
    const rec = await call(keeper, "/minibar/records", "POST", { room: "102", lines: [{ itemId: water, quantity: 1 }] });
    expect(rec.body.data).toMatchObject({ status: "waiting", waitingWhy: "after_checkout" });
    const id = (rec.body.data as { id: string }).id;
    const charge = await call(desk, `/minibar/records/${id}/decide`, "POST", { charge: true });
    expect(charge.status).toBe(409);
    expect(charge.body.reason).toMatch(/This folio is closed/);
    expect(await lines()).toBe(before);
    expect((await call(desk, `/minibar/records/${id}/decide`, "POST", { charge: false, note: "Guest gone" })).status).toBe(200);
    const { rows } = await sql("select status, reservation_id::text as stay from minibar_records where id = $1", [id]);
    expect(rows[0]).toEqual({ status: "not_charged", stay: left });
  });

  it("taking a minibar charge off is the bill's own Reverse: a reason, and the record says so", async () => {
    const line = (await sql("select id::text from folio_postings where hotel_id = $1 and source_type = 'minibar' and description = 'Minibar - Water x 2'", [hotel])).rows[0].id;
    const bare = await call(desk, `/stays/${inHouse}/charges/${line}/reverse`, "POST", {});
    expect(bare.status).toBe(409);
    expect(bare.body.reason).toMatch(/Say why it is being reversed/);
    expect((await call(desk, `/stays/${inHouse}/charges/${line}/reverse`, "POST", { reason: "Guest did not take it" })).status).toBe(200);
    const records = (await call(desk, "/minibar")).body.records as { reversed: boolean; lines: { quantity: number }[] }[];
    expect(records.find((r) => r.lines[0]!.quantity === 2 && r.reversed)).toBeTruthy();
  });
});

describe("housekeeping checklists", () => {
  const all = (items: string[], ok = true) => items.map((item) => ({ item, ok }));
  const CLEAN = ["Bed made", "Bathroom dry", "Towels"];
  const LOOK = ["Linen", "Bathroom"];

  it("off by default: the board's tap marks a room as it always has", async () => {
    expect((await call(gm, "/checklists")).body.required).toBe(false);
    expect((await call(keeper, "/rooms/101/housekeeping", "PUT", { state: "dirty" })).status).toBe(200);
    expect((await call(keeper, "/rooms/101/housekeeping", "PUT", { state: "clean" })).status).toBe(200);
  });

  it("the lists and the switch are the owner's, an administrator's or the GM's", async () => {
    const res = await call(keeper, "/checklists", "POST", { job: "checkout", items: CLEAN });
    expect(res.status).toBe(403);
    expect((await call(desk, "/checklists/required", "PUT", { required: true })).status).toBe(403);
    expect((await call(gm, "/checklists", "POST", { job: "checkout", roomTypeId: null, items: CLEAN })).status).toBe(200);
    expect((await call(gm, "/checklists", "POST", { job: "inspection", items: LOOK })).status).toBe(200);
    const twice = await call(gm, "/checklists", "POST", { job: "checkout", items: ["x"] });
    expect(twice.status).toBe(409);
    expect(twice.body.reason).toMatch(/already a checkout clean list for every room type/);
    const blank = await call(gm, "/checklists", "POST", { job: "deep", items: ["  ", ""] });
    expect(blank.body.reason).toMatch(/at least one item/);
    expect((await call(gm, "/checklists/required", "PUT", { required: true })).status).toBe(200);
  });

  it("switched on, a room with a list is not marked by the plain tap", async () => {
    await call(gm, "/rooms/103/housekeeping", "PUT", { state: "dirty" });
    const res = await call(keeper, "/rooms/103/housekeeping", "PUT", { state: "clean" });
    expect(res.status).toBe(409);
    expect(res.body.reason).toMatch(/marks room 103 clean by ticking its checklist/);
    expect(await roomState("103")).toBe("dirty");
  });

  it("a cleaning list is done only when every item is ticked, then the room is clean", async () => {
    const short = await call(keeper, "/housekeeping/checklist-runs", "POST",
      { room: "103", job: "checkout", results: [...all(CLEAN.slice(0, 2)), { item: "Towels", ok: false }] });
    expect(short.status).toBe(409);
    expect(short.body.reason).toMatch(/Tick every item before room 103 is clean: Towels/);
    const changed = await call(keeper, "/housekeeping/checklist-runs", "POST", { room: "103", job: "checkout", results: all(["Bed made"]) });
    expect(changed.body.reason).toMatch(/changed while it was open/);
    const noList = await call(keeper, "/housekeeping/checklist-runs", "POST", { room: "103", job: "deep", results: [] });
    expect(noList.body.reason).toMatch(/no deep clean checklist for room 103/);
    expect(await count("hk_checklist_runs")).toBe(0);
    expect(await roomState("103")).toBe("dirty");

    const done = await call(keeper, "/housekeeping/checklist-runs", "POST", { room: "103", job: "checkout", results: all(CLEAN) });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(await roomState("103")).toBe("clean");
  });

  it("an inspection's failed item needs a note, and sends the room back to Needs cleaning", async () => {
    const silent = await call(gm, "/housekeeping/checklist-runs", "POST",
      { room: "103", job: "inspection", results: [{ item: "Linen", ok: true }, { item: "Bathroom", ok: false }] });
    expect(silent.status).toBe(409);
    expect(silent.body.reason).toMatch(/Say what is wrong with: Bathroom/);
    const failed = await call(gm, "/housekeeping/checklist-runs", "POST",
      { room: "103", job: "inspection", results: [{ item: "Linen", ok: true }, { item: "Bathroom", ok: false, note: "Hair in the basin" }] });
    expect(failed.body.data).toEqual({ passed: false, state: "dirty" });
    expect(await roomState("103")).toBe("dirty");

    const early = await call(gm, "/housekeeping/checklist-runs", "POST", { room: "103", job: "inspection", results: all(LOOK) });
    expect(early.body.reason).toMatch(/A dirty room is cleaned before it is inspected/);

    const history = (await call(keeper, "/housekeeping/checklist-runs?room=103")).body.runs as
      { job: string; passed: boolean; doneBy: string; failed: { item: string; note: string }[] }[];
    expect(history[0]).toMatchObject({ job: "inspection", passed: false, doneBy: "MBTEST gm",
      failed: [{ item: "Bathroom", note: "Hair in the basin" }] });
    expect(history[1]).toMatchObject({ job: "checkout", passed: true, doneBy: "MBTEST keeper", failed: [] });
  });
});
