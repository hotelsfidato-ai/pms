import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { useTransportForTests } from "../../../src/modules/channel-manager/su/runtime.ts";
import { TOKEN_SANDBOX, ARI_SUCCESS, PRICE_REFUSED, ok200 } from "./suExamples.ts";

/* ══════════════════════════════════════════════════════════════════
   PART 3 OF THE SU CONNECTION — RATES AND AVAILABILITY

   What must hold:
   1. SU is sent a year from the first date it will take, in its shape:
      rooms left once per room type with no rate; each meal plan's price
      and restrictions with its rate plan; runs of identical days as ranges.
   2. No price of zero, and no price for a guest count nobody priced. Where a
      meal plan has no price of its own the ROOM TYPE'S RACK RATE goes (D17-92),
      and what SU was last sent records that the figure was the rack rate. Where
      there is no price at all the date is sent CLOSED for that meal plan
      (D17-81), because SU cannot take a price back and would otherwise keep
      selling the old one.
   3. A stop sell closes every meal plan of that room type on that date;
      minimum and maximum nights travel as SU's minimumstay/maximumstay.
   4. "changes" sends only the dates that differ from what SU accepted last;
      a refused request is sent again next time.
   5. Only the owner; not before SU has the hotel and a room type; not to
      the live account for a hotel that is not switched on.

   5 Elements from the demo: Superior (sleeps 2, 10 rooms), Deluxe (sleeps 3,
   8 rooms). The demo types no dated prices, so every price is the rack
   fallback until a test types one.
   ══════════════════════════════════════════════════════════════════ */

let ownerId: string;
let gmId: string;
let hotelId: string;
let superiorId: string;
let deluxeId: string;
let first: string;

const admin = async () =>
  new (await import("pg")).default.Pool({
    connectionString:
      process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato",
  });

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

