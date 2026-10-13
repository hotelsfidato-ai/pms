import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { withSession } from "../../../src/auth.ts";
import { roomNightsDue } from "../../../src/modules/night-audit/index.ts";

/* ══════════════════════════════════════════════════════════════════
   THE OWNER'S D27-223 AND D27-225 (1 October)

   D27-223: the desk's early check-in and late check-out fees are part of the
   room. They are posted with their own source ('early_checkin',
   'late_checkout'), so the bill's sections put them under Room; the Bill
   tab and the printed bill (app.stay_bill, 175) both carry it.

   D27-225: a day-use stay (out the day it comes) is charged its day rate with
   GST at check-in, through the night audit's own code, like a first night;
   the run never charges it. Complimentary: nothing. No GST rule: checked in,
   nothing posted.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const CODE = "FFD";
const TODAY = "2026-08-26";
let hotelId = "";

const call = (path: string, method = "GET", body?: unknown) =>
  app.request(`/api/hotels/${CODE}${path}`, {
    method,
    headers: {
      "x-dev-staff-id": "dev-owner",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

async function booking(reference: string, to: string, rate = 2000, comp = false) {
  return (await sql<{ id: string }>(
    `insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
                               agreed_rate, status, is_complimentary)
     values ($1, $2, (select id from guests where full_name = 'Fees guest' limit 1),
             (select id from room_types where hotel_id = $1 and code = 'STD'),
             $3::date, $4::date, $5, 'confirmed', $6)
     returning id::text`, [hotelId, reference, TODAY, to, rate, comp]))[0]!.id;
}

const checkIn = (id: string, roomNumber: string, more: object = {}) =>
  call(`/stays/${id}/check-in`, "POST", { roomNumber, adults: 1, idSkipReason: "Test", ...more });

const lines = (id: string) => sql<{
  category: string; description: string; amount: string; tax: string; source: string | null;
}>(
  `select fp.category, fp.description, fp.amount::text, fp.tax_amount::text as tax,
          fp.source_type as source
     from folio_postings fp
    where fp.reservation_id = $1 and fp.reverses_id is null
    order by fp.id`, [id]);

const RULE = `insert into tax_rules (hotel_id, kind, over_amount, rate, note)
              values ($1, 'room', 0, 5, 'Test')`;

beforeAll(async () => {
  const owner = (await sql<{ id: string }>(
    "select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER, max: 1 });
  try {
    await db.query("select set_config('app.user_id', $1, false)", [owner]);
    hotelId = (await db.query<{ id: string }>(
      "select app.provision_property_unchecked($1,'Fees Test','Nowhere')::text as id",
      [CODE])).rows[0]!.id;
    await db.query(
      `update hotels set business_date = date '2026-08-25', check_in_time = '00:00',
                         check_out_time = '23:59', early_checkin_charge = 500,
                         late_checkout_charge = 400
        where id = $1`, [hotelId]);
    await db.query("select app.bulk_create_rooms($1,'STD',1::smallint,101,108)", [hotelId]);
    await db.query(RULE, [hotelId]);
    await db.query("insert into guests (full_name) values ('Fees guest')");
    await db.query(
      `insert into night_audit_runs (hotel_id, business_date, status, completed_at)
       values ($1, date '2026-08-25', 'completed', now())`, [hotelId]);
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
  } finally { await db.end(); }
  await closePool();
});

describe("D27-223 · the room's own fees are the room's on the bill", () => {
  let stay = "";

  it("posts an early check-in fee with its own source, and both bills carry it", async () => {
    stay = await booking(`${CODE}-EARLY`, "2026-08-28");
    /* Rooms from 23:59: any hour of the test is early. */
    await sql("update hotels set check_in_time = '23:59' where id = $1", [hotelId]);
    try {
      const res = await checkIn(stay, "101", { earlyReason: "Off the night train" });
      expect(res.status, await res.clone().text()).toBe(200);
    } finally {
      await sql("update hotels set check_in_time = '00:00' where id = $1", [hotelId]);
    }
    expect((await lines(stay)).filter((l) => l.category === "misc")).toEqual([
      expect.objectContaining({ description: "Early check-in", amount: "500.00", source: "early_checkin" }),
    ]);
    const tab = (await (await call(`/stays/${stay}/postings`)).json()) as
      Array<{ description: string; source?: string | null }>;
    expect(tab.find((l) => l.description === "Early check-in")?.source).toBe("early_checkin");
    const bill = (await (await call(`/stays/${stay}/bill`)).json()) as
      { lines: Array<{ description: string; source?: string | null }> };
    expect(bill.lines.find((l) => l.description === "Early check-in")?.source).toBe("early_checkin");
  });

  /* The late check-out fee's own source ('late_checkout') is proved where
     a departure can be late: a stay checked in on the business date leaves
     early (D27-314 (2)) - lateDeparture.test.ts. */
});

