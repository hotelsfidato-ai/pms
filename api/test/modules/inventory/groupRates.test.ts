import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   ONE PRICE CHANGE ACROSS PROPERTIES (D27-383 item 6)

   Three properties of this file's own (GRA, GRB, GRC), so nothing another
   file reads is touched: GRA and GRB have a Deluxe (GRB spelling it
   "deluxe "), GRC has none, GRD has one priced as its base type plus a
   difference. Every price is in April 2029.

   What must be SEEN: a property the person may not open refused, with
   nothing written; a property without the room type listed and skipped;
   a save that fails at one property leaving every property as it was;
   and a save of what was not shown refused.
   ══════════════════════════════════════════════════════════════════ */

const SUPER = process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

const FROM = "2029-04-01";
const THROUGH = "2029-04-05";
let owner: string;
const ids = new Map<string, string>();
const types = new Map<string, string>();
const people: string[] = [];

const person = async (key: string, roles: [string, string][]) => {
  const { rows } = await sql(
    `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
     on conflict (email) do update set is_active = true returning id::text`,
    [`grr-${key}@fidato.in`, `GRRTEST ${key}`, `test-uid-grr-${key}`]);
  const id = rows[0].id as string;
  await sql("delete from staff_hotels where staff_id = $1", [id]);
  for (const [hotel, role] of roles) {
    await sql(`insert into staff_hotels (staff_id, hotel_id, role) select $1, id, $2 from hotels where code = $3`, [id, role, hotel]);
  }
  people.push(id);
  return id;
};

/** The base a booking would be quoted on a day, as the Rates calendar reads it. */
const priceOn = async (type: string, day: string) => {
  const { rows } = await sql("select price::float8 as p from app.price_for($1::uuid, 'EP', $2::date)", [type, day]);
  return rows[0].p as number | null;
};
const base = (hotel: string, type: string, from: string, to: string, price: number) =>
  sql("select app.set_base_price($1::uuid, $2::uuid, $3::date, $4::date, $5, null, null)", [hotel, type, from, to, price]);

const QUESTION = { roomType: "Deluxe", from: FROM, through: THROUGH, kind: "by", value: 500 };
const preview = async (who: string, hotels: string[], q: Record<string, unknown> = QUESTION) => {
  const qs = new URLSearchParams({ hotels: hotels.join(","), ...Object.fromEntries(Object.entries(q).map(([k, v]) => [k, String(v)])) });
  const res = await app.request(`/api/group/rate-change?${qs}`, { headers: { "x-dev-staff-id": who } });
  return { status: res.status, body: (await res.json()) as any };
};
const save = async (who: string, hotels: string[], seen: unknown, q: Record<string, unknown> = QUESTION) => {
  const res = await app.request("/api/group/rate-change", {
    method: "POST",
    headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    body: JSON.stringify({ hotels, ...q, seen }),
  });
  return { status: res.status, body: (await res.json()) as any };
};

beforeAll(async () => {
  owner = (await sql("select id::text from staff where email = 'owner@fidato.in'")).rows[0].id;
  for (const [code, state, gstin] of [["GRA", "MH", "27GRA"], ["GRB", "UP", "09GRB"], ["GRC", "MH", "27GRC"], ["GRD", "MH", "27GRD"]]) {
    const { rows } = await sql(
      `insert into hotels (code, name, city, state, gstin) values ($1, $2, 'Test', $3, $4)
       on conflict (code) do update set name = excluded.name returning id::text`,
      [code, `Group rates ${code.slice(2)}`, state, gstin]);
    ids.set(code, rows[0].id);
  }
  const type = async (hotel: string, code: string, name: string) => {
    const { rows } = await sql(
      `insert into room_types (hotel_id, code, name, base_occupancy, max_occupancy) values ($1, $2, $3, 2, 3) returning id::text`,
      [ids.get(hotel), code, name]);
    types.set(`${hotel}:${code}`, rows[0].id);
    return rows[0].id as string;
  };
  await base(ids.get("GRA")!, await type("GRA", "DLX", "Deluxe"), FROM, "2029-04-03", 4000);
  await base(ids.get("GRA")!, types.get("GRA:DLX")!, "2029-04-03", "2029-05-01", 4400);
  await base(ids.get("GRB")!, await type("GRB", "DLX", "deluxe "), FROM, "2029-05-01", 3000);
  await type("GRC", "STE", "Suite");
  /* GRD: Superior is the base room type; Deluxe is Superior plus ₹700. */
  const sup = await type("GRD", "SUP", "Superior");
  const dlx = await type("GRD", "DLX", "Deluxe");
  await sql("insert into pricing_basis (hotel_id, room_type_id, meal_plan) values ($1, $2, 'EP')", [ids.get("GRD"), sup]);
  await sql(`insert into rate_offsets (hotel_id, kind, room_type_id, amount, unit, valid_from)
             values ($1, 'room_type', $2, 700, 'rupees', '2029-01-01')`, [ids.get("GRD"), dlx]);
});