beforeAll(async () => {
  const db = await admin();
  try {
    ownerId = (await db.query<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'")).rows[0]!.id;
    hotelId = (await db.query<{ id: string }>("select id::text from hotels where code = '5EL'")).rows[0]!.id;
    const types = (await db.query<{ id: string; code: string }>(
      "select id::text, code from room_types where hotel_id = $1", [hotelId])).rows;
    superiorId = types.find((t) => t.code === "SUP")!.id;
    deluxeId = types.find((t) => t.code === "DLX")!.id;
    first = (await db.query<{ d: string }>(
      "select greatest(app.business_date(id), (now() at time zone timezone)::date)::text as d from hotels where id = $1",
      [hotelId])).rows[0]!.d;

    const { rows } = await db.query<{ id: string }>(
      `insert into staff (email, full_name, firebase_uid) values ('cm3-gm@fidato.in', 'CMTEST3 gm', 'test-uid-cm3gm')
       on conflict (email) do update set is_active = true returning id::text`);
    gmId = rows[0]!.id;
    await db.query(
      `insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, 'gm')
       on conflict (staff_id, hotel_id) do update set role = 'gm'`, [gmId, hotelId]);
  } finally { await db.end(); }
});

/* SU already has the hotel, both room types, and EP and CP (part 2 done). */
const onSu = async () => {
  const db = await admin();
  try {
    await db.query(
      `insert into channel_hotels (hotel_id, su_hotel_id, on_su) values ($1, 'FIDATO-5EL', true)`, [hotelId]);
    await db.query(
      `insert into channel_room_types (room_type_id, hotel_id, su_room_id, su_room_type, max_children, is_connected, on_su)
       values ($1, $3, 'SUP', 9, 1, true, 'active'), ($2, $3, 'DLX', 7, 2, true, 'active')`,
      [superiorId, deluxeId, hotelId]);
    await db.query(
      `insert into channel_rate_plans (hotel_id, meal_plan, su_rate_plan_id, su_meal_plan, is_connected, on_su)
       values ($1, 'EP', 'EP', 15, true, 'active'), ($1, 'CP', 'CP', 2, true, 'active')`, [hotelId]);
  } finally { await db.end(); }
};

beforeEach(() => {
  process.env["SU_ENVIRONMENT"] = "sandbox";
  process.env["SU_CLIENT_ID"] = "test-client";
  process.env["SU_CLIENT_SECRET"] = "test-secret";
});

afterEach(async () => {
  for (const n of ["SU_ENVIRONMENT", "SU_CLIENT_ID", "SU_CLIENT_SECRET"]) delete process.env[n];
  useTransportForTests(null);
  const db = await admin();
  try {
    for (const t of ["channel_ari_sent", "channel_ari_pushes", "channel_room_types", "channel_rate_plans", "channel_hotels"]) {
      await db.query(`delete from ${t} where hotel_id = $1`, [hotelId]);
    }
    await db.query("delete from rate_restrictions where hotel_id = $1 and for_date >= $2", [hotelId, first]);
    await db.query("delete from room_blocks where hotel_id = $1 and note = 'CMTEST3'", [hotelId]);
    await db.query("delete from rates where hotel_id = $1 and label = 'CMTEST3'", [hotelId]);
  } finally { await db.end(); }
});

afterAll(async () => {
  const db = await admin();
  try {
    await db.query("delete from staff_hotels where staff_id = $1", [gmId]);
    await db.query("update staff set is_active = false where id = $1", [gmId]);
  } finally { await db.end(); }
  await closePool();
});

type Entry = Record<string, unknown> & { value?: string; from?: string; to?: string };
type Sent = { hotelid: string; room: Array<{ roomid: string; date: Entry[] }> };

const pretendSu = (answer: (body: Sent, n: number) => unknown = () => ARI_SUCCESS) => {
  const calls: Sent[] = [];
  useTransportForTests(async (req) => {
    if (req.url.endsWith("/auth/generate-access-token")) return ok200(TOKEN_SANDBOX);
    expect(new URL(req.url).pathname).toBe("/SUAPI/jservice/availability");
    const body = JSON.parse(req.body!) as Sent;
    calls.push(body);
    return ok200(answer(body, calls.length));
  });
  return calls;
};

const push = (staffId: string, kind: "all" | "changes") =>
  app.request("/api/hotels/5EL/channel-manager/availability/send", {
    method: "POST",
    headers: { "x-dev-staff-id": staffId, "content-type": "application/json" },
    body: JSON.stringify({ kind }),
  });

/* Every entry SU was sent, flattened to one per date, with its room id. */
type Flat = Record<string, unknown> & { roomid: string; date: string };
const perDate = (calls: Sent[]): Flat[] => calls.flatMap((c) => c.room.flatMap((r) => r.date.flatMap((e) => {
  const { value, from, to, ...rest } = e;
  const dates: string[] = [];
  if (value) dates.push(value);
  else for (let d = from!; d <= to!; d = addDays(d, 1)) dates.push(d);
  return dates.map((date): Flat => ({ ...rest, roomid: r.roomid, date }));
})));

const rateOf = (e: Record<string, unknown>) =>
  (e["rate"] as Array<{ rateplanid: string }> | undefined)?.[0]?.rateplanid ?? null;

describe("who and when", () => {
  it("is refused to a GM, and before SU has the hotel", async () => {
    await onSu();
    expect((await push(gmId, "all")).status).toBe(403);
    const db = await admin();
    try { await db.query("update channel_room_types set on_su = null where hotel_id = $1", [hotelId]); }
    finally { await db.end(); }
    const calls = pretendSu();
    const res = await push(ownerId, "all");
    expect(res.status).toBe(409);
    expect(calls).toHaveLength(0);
  });

  it("does not reach the live account for a hotel that is not switched on", async () => {
    await onSu();
    process.env["SU_ENVIRONMENT"] = "live";
    const calls = pretendSu();
    const res = await push(ownerId, "all");
    expect(res.status).toBe(409);
    expect(calls).toHaveLength(0);
  });
});

describe("a year, in SU's shape", () => {
  it("sends rooms left once per room type for every day of a year, and no price nobody set", async () => {
    await onSu();
    const calls = pretendSu();
    const res = await push(ownerId, "all");
    const body = await res.json() as {
      ok: boolean; from: string; to: string; rackDates: number; unpricedDates: number; reason: string;
    };
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.from).toBe(first);
    expect(body.to).toBe(addDays(first, 364));
    expect(calls.every((c) => c.hotelid === "FIDATO-5EL")).toBe(true);

    const entries = perDate(calls);
    for (const roomid of ["SUP", "DLX"]) {
      const roomsLeft = entries.filter((e) => e.roomid === roomid && "roomstosell" in e);
      expect(roomsLeft).toHaveLength(365);
      expect(roomsLeft.every((e) => rateOf(e) === null && !("price" in e))).toBe(true);
    }
    /* The demo types no dated price, so every meal plan date sells at its room
       type's rack rate and stays open (D17-92) - and the answer says so in
       words, because a room is selling at a figure nobody typed for that plan. */
    const rateCells = entries.filter((e) => rateOf(e) !== null);
    expect(rateCells).toHaveLength(2 * 2 * 365);
    expect(rateCells.every((e) => e["closed"] === "0" && "price" in e)).toBe(true);
    expect(body.rackDates).toBe(2 * 2 * 365);
    expect(body.unpricedDates).toBe(0);
    expect(body.reason).toMatch(/selling at the rack rate/);
    /* Identical days travel as ranges, not 730 single days. */
    const raw = calls.flatMap((c) => c.room.flatMap((r) => r.date));
    expect(raw.length).toBeLessThan(20);
  });

  it("sends a typed price per number of guests, leaves out a guest count nobody priced, and never zero", async () => {
    await onSu();
    const db = await admin();
    try {
      await db.query("select app.set_rate($1, $2, 'EP', $3::date, $4::date, 4500, 'CMTEST3', $5)",
        [hotelId, deluxeId, addDays(first, 3), addDays(first, 6), ownerId]);
      await db.query("select app.set_rate($1, $2, 'EP', $3::date, $4::date, 0, 'CMTEST3', $5)",
        [hotelId, superiorId, addDays(first, 3), addDays(first, 4), ownerId]);
    } finally { await db.end(); }

    const calls = pretendSu();
    expect((await push(ownerId, "all")).status).toBe(200);
    const entries = perDate(calls);

    const deluxeEp = (d: number) => entries.find((e) => e.roomid === "DLX" && rateOf(e) === "EP" && e.date === addDays(first, d))!;
    for (const d of [3, 4, 5]) {
      /* Sleeps 3, but no extra-adult figure: one and two guests go, three does not. */
      expect(deluxeEp(d)["price"]).toEqual([
        { NumberOfGuests: "1", value: "4500.00" }, { NumberOfGuests: "2", value: "4500.00" },
      ]);
    }
    /* The rate ends before the 6th (the last day is not included), so the 6th
       falls back to the room type's rack rate and keeps selling; so does
       breakfast, which has no price of its own (D17-92). A TYPED ZERO is the
       one figure that never reaches a booking site: it is not a fallback, so
       nothing takes its place and the date goes closed with no price. */
    expect(deluxeEp(6)).toMatchObject({ closed: "0" });
    expect(deluxeEp(6)!["price"]).toBeTruthy();
    const cp3 = entries.find((e) => e.roomid === "DLX" && rateOf(e) === "CP" && e.date === addDays(first, 3))!;
    expect(cp3).toMatchObject({ closed: "0" });
    expect(cp3["price"]).toBeTruthy();
    const sup3 = entries.find((e) => e.roomid === "SUP" && rateOf(e) === "EP" && e.date === addDays(first, 3))!;
    expect(sup3).toMatchObject({ closed: "1" });
    expect(sup3["price"]).toBeUndefined();
    for (const d of [3, 4, 5]) expect(deluxeEp(d)["closed"]).toBe("0");
  });

  it("closes every meal plan of a room type on a stop sell, priced or not, and carries minimum and maximum nights", async () => {
    await onSu();
    const db = await admin();
    try {
      /* Deluxe priced for both meal plans on the 10th to the 12th. */
      for (const plan of ["EP", "CP"]) {
        await db.query("select app.set_rate($1, $2, $3, $4::date, $5::date, 4800, 'CMTEST3', $6)",
          [hotelId, deluxeId, plan, addDays(first, 10), addDays(first, 13), ownerId]);
      }
      await db.query(
        `insert into rate_restrictions (hotel_id, room_type_id, for_date, stop_sell, closed_arrival, closed_departure, min_nights, max_nights, set_by)
         values ($1, $2, $4, true, false, false, null, null, $6),
                ($1, $2, $5, false, true, false, 3, 7, $6),
                ($1, $3, $4, true, false, false, null, null, $6)`,
        [hotelId, deluxeId, superiorId, addDays(first, 10), addDays(first, 11), ownerId]);
    } finally { await db.end(); }

    const calls = pretendSu();
    expect((await push(ownerId, "all")).status).toBe(200);
    const entries = perDate(calls);
    const on = (room: string, d: number, plan: string) =>
      entries.find((e) => e.roomid === room && rateOf(e) === plan && e.date === addDays(first, d));

    expect(on("DLX", 10, "EP")!["closed"]).toBe("1");
    expect(on("DLX", 10, "CP")!["closed"]).toBe("1");
    expect(on("DLX", 11, "EP")).toMatchObject({ closed: "0", closedonarrival: "1", minimumstay: "3", maximumstay: "7" });
    expect(on("DLX", 12, "EP")).toMatchObject({ closed: "0", closedonarrival: "0", minimumstay: "1" });
    expect(on("DLX", 12, "EP")!["maximumstay"]).toBeUndefined();
    /* Superior has no dated price, so it sells at its rack rate (D17-92) - but
       a stop sell closes it all the same, price or no price, and the price
       still goes with it so SU holds the right figure when it reopens. */
    expect(on("SUP", 10, "EP")).toMatchObject({ closed: "1" });
    expect(on("SUP", 11, "EP")).toMatchObject({ closed: "0" });
    expect(on("SUP", 11, "EP")!["price"]).toBeTruthy();
  });
});