describe("D27-225 · a day-use stay is charged its day at check-in", () => {
  it("posts the day rate with its GST, in the room's words", async () => {
    const id = await booking(`${CODE}-DAY`, TODAY, 1800);
    const res = await checkIn(id, "102");
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await lines(id)).toEqual([expect.objectContaining({
      category: "room", description: "Room 102 · day use", amount: "1800.00", tax: "90.00",
      source: "check_in",
    })]);
  });

  it("posts nothing for a complimentary day use", async () => {
    const id = await booking(`${CODE}-DAYCOMP`, TODAY, 0, true);
    expect((await checkIn(id, "103")).status).toBe(200);
    expect(await lines(id)).toEqual([]);
  });

  let noRule = "";
  it("with no GST rule for rooms, checks the guest in and posts nothing", async () => {
    noRule = await booking(`${CODE}-DAYNORULE`, TODAY);
    await sql("delete from tax_rules where hotel_id = $1 and kind = 'room'", [hotelId]);
    try {
      const res = await checkIn(noRule, "104");
      expect(res.status, await res.clone().text()).toBe(200);
    } finally { await sql(RULE, [hotelId]); }
    expect(await lines(noRule)).toEqual([]);
  });

  it("is never the night audit's: the run's read leaves a day use out", async () => {
    const due = await withSession("dev-owner", (client) => roomNightsDue(client, hotelId, TODAY));
    expect(due.map((d) => d.reservation_id)).not.toContain(noRule);
  });
});

/* THE OWNER'S D27-227, D27-229 (1 October): New booking makes a day use; its
   price is typed on every booking - never the night's tariff, never a zero -
   and a day use can be amended, keeping its price. */
describe("D27-227 · a day use from New booking", () => {
  const book = async (lines: object[]) => {
    const [d] = await sql<{ source: string; type: string }>(
      `select app.walk_in_source()::text as source,
              (select id::text from room_types where hotel_id = $1 and code = 'STD') as type`,
      [hotelId]);
    return call("/bookings", "POST", {
      guestName: "Day use guest", checkIn: "2026-08-27", checkOut: "2026-08-27",
      bookingSourceId: d!.source,
      lines: lines.map((l) => ({ roomTypeId: d!.type, mealPlan: "EP", adults: 1, rooms: 1, ...l })),
    });
  };

  it("is refused with no typed price - never the night's tariff - and with a zero", async () => {
    for (const line of [{}, { agreedRate: 0 }]) {
      const res = await book([line]);
      expect(res.status).toBe(409);
      expect(((await res.json()) as { reason: string }).reason).toBe("Type the day-use price.");
    }
  });

  let dayUse = "";
  it("is saved as a day use at the typed price", async () => {
    const res = await book([{ agreedRate: 1500 }]);
    expect(res.status, await res.clone().text()).toBe(200);
    dayUse = ((await res.json()) as { bookings: Array<{ id: string }> }).bookings[0]!.id;
    const [r] = await sql<{ day_use: boolean; rate: string }>(
      "select is_day_use as day_use, agreed_rate::text as rate from reservations where id = $1", [dayUse]);
    expect(r).toEqual({ day_use: true, rate: "1500.00" });
  });

  /* RES-14 (the owner's D27-239): who made each booking. created_by was
     never written. */
  it("records who made it", async () => {
    const [r] = await sql<{ by: string | null; owner: string }>(
      `select created_by::text as by,
              (select id::text from staff where email = 'owner@fidato.in') as owner
         from reservations where id = $1`, [dayUse]);
    expect(r!.by).toBe(r!.owner);
  });

  it("can be amended, and keeps its price; it does not turn into nights", async () => {
    const res = await call(`/stays/${dayUse}`, "PATCH", { adults: 2 });
    expect(res.status, await res.clone().text()).toBe(200);
    const [r] = await sql<{ adults: number; ci: string; co: string; rate: string }>(
      `select adults, check_in::text as ci, check_out::text as co, agreed_rate::text as rate
         from reservations where id = $1`, [dayUse]);
    expect(r).toEqual({ adults: 2, ci: "2026-08-27", co: "2026-08-27", rate: "1500.00" });
    const nights = await call(`/stays/${dayUse}`, "PATCH", { checkOut: "2026-08-28" });
    expect(nights.status).toBe(409);
    expect(((await nights.json()) as { reason: string }).reason)
      .toBe("A day use stays a day use: its price is the day's. To stay the night, book the nights.");
  });
});