afterAll(async () => {
  await sql("drop trigger if exists grr_fail on rates");
  await sql("drop function if exists public.grr_fail()");
  await sql("delete from staff_hotels where staff_id = any($1)", [people]);
  await sql("update staff set is_active = false where id = any($1)", [people]);
  await closePool();
});

describe("what would change, before anything is saved", () => {
  it("shows each property's old and new price, matches the room type by name, and lists the one without it", async () => {
    const { status, body } = await preview(owner, ["GRA", "GRB", "GRC", "GRD"]);
    expect(status).toBe(200);
    const [a, b, c, d] = body.hotels;
    expect(a.roomType.name).toBe("Deluxe");
    expect(a.runs).toEqual([
      { from: "2029-04-01", through: "2029-04-02", old: 4000, new: 4500 },
      { from: "2029-04-03", through: "2029-04-05", old: 4400, new: 4900 },
    ]);
    /* Matched by its name, as GRB spells it, and shown as it is spelt. */
    expect(b.roomType.name).toBe("deluxe ");
    expect(b.runs).toEqual([{ from: FROM, through: THROUGH, old: 3000, new: 3500 }]);
    expect(c).toMatchObject({ roomType: null, skipped: "No room type called Deluxe here: skipped.", runs: [] });
    expect(d.skipped).toBe("Deluxe here is Superior plus a difference: change Superior's price, or the difference, on this property's own Rates.");
    /* Nothing written by a preview. */
    expect(await priceOn(types.get("GRA:DLX")!, FROM)).toBe(4000);
    expect(body.roomTypes.find((t: { name: string }) => t.name.toLowerCase() === "deluxe").at).toEqual(["GRA", "GRB", "GRD"]);
  });

  it("skips a property with no price to change by an amount, naming the days", async () => {
    const { body } = await preview(owner, ["GRA"], { ...QUESTION, from: "2029-03-30", through: FROM });
    expect(body.hotels[0].skipped).toBe("No price on 30/03/2029, 31/03/2029 to change: set a new price instead, or price those days on this property's own Rates.");
  });

  it("rounds a percent to the whole rupee", async () => {
    const { body } = await preview(owner, ["GRB"], { ...QUESTION, kind: "percent", value: -7.5 });
    expect(body.hotels[0].runs[0]).toMatchObject({ old: 3000, new: 2775 });
  });
});

describe("who may", () => {
  it("refuses a property the person does not work at, and writes nothing", async () => {
    const rm = await person("rm-a", [["GRA", "revenue_manager"]]);
    const shown = await preview(rm, ["GRA", "GRB"]);
    expect(shown.status).toBe(403);
    expect(shown.body.reason).toBe("GRB is not a property you work at, so nothing is shown or changed there.");
    expect(shown.body.hotels).toBeUndefined();
    const saved = await save(rm, ["GRA", "GRB"], []);
    expect(saved.status).toBe(403);
    expect(await priceOn(types.get("GRA:DLX")!, FROM)).toBe(4000);
  });

  it("refuses a property where the person's role may not set a price, naming it", async () => {
    const rm = await person("rm-ab", [["GRA", "revenue_manager"], ["GRB", "front_desk"]]);
    const { status, body } = await preview(rm, ["GRA", "GRB"]);
    expect(status).toBe(403);
    expect(body.reason).toMatch(/^At Group rates B: Setting a price is for /);
  });
});