describe("the price for each number of guests", () => {
  it("is app.tariff_for's, date by date and guest by guest", async () => {
    await onSu();
    const db = await admin();
    try {
      /* Deluxe sleeps 3: a season with an extra-adult figure, one without, and
         breakfast on neither, so every branch of the rule is on the calendar. */
      await db.query("select app.set_rate($1, $2, 'EP', $3::date, $4::date, 4200, 'CMTEST3', $5, 800, 300)",
        [hotelId, deluxeId, addDays(first, 0), addDays(first, 10), ownerId]);
      await db.query("select app.set_rate($1, $2, 'EP', $3::date, $4::date, 5100, 'CMTEST3', $5)",
        [hotelId, deluxeId, addDays(first, 10), addDays(first, 20), ownerId]);

      const { readAri } = await import("../../../src/modules/channel-manager/ari/source.ts");
      const { withSession } = await import("../../../src/auth.ts");
      const to = addDays(first, 29);
      const snapshot = await withSession(ownerId, (client) => readAri(client, hotelId, first, to));
      const deluxe = snapshot!.rooms.find((r) => r.suRoomId === "DLX")!;

      let compared = 0;
      for (const plan of deluxe.plans) {
        for (const p of plan.prices) {
          const { rows } = await db.query<{ total: string | null }>(
            `select t.total::text from generate_series(1, 3) n
               cross join lateral app.tariff_for($1, $2, $3::date, n, 0) t order by n`,
            [deluxeId, plan.mealPlan, p.date]);
          expect(p.byGuests, `${plan.mealPlan} ${p.date}`).toEqual(rows.map((r) => r.total));
          compared += 1;
        }
      }
      expect(compared).toBe(2 * 30);
      /* And the calendar really held all three answers. */
      const all = deluxe.plans.flatMap((pl) => pl.prices.map((p) => p.byGuests[2]));
      expect(all).toContain("5000.00");
      expect(all).toContain(null);
    } finally { await db.end(); }
  });
});

