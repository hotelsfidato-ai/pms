import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   D27-204, D27-205 (the owner, 30 September) · THE FIRST NIGHT IS CHARGED
   AT CHECK-IN

   The first night's room charge and its GST are posted at check-in, dated
   the business date, by the night audit's own code (night-audit/roomNight.ts);
   the audit posts each later night and never the first one twice. The printed
   interim bill says which night is still "to be posted tonight".

   And FD-24: a check-in that moves the arrival moved the booking and left the
   room hold on the old dates.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const CODE = "FNT";
let hotelId = "";
let groupId = "";
let masterId = "";

const call = (path: string, method = "GET", body?: unknown) =>
  app.request(`/api/hotels/${CODE}${path}`, {
    method,
    headers: {
      "x-dev-staff-id": "dev-owner",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

async function booking(reference: string, from: string, to: string, rate = 2000,
  more: { comp?: boolean; group?: boolean } = {}) {
  return (await sql<{ id: string }>(
    `insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
                               agreed_rate, status, is_complimentary, group_id, route_room_to_group)
     values ($1, $2, (select id from guests where full_name = 'First night guest' limit 1),
             (select id from room_types where hotel_id = $1 and code = 'STD'),
             $3::date, $4::date, $5, 'confirmed', $6, $7, $8)
     returning id::text`,
    [hotelId, reference, from, to, rate, more.comp === true,
     more.group ? groupId : null, more.group === true]))[0]!.id;
}

const checkIn = (id: string, roomNumber: string, more: object = {}) =>
  call(`/stays/${id}/check-in`, "POST", { roomNumber, adults: 1, idSkipReason: "Test", ...more });

interface Line {
  date: string; description: string; amount: string; rate: string; tax: string;
  source: string | null; folio: string;
}
/** The stay's LIVE room lines, oldest first. */
const roomLines = (id: string) => sql<Line>(
  `select fp.business_date::text as date, fp.description, fp.amount::text,
          fp.tax_rate::text as rate, fp.tax_amount::text as tax,
          fp.source_type as source, fp.folio_id::text as folio
     from folio_postings fp
    where fp.reservation_id = $1 and fp.category = 'room' and fp.reverses_id is null
      and not exists (select 1 from folio_postings r where r.reverses_id = fp.id)
    order by fp.business_date, fp.id`, [id]);

const heldFrom = async (id: string) => (await sql<{ d: string }>(
  `select from_date::text as d from room_assignments
    where reservation_id = $1 and released_at is null`, [id]))[0]?.d;

const RULES = `insert into tax_rules (hotel_id, kind, over_amount, rate, note)
               values ($1, 'room', 0, 5, 'Test'), ($1, 'room', 7500, 18, 'Test')`;

let plain = "";     // ₹2,000, room 101
let suite = "";     // ₹8,000, room 102
let routed = "";    // ₹2,000, room 104, on the group's bill
let noRule = "";    // ₹2,000, room 105, checked in while the hotel had no room GST rule

beforeAll(async () => {
  const owner = (await sql<{ id: string }>(
    "select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER, max: 1 });
  try {
    await db.query("select set_config('app.user_id', $1, false)", [owner]);
    hotelId = (await db.query<{ id: string }>(
      "select app.provision_property_unchecked($1,'First Night Test','Nowhere')::text as id",
      [CODE])).rows[0]!.id;
    /* Rooms ready from midnight and kept till the last minute, so the wall
       clock never makes a check-in early or a check-out late. */
    await db.query(
      `update hotels set business_date = date '2026-08-25', check_in_time = '00:00',
                         check_out_time = '23:59'
        where id = $1`, [hotelId]);
    await db.query("select app.bulk_create_rooms($1,'STD',1::smallint,101,110)", [hotelId]);
    await db.query(RULES, [hotelId]);
    await db.query("insert into guests (full_name) values ('First night guest')");
    await db.query(
      `insert into night_audit_runs (hotel_id, business_date, status, completed_at)
       values ($1, date '2026-08-25', 'completed', now())`, [hotelId]);
    groupId = (await db.query<{ id: string }>(
      "insert into reservation_groups (name) values ('FNT group') returning id::text")).rows[0]!.id;
    masterId = (await db.query<{ id: string }>(
      "insert into folios (hotel_id, group_id) values ($1, $2) returning id::text",
      [hotelId, groupId])).rows[0]!.id;
  } finally { await db.end(); }
});

afterAll(async () => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER, max: 1 });
  try {
    await db.query("alter table folio_postings disable trigger folio_postings_append_only");
    await db.query("alter table hotels disable trigger hotels_no_delete");
    await db.query("alter table night_audit_runs disable trigger user");
    await db.query("delete from folio_postings where hotel_id = $1", [hotelId]);
    await db.query("delete from folios where hotel_id = $1", [hotelId]);
    await db.query("delete from hotels where id = $1", [hotelId]);
    await db.query("alter table night_audit_runs enable trigger user");
    await db.query("alter table hotels enable trigger hotels_no_delete");
    await db.query("alter table folio_postings enable trigger folio_postings_append_only");
    await db.query("delete from reservation_groups where id = $1", [groupId]);
  } finally { await db.end(); }
  await closePool();
});

describe("D27-204 · check-in posts the first night", () => {
  it("one room line, dated today, at the stay's rate with its GST, in the clerk's name", async () => {
    plain = await booking(`${CODE}-PLAIN`, "2026-08-26", "2026-08-29");
    const res = await checkIn(plain, "101");
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await roomLines(plain)).toEqual([expect.objectContaining({
      date: "2026-08-26", description: "Room 101 · 1 night",
      amount: "2000.00", rate: "5.00", tax: "100.00", source: "check_in",
    })]);
    const [who] = await sql<{ by: string | null }>(
      `select posted_by::text as by from folio_postings
        where reservation_id = $1 and category = 'room'`, [plain]);
    expect(who!.by).not.toBeNull();
  });

  it("takes the 18% slab above ₹7,500, as the audit does", async () => {
    suite = await booking(`${CODE}-SUITE`, "2026-08-26", "2026-08-29", 8000);
    expect((await checkIn(suite, "102")).status).toBe(200);
    expect(await roomLines(suite)).toEqual([expect.objectContaining({
      amount: "8000.00", rate: "18.00", tax: "1440.00",
    })]);
  });

  it("posts nothing for a complimentary room", async () => {
    const id = await booking(`${CODE}-COMP`, "2026-08-26", "2026-08-29", 0, { comp: true });
    expect((await checkIn(id, "103")).status).toBe(200);
    expect(await roomLines(id)).toEqual([]);
  });

  it("puts a room routed to its group on the group's bill", async () => {
    routed = await booking(`${CODE}-GROUP`, "2026-08-26", "2026-08-29", 2000, { group: true });
    expect((await checkIn(routed, "104")).status).toBe(200);
    expect(await roomLines(routed)).toEqual([expect.objectContaining({
      description: "Room 104 · 1 night", amount: "2000.00", folio: masterId,
    })]);
  });

  /* D27-205: the guest is not kept at the desk for a missing setting. The
     audit is refused until the rule is set, and then posts this night. */
  it("with no GST rule for rooms, still checks the guest in and posts nothing", async () => {
    noRule = await booking(`${CODE}-NORULE`, "2026-08-26", "2026-08-29");
    await sql("delete from tax_rules where hotel_id = $1 and kind = 'room'", [hotelId]);
    try {
      const res = await checkIn(noRule, "105");
      expect(res.status, await res.clone().text()).toBe(200);
    } finally { await sql(RULES, [hotelId]); }
    expect((await sql<{ status: string }>(
      "select status from reservations where id = $1", [noRule]))[0]!.status).toBe("checked_in");
    expect(await roomLines(noRule)).toEqual([]);
  });

  /* D27-205: a guest who checks in and out the same day owes that night. */
  it("refuses a check-out the same day while the night is unpaid", async () => {
    const res = await call(`/stays/${suite}/check-out`, "POST", { lateReason: "Test", waiveLate: true });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toMatch(/₹9,440 is still outstanding/);
  });
});

describe("FD-24 · a check-in that moves the arrival moves the room hold", () => {
  const early = (id: string, room: string) =>
    checkIn(id, room, { earlyReason: "Came early", confirmMove: true });

  it("holds the room from today, and the first night names it", async () => {
    const id = await booking(`${CODE}-MOVED`, "2026-08-31", "2026-09-02");
    expect((await call(`/stays/${id}/assign`, "POST", { roomNumber: "106" })).status).toBe(200);
    expect(await heldFrom(id)).toBe("2026-08-31");

    const res = await early(id, "106");
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await heldFrom(id)).toBe("2026-08-26");
    expect((await roomLines(id)).map((l) => l.description)).toEqual(["Room 106 · 1 night"]);
  });

  it("is refused when somebody else holds the room on a night it moves onto", async () => {
    const other = await booking(`${CODE}-HOLDS`, "2026-08-27", "2026-08-28");
    expect((await call(`/stays/${other}/assign`, "POST", { roomNumber: "107" })).status).toBe(200);

    const id = await booking(`${CODE}-CLASH`, "2026-08-28", "2026-08-30");
    const res = await early(id, "107");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason)
      .toBe(`Room 107 is held by ${CODE}-HOLDS for part of that stay.`);
    expect((await sql<{ status: string }>(
      "select status from reservations where id = $1", [id]))[0]!.status).toBe("confirmed");
  });
});