describe("saving: every property, or none", () => {
  it("refuses what was not shown: a price changed since the preview", async () => {
    const { body } = await preview(owner, ["GRA", "GRB"]);
    await base(ids.get("GRB")!, types.get("GRB:DLX")!, FROM, "2029-04-02", 3100);
    const saved = await save(owner, ["GRA", "GRB"], body.hotels);
    expect(saved.status).toBe(409);
    expect(saved.body.reason).toMatch(/^A price changed since you looked\. Nothing was saved/);
    expect(await priceOn(types.get("GRA:DLX")!, FROM)).toBe(4000);
    await base(ids.get("GRB")!, types.get("GRB:DLX")!, FROM, "2029-05-01", 3000);
  });

  it("a save that fails at one property leaves every property as it was", async () => {
    const { body } = await preview(owner, ["GRA", "GRB"]);
    /* GRB refuses any new price: GRA is written first, in the same transaction. */
    await sql(`create or replace function public.grr_fail() returns trigger language plpgsql as $$
               begin raise exception 'GRB refuses for this test'; end $$`);
    await sql(`create trigger grr_fail before insert on rates for each row
               when (new.hotel_id = '${ids.get("GRB")}'::uuid) execute function public.grr_fail()`);
    try {
      const saved = await save(owner, ["GRA", "GRB"], body.hotels);
      expect(saved.status).toBe(409);
      expect(saved.body.reason).toBe("Nothing was saved, at any property. At Group rates B: GRB refuses for this test");
      expect(await priceOn(types.get("GRA:DLX")!, FROM)).toBe(4000);
      expect(await priceOn(types.get("GRA:DLX")!, "2029-04-04")).toBe(4400);
      expect(await priceOn(types.get("GRB:DLX")!, FROM)).toBe(3000);
    } finally {
      await sql("drop trigger if exists grr_fail on rates");
      await sql("drop function if exists public.grr_fail()");
    }
  });

  it("saves every property shown, skips the one without the room type, and records who set each price", async () => {
    const { body } = await preview(owner, ["GRA", "GRB", "GRC"]);
    const saved = await save(owner, ["GRA", "GRB", "GRC"], body.hotels);
    expect(saved.status).toBe(200);
    expect(saved.body.saved.map((s: { code: string }) => s.code)).toEqual(["GRA", "GRB"]);
    expect(saved.body.skipped).toEqual([{ code: "GRC", name: "Group rates C", reason: "No room type called Deluxe here: skipped." }]);
    expect(await priceOn(types.get("GRA:DLX")!, FROM)).toBe(4500);
    expect(await priceOn(types.get("GRA:DLX")!, THROUGH)).toBe(4900);
    /* The day after the change keeps its old price. */
    expect(await priceOn(types.get("GRA:DLX")!, "2029-04-06")).toBe(4400);
    expect(await priceOn(types.get("GRB:DLX")!, THROUGH)).toBe(3500);
    const { rows } = await sql(
      `select h.code, r.created_by::text as by from rates r join hotels h on h.id = r.hotel_id
        where h.code in ('GRA', 'GRB') and r.valid_from between $1::date and $2::date order by 1, r.valid_from`,
      [FROM, THROUGH]);
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.by))).toEqual(new Set([owner]));
    expect(new Set(rows.map((r) => r.code))).toEqual(new Set(["GRA", "GRB"]));
  });

  it("refuses a question that changes nothing, or asks for a zero price", async () => {
    expect((await save(owner, ["GRA"], [], { ...QUESTION, value: 0 })).body.reason).toBe("A change of 0 changes nothing.");
    expect((await save(owner, ["GRA"], [], { ...QUESTION, kind: "set", value: 0 })).status).toBe(400);
    expect((await save(owner, ["GRA"], undefined)).body.reason).toMatch(/^Look at the prices first/);
  });
});