describe("only what changed", () => {
  it("sends nothing when SU already has it, then only the date that changed", async () => {
    await onSu();
    pretendSu();
    expect((await push(ownerId, "all")).status).toBe(200);

    const quiet = pretendSu();
    const none = await push(ownerId, "changes");
    const noneBody = await none.json() as { requests: number; reason: string };
    expect(noneBody.requests).toBe(0);
    expect(quiet).toHaveLength(0);

    /* A Deluxe room goes out of service for one night. */
    const db = await admin();
    let before = 0;
    try {
      before = Number((await db.query<{ n: string }>(
        `select value->>'roomstosell' as n from channel_ari_sent
          where hotel_id = $1 and room_type_id = $2 and meal_plan = '-' and for_date = $3`,
        [hotelId, deluxeId, addDays(first, 20)])).rows[0]!.n);
      await db.query(
        `insert into room_blocks (hotel_id, room_id, from_date, to_date, reason, note)
         select $1, r.id, $2::date, $2::date, 'out_of_order', 'CMTEST3'
           from rooms r where r.room_type_id = $3 and r.is_active order by r.number limit 1`,
        [hotelId, addDays(first, 20), deluxeId]);
    } finally { await db.end(); }

    const calls = pretendSu();
    const res = await push(ownerId, "changes");
    expect(res.status).toBe(200);
    const entries = perDate(calls);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ roomid: "DLX", date: addDays(first, 20) });
    expect(before).toBeGreaterThan(0);
    expect(Number(entries[0]!["roomstosell"])).toBe(before - 1);
    /* 15-19 s alone on this machine, release 13's code and 14's alike; over 20 s in
       the full run (release 14's gates). */
  }, 60_000);

  it("sends a refused request again next time, and logs what SU said", async () => {
    await onSu();
    pretendSu(() => PRICE_REFUSED);
    const refused = await push(ownerId, "all");
    expect(refused.status).toBe(502);
    expect((await refused.json() as { reason: string }).reason).toContain("price");

    const calls = pretendSu();
    expect((await push(ownerId, "changes")).status).toBe(200);
    /* Everything the refused push carried: a year of rooms left for each room
       type, and every meal plan date at its room type's rack rate. */
    expect(perDate(calls).length).toBe(2 * 365 + 2 * 2 * 365);

    const db = await admin();
    try {
      const { rows } = await db.query<{ kind: string; ok: boolean; result: string }>(
        "select kind, ok, result from channel_ari_pushes where hotel_id = $1 order by id", [hotelId]);
      expect(rows.map((r) => [r.kind, r.ok])).toEqual([["all", false], ["changes", true]]);
      expect(rows[0]!.result).toContain("price");
    } finally { await db.end(); }
  });
});

