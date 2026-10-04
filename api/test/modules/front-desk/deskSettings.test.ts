import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { withSession } from "../../../src/auth.ts";
import { dailyFigures } from "../../../src/modules/reports/index.ts";

/* ══════════════════════════════════════════════════════════════════
   PHASE 5 OF THE SETTINGS PLAN (the owner's D27-260; migration 192)

   The hotel's lists (market segments seeded with today's five), the front
   desk's settings, the required booking fields (the desk only), the room
   back from a block as it was, how a complimentary room counts, and the
   group's VIP levels.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const CODE = "FDS";
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
const reason = async (res: Response) => ((await res.json()) as { reason: string }).reason;

beforeAll(async () => {
  const owner = (await sql<{ id: string }>(
    "select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER, max: 1 });
  try {
    await db.query("select set_config('app.user_id', $1, false)", [owner]);
    hotelId = (await db.query<{ id: string }>(
      "select app.provision_property_unchecked($1,'Desk Settings Test','Nowhere')::text as id",
      [CODE])).rows[0]!.id;
    await db.query(
      `update hotels set business_date = date '2026-08-25', check_in_time = '00:00',
                         check_out_time = '23:59'
        where id = $1`, [hotelId]);
    await db.query("select app.bulk_create_rooms($1,'STD',1::smallint,101,104)", [hotelId]);
    await db.query(
      `insert into tax_rules (hotel_id, kind, over_amount, rate, note)
       values ($1, 'room', 0, 5, 'Test')`, [hotelId]);
    await db.query("insert into guests (full_name) values ('Desk settings guest')");
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
    await db.query("update guests set vip_level_id = null where full_name = 'Desk settings guest'");
    await db.query("delete from vip_levels where label = 'FDS Gold'");
    await db.query("delete from hotels where id = $1", [hotelId]);
    await db.query("alter table night_audit_runs enable trigger user");
    await db.query("alter table hotels enable trigger hotels_no_delete");
    await db.query("alter table folio_postings enable trigger folio_postings_append_only");
  } finally { await db.end(); }
  await closePool();
});

describe("the hotel's lists", () => {
  it("starts with today's five market segments, and takes a new one once", async () => {
    const list = (await (await call("/lists/market_segment")).json()) as Array<{ label: string }>;
    expect(list.map((s) => s.label)).toEqual(["Corporate", "Leisure", "Group", "Crew", "Government"]);
    expect((await call("/lists/market_segment", "POST", { label: "Pilgrims" })).status).toBe(200);
    const again = await call("/lists/market_segment", "POST", { label: "pilgrims" });
    expect(again.status).toBe(409);
    expect(await reason(again)).toBe("That one is on the list already.");
  });

  it("will not delete a segment a booking carries: it is switched Off instead", async () => {
    const [s] = await sql<{ id: string }>(
      "select id::text from hotel_lists where hotel_id = $1 and label = 'Crew'", [hotelId]);
    await sql(
      `insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
                                 agreed_rate, status, market_segment)
       values ($1, 'FDS-SEG', (select id from guests where full_name = 'Desk settings guest' limit 1),
               (select id from room_types where hotel_id = $1 and code = 'STD'),
               date '2026-09-01', date '2026-09-02', 2000, 'confirmed', 'Crew')`, [hotelId]);
    const res = await call(`/lists/market_segment/${s!.id}`, "DELETE");
    expect(res.status).toBe(409);
    expect(await reason(res)).toBe("1 booking uses it: switch it Off instead.");
    expect((await call(`/lists/market_segment/${s!.id}`, "PATCH", { active: false })).status).toBe(200);
  });
});

describe("the front desk's settings", () => {
  it("refuses a value that is not a choice, and the screens read what is saved", async () => {
    const bad = await call("/desk-settings", "PATCH", { posRoundOff: "sometimes" });
    expect(bad.status).toBe(409);
    expect(await reason(bad)).toBe("The restaurant's round-off is Off, Manual or Automatic.");
    expect((await call("/desk-settings", "PATCH", {
      defaultGuarantee: "tentative", requiredBookingFields: ["phone"], idTypesOff: ["voter"],
    })).status).toBe(200);
    const list = (await (await app.request("/api/hotels", { headers: { "x-dev-staff-id": "dev-owner" } }))
      .json()) as { hotels: Array<{ code: string; deskRules: Record<string, unknown> }> };
    expect(list.hotels.find((h) => h.code === CODE)?.deskRules).toMatchObject({
      defaultGuarantee: "tentative", requiredBookingFields: ["phone"], idTypesOff: ["voter"],
      posRoundOff: "manual", kpiCompAsSold: true, kpiDayUseHalf: false, holidays: [],
    });
  });

  it("holds the desk's booking without a required field", async () => {
    const [d] = await sql<{ source: string; type: string }>(
      `select app.walk_in_source()::text as source,
              (select id::text from room_types where hotel_id = $1 and code = 'STD') as type`, [hotelId]);
    const res = await call("/bookings", "POST", {
      guestName: "No phone", checkIn: "2026-09-05", checkOut: "2026-09-06", bookingSourceId: d!.source,
      lines: [{ roomTypeId: d!.type, mealPlan: "EP", adults: 1, rooms: 1, agreedRate: 2000 }],
    });
    expect(res.status).toBe(409);
    expect(await reason(res)).toBe("The phone number is needed for a booking at this hotel.");
  });
});

describe("a room back from a block", () => {
  const block = async (room: string) =>
    ((await (await call(`/rooms/${room}/block`, "POST", { reason: "out_of_order", from: TODAY })).json()) as { id: string }).id;
  const status = async (room: string) => (await sql<{ s: string }>(
    "select housekeeping_status as s from rooms where hotel_id = $1 and number = $2", [hotelId, room]))[0]!.s;

  it("is dirty, as before", async () => {
    const id = await block("101");
    expect((await call(`/rooms/101/block/${id}`, "DELETE")).status).toBe(200);
    expect(await status("101")).toBe("dirty");
  });

  it("comes back as it was when the hotel says so", async () => {
    expect((await call("/desk-settings", "PATCH", { hkDirtyAfterUnblock: false })).status).toBe(200);
    const id = await block("102");
    expect(await status("102")).toBe("out_of_service");
    expect((await call(`/rooms/102/block/${id}`, "DELETE")).status).toBe(200);
    expect(await status("102")).toBe("clean");
  });
});

describe("how a complimentary room counts", () => {
  it("is sold, unless the hotel says not", async () => {
    await sql(
      `insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
                                 agreed_rate, status, is_complimentary)
       values ($1, 'FDS-COMP', (select id from guests where full_name = 'Desk settings guest' limit 1),
               (select id from room_types where hotel_id = $1 and code = 'STD'),
               date '2026-08-26', date '2026-08-27', 0, 'confirmed', true)`, [hotelId]);
    const sold = async () => (await withSession("dev-owner", (client) =>
      dailyFigures(client, hotelId, TODAY, TODAY)))[0]!.sold;
    expect(await sold()).toBe(1);
    expect((await call("/desk-settings", "PATCH", { kpiCompAsSold: false })).status).toBe(200);
    expect(await sold()).toBe(0);
  });
});

describe("the group's VIP levels", () => {
  it("gives a guest a level, shown on the stay", async () => {
    const add = await call("/vip-levels", "POST", { label: "FDS Gold", colour: "#D4A017" });
    expect(add.status, await add.clone().text()).toBe(200);
    const levelId = ((await add.json()) as { id: string }).id;
    const [s] = await sql<{ id: string; guest: string }>(
      "select id::text, guest_id::text as guest from reservations where hotel_id = $1 and reference = 'FDS-SEG'", [hotelId]);
    expect((await call(`/guests/${s!.guest}/vip`, "POST", { isVip: true, levelId })).status).toBe(200);
    const stay = (await (await call(`/stays/${s!.id}`)).json()) as { isVip: boolean; vipLevel: string };
    expect(stay).toMatchObject({ isVip: true, vipLevel: "FDS Gold" });
  });
});