describe("D27-205 · a room move with a new rate on the arrival day", () => {
  it("puts tonight's posted night right to the new rate, with the reason", async () => {
    const res = await call(`/stays/${plain}/move`, "POST",
      { roomNumber: "108", from: "2026-08-26", reason: "upgrade", agreedRate: 3000 });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await roomLines(plain)).toEqual([expect.objectContaining({
      date: "2026-08-26", amount: "3000.00", rate: "5.00", tax: "150.00", source: "check_in",
    })]);
    const [rev] = await sql<{ description: string }>(
      `select description from folio_postings
        where reverses_id is not null and folio_id in
              (select id from folios where reservation_id = $1)`, [plain]);
    expect(rev!.description).toContain("(why: Room move: upgrade)");
  });
});

describe("Change rate on the arrival day, for a room on the group's bill", () => {
  it("corrects the night on the master", async () => {
    const res = await call(`/stays/${routed}/rate`, "POST", { rate: 2500, reason: "Agreed with the host" });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await roomLines(routed)).toEqual([expect.objectContaining({
      amount: "2500.00", tax: "125.00", folio: masterId,
    })]);
  });
});

describe("D27-204 · the audit never posts the first night twice, and the bill says what is to come", () => {
  const tonight = async (id: string) =>
    ((await (await call(`/stays/${id}/bill`)).json()) as { tonight?: unknown }).tonight;
  const run = async (businessDate: string) => {
    const res = await call("/night-audit/run", "POST", { businessDate });
    expect(res.status, await res.clone().text()).toBe(200);
    return (await res.json()) as { roomsPosted: number; complimentary: number };
  };

  it("on the arrival day nothing is to be posted tonight", async () => {
    expect(await tonight(suite)).toBeUndefined();
  });

  it("the same night's audit posts only the night nobody posted", async () => {
    /* Five paying guests in house; four were charged at check-in. The one
       checked in while there was no GST rule is the audit's. */
    const done = await run("2026-08-26");
    expect(done).toMatchObject({ roomsPosted: 1, complimentary: 1 });
    expect((await roomLines(suite)).map((l) => l.date)).toEqual(["2026-08-26"]);
    expect(await roomLines(noRule)).toEqual([expect.objectContaining({
      date: "2026-08-26", amount: "2000.00", source: "night_audit",
    })]);
  });

  it("the next day the printed bill shows tonight's night, to be posted", async () => {
    expect(await tonight(suite)).toEqual({
      description: "Room 102 · 1 night", amount: 8000, tax: 1440, rate: 18,
    });
  });

  it("and the next night's audit posts night 2", async () => {
    const done = await run("2026-08-27");
    expect(done).toMatchObject({ roomsPosted: 5, complimentary: 1 });
    expect((await roomLines(suite)).map((l) => [l.date, l.source])).toEqual([
      ["2026-08-26", "check_in"], ["2026-08-27", "night_audit"],
    ]);
    /* The 28th now: night 3 is to be posted; a departure day's would not be. */
    expect(await tonight(suite)).toMatchObject({ amount: 8000 });
  });
});