/* ══════════════════════════════════════════════════════════════════
   D17-92 — WHICH FIGURE WENT TO SU, AND WHY

   The rack rate sells a room at a figure nobody typed for that meal plan, so
   the night must be answerable afterwards: what SU was last sent records where
   the price came from (`price_source`, migration 110).
   ══════════════════════════════════════════════════════════════════ */
describe("what SU was sent, and where the figure came from", () => {
  const sourcesFor = async (roomTypeId: string, date: string) => {
    const db = await admin();
    try {
      const { rows } = await db.query<{ meal_plan: string; price_source: string | null }>(
        `select meal_plan, price_source from channel_ari_sent
          where hotel_id = $1 and room_type_id = $2 and for_date = $3 order by meal_plan`,
        [hotelId, roomTypeId, date]);
      return new Map(rows.map((r) => [r.meal_plan, r.price_source]));
    } finally { await db.end(); }
  };

  it("says 'rack' for a meal plan with no price of its own, and nothing for rooms left", async () => {
    await onSu();
    pretendSu();
    expect((await push(ownerId, "all")).status).toBe(200);

    const sources = await sourcesFor(deluxeId, addDays(first, 4));
    expect(sources.get("EP")).toBe("rack");
    expect(sources.get("CP")).toBe("rack");
    /* Rooms left carries no price, so it has no source to record. */
    expect(sources.get("-")).toBe(null);
  });

  it("says 'typed' once somebody prices the plan, and the screen's count follows", async () => {
    await onSu();
    pretendSu();
    expect((await push(ownerId, "all")).status).toBe(200);

    const db = await admin();
    try {
      await db.query("select app.set_rate($1, $2, 'EP', $3::date, $4::date, 5200, 'CMTEST3', $5)",
        [hotelId, deluxeId, addDays(first, 4), addDays(first, 5), ownerId]);
    } finally { await db.end(); }

    pretendSu();
    const res = await push(ownerId, "changes");
    expect(res.status).toBe(200);
    expect((await sourcesFor(deluxeId, addDays(first, 4))).get("EP")).toBe("typed");
    /* Every other night of that plan is still the rack rate, and the screen
       reads the standing count from what SU holds, not from a past push. */
    const seen = await app.request("/api/hotels/5EL/channel-manager/availability",
      { headers: { "x-dev-staff-id": ownerId } });
    const state = await seen.json() as { atRackRate: { nights: number; firstDate: string | null } };
    expect(state.atRackRate.nights).toBe(2 * 2 * 365 - 1);
    expect(state.atRackRate.firstDate).toBe(first);
  });

  it("corrects the source without sending anything when only the source changed", async () => {
    await onSu();
    pretendSu();
    expect((await push(ownerId, "all")).status).toBe(200);

    /* Somebody types, for one night, exactly the figure the rack rate was
       already selling at. SU holds the right price already; the record does
       not, and it is the record that answers "why was this night that price?". */
    const db = await admin();
    try {
      const { rows } = await db.query<{ rate: string }>(
        "select base_rate::text as rate from room_types where id = $1", [deluxeId]);
      await db.query("select app.set_rate($1, $2, 'EP', $3::date, $4::date, $5::numeric, 'CMTEST3', $6)",
        [hotelId, deluxeId, addDays(first, 7), addDays(first, 8), rows[0]!.rate, ownerId]);
    } finally { await db.end(); }

    const quiet = pretendSu();
    expect((await push(ownerId, "changes")).status).toBe(200);
    expect(quiet).toHaveLength(0);
    expect((await sourcesFor(deluxeId, addDays(first, 7))).get("EP")).toBe("typed");
  });
});

/* FD-16's stale column: `hotels.business_date` never moves once a night audit
   has run. With today closed (the audit run before midnight), the hotel is on
   tomorrow - SU must not be sent today, nor the screen count it as selling. */
describe("a property whose day is closed", () => {
  it("starts SU's year and the rack-rate count the day after the last closed day", async () => {
    await onSu();
    const db = await admin();
    let today = "";
    try {
      today = (await db.query<{ d: string }>(
        "select (now() at time zone timezone)::date::text as d from hotels where id = $1",
        [hotelId])).rows[0]!.d;
      await db.query(
        `insert into night_audit_runs (hotel_id, business_date, status, completed_at)
         values ($1, $2::date, 'completed', now())`, [hotelId, today]);

      const calls = pretendSu();
      expect((await push(ownerId, "all")).status).toBe(200);
      expect(perDate(calls).map((e) => e.date).sort()[0]).toBe(addDays(today, 1));

      /* What SU still holds for the closed day is not selling any more. */
      await db.query(
        `insert into channel_ari_sent (hotel_id, room_type_id, meal_plan, for_date, value, price_source)
         values ($1, $2, 'EP', $3::date, '{}', 'rack')`, [hotelId, deluxeId, today]);
      const seen = await app.request("/api/hotels/5EL/channel-manager/availability",
        { headers: { "x-dev-staff-id": ownerId } });
      const state = await seen.json() as { atRackRate: { firstDate: string | null } };
      expect(state.atRackRate.firstDate).toBe(addDays(today, 1));
    } finally {
      await db.query("delete from night_audit_runs where hotel_id = $1 and business_date = $2::date",
        [hotelId, today]);
      await db.end();
    }
  });
});
