import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool, withUser } from "../../../src/db.ts";
import { runOnce, serpApi, type Search } from "../../../src/modules/market-rates/sweep.ts";

/* ══════════════════════════════════════════════════════════════════
   RIVALS' PRICES (D27-269, D27-270)

   Each nearby hotel's lowest public price per night, from Google Hotels
   through SerpApi, for the next 30 nights, checked on Mondays and
   Thursdays from 06:00 on the property's clock - only for a hotel whose
   "Rivals' prices" is on, and only while the server has SERPAPI_KEY.

   NOTHING HERE REACHES SERPAPI. The sweep is handed a stand-in search, and
   the one test of the real request stubs `fetch` and reads what it was
   asked. `fetch` is stubbed for the whole file, so a slip fails loudly.
   ══════════════════════════════════════════════════════════════════ */

const SUPER = process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "MKTR";

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Client({ connectionString: SUPER });
  await db.connect();
  try { return (await db.query(text, params)).rows; } finally { await db.end(); }
};

let hotel: { id: string; name: string; city: string };
let otherHotelId: string;
let gmId: string;
let deskId: string;
let housekeepingId: string;
let outsiderId: string;

/* Monday 5 October 2026, 06:30 in Akkalkot (IST is UTC+5:30). */
const MONDAY_0630 = new Date("2026-10-05T01:00:00Z");
const MONDAY_0559 = new Date("2026-10-05T00:29:00Z");
const TUESDAY_0700 = new Date("2026-10-06T01:30:00Z");
const THURSDAY_0600 = new Date("2026-10-08T00:30:00Z");

const call = (who: string, method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method, headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

async function person(email: string, hotelId: string, role: string): Promise<string> {
  const [row] = await sql(
    `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
     on conflict (email) do update set is_active = true returning id::text as id`,
    [email, `${TAG} ${email.split("@")[0]}`, `test-uid-${email}`]);
  await sql("delete from staff_hotels where staff_id = $1", [row!.id]);
  await sql("insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)", [row!.id, hotelId, role]);
  return row!.id as string;
}

/** What Google Hotels answers, in SerpApi's shape: the hotel itself under
    another spelling, two rivals, a holiday flat, and one with no price. */
const answer = (own: string) => ({
  properties: [
    { type: "hotel", name: `Hotel ${own}`, rate_per_night: { extracted_lowest: 3100 } },
    { type: "hotel", name: "Swami Samarth Residency", rate_per_night: { extracted_lowest: 2400 },
      prices: [{ source: "Booking.com", rate_per_night: { extracted_lowest: 2400 } },
               { source: "Agoda", rate_per_night: { extracted_lowest: 2600 } }] },
    { type: "hotel", name: "Hotel Shivneri", rate_per_night: { extracted_lowest: 1800 } },
    { type: "vacation rental", name: "A flat near the temple", rate_per_night: { extracted_lowest: 900 } },
    { type: "hotel", name: "Hotel With No Price" },
  ],
});

const switchOn = (on: boolean) => sql(
  `insert into market_rate_settings (hotel_id, is_on) values ($1, $2)
   on conflict (hotel_id) do update set is_on = $2, last_run_on = null`, [hotel.id, on]);

const asked = () => {
  const calls: Array<{ q: string; checkIn: string; checkOut: string; key: string }> = [];
  const search: Search = async (q, checkIn, checkOut, key) => {
    calls.push({ q, checkIn, checkOut, key });
    return answer(hotel.name);
  };
  return { calls, search };
};

beforeAll(async () => {
  vi.stubGlobal("fetch", () => { throw new Error("this test reached for the network"); });
  const [h] = await sql("select id::text, name, city, timezone from hotels where code = '5EL'");
  expect(h!["timezone"]).toBe("Asia/Kolkata");
  hotel = { id: h!["id"], name: h!["name"], city: h!["city"] };
  otherHotelId = (await sql("select id::text from hotels where code <> '5EL' order by code limit 1"))[0]!["id"];
  gmId = await person("mktr-gm@fidato.in", hotel.id, "gm");
  deskId = await person("mktr-desk@fidato.in", hotel.id, "front_desk");
  housekeepingId = await person("mktr-hk@fidato.in", hotel.id, "housekeeping");
  outsiderId = await person("mktr-outsider@fidato.in", otherHotelId, "gm");
});

beforeEach(async () => {
  delete process.env["SERPAPI_KEY"];
  await sql("delete from market_rates");
  await sql("delete from market_rate_settings");
});

afterAll(async () => {
  vi.unstubAllGlobals();
  delete process.env["SERPAPI_KEY"];
  await sql("delete from market_rates");
  await sql("delete from market_rate_settings");
  await sql("delete from staff_hotels where staff_id = any($1::uuid[])", [[gmId, deskId, housekeepingId, outsiderId]]);
  await sql("update staff set is_active = false where id = any($1::uuid[])", [[gmId, deskId, housekeepingId, outsiderId]]);
  await closePool();
});

describe("the sweep asks nothing until it is switched on (D27-270)", () => {
  it("does nothing without the server's key, even with the switch on", async () => {
    await switchOn(true);
    const { calls, search } = asked();
    const result = await runOnce(undefined, search, MONDAY_0630);
    expect(calls).toEqual([]);
    expect(result.hotels).toBe(0);
    /* Not even marked as checked: the key's absence asks the database nothing. */
    expect((await sql("select last_run_on from market_rate_settings"))[0]!["last_run_on"]).toBeNull();
  });

  it("does nothing without the hotel's switch, even with the key", async () => {
    process.env["SERPAPI_KEY"] = "test-key-not-real";
    const { calls, search } = asked();
    expect((await runOnce(undefined, search, MONDAY_0630)).hotels).toBe(0);
    await switchOn(false);
    expect((await runOnce(undefined, search, MONDAY_0630)).hotels).toBe(0);
    expect(calls).toEqual([]);
  });
});

describe("the check: 30 nights, Monday and Thursday from 06:00 on the property's clock", () => {
  beforeEach(async () => {
    process.env["SERPAPI_KEY"] = "test-key-not-real";
    await switchOn(true);
  });

  it("searches the next 30 nights, one night each, in the hotel's city", async () => {
    const { calls, search } = asked();
    await runOnce(undefined, search, MONDAY_0630);
    expect(calls).toHaveLength(30);
    expect(calls[0]).toEqual({ q: `hotels in ${hotel.city}`, checkIn: "2026-10-05", checkOut: "2026-10-06", key: "test-key-not-real" });
    expect(calls[29]).toMatchObject({ checkIn: "2026-11-03", checkOut: "2026-11-04" });
    expect(new Set(calls.map((c) => c.checkIn)).size).toBe(30);
  });

  it("checks once a day, and only on Mondays and Thursdays from 06:00", async () => {
    const { calls, search } = asked();
    await runOnce(undefined, search, MONDAY_0559);
    expect(calls).toHaveLength(0);
    await runOnce(undefined, search, MONDAY_0630);
    await runOnce(undefined, search, MONDAY_0630);
    expect(calls).toHaveLength(30);
    await runOnce(undefined, search, TUESDAY_0700);
    expect(calls).toHaveLength(30);
    await runOnce(undefined, search, THURSDAY_0600);
    expect(calls).toHaveLength(60);
    expect(calls[30]!.checkIn).toBe("2026-10-08");
  });

  it("keeps the rivals and leaves out the hotel itself, a holiday flat and a hotel with no price", async () => {
    const { search } = asked();
    await runOnce(undefined, search, MONDAY_0630);
    const rows = await sql(
      `select competitor, lowest_price::float8 as price, source from market_rates
        where hotel_id = $1 and stay_date = '2026-10-05' order by lowest_price`, [hotel.id]);
    expect(rows).toEqual([
      { competitor: "Hotel Shivneri", price: 1800, source: null },
      { competitor: "Swami Samarth Residency", price: 2400, source: "Booking.com" },
    ]);
    expect((await sql("select count(*)::int as n from market_rates"))[0]!["n"]).toBe(60);
  });

  it("logs a failed search and tries it again at the next check, never sooner", async () => {
    const { calls, search } = asked();
    const failing: Search = async (q, checkIn, checkOut, key) => {
      if (checkIn === "2026-10-07") throw new Error("SerpApi answered 500");
      return search(q, checkIn, checkOut, key);
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runOnce(undefined, failing, MONDAY_0630);
    expect(result.failed).toBe(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0])).not.toContain("test-key-not-real");
    log.mockRestore();
    await runOnce(undefined, failing, MONDAY_0630);
    expect(calls).toHaveLength(29);
    const dates = await sql("select distinct stay_date::text as d from market_rates");
    expect(dates.map((r) => r["d"])).not.toContain("2026-10-07");
  });
});

describe("what revenue management reads, and who may", () => {
  beforeEach(async () => {
    process.env["SERPAPI_KEY"] = "test-key-not-real";
    await switchOn(true);
    await runOnce(undefined, asked().search, MONDAY_0630);
  });

  it("answers each night's latest check, cheapest first", async () => {
    const res = await call(gmId, "GET", "/market-rates?from=2026-10-05&to=2026-10-06");
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { nights: Array<{ date: string; checkedAt: string; hotels: unknown[] }> };
    expect(body.nights.map((n) => n.date)).toEqual(["2026-10-05", "2026-10-06"]);
    expect(body.nights[0]!.hotels).toEqual([
      { name: "Hotel Shivneri", price: 1800, source: null },
      { name: "Swami Samarth Residency", price: 2400, source: "Booking.com" },
    ]);
    expect(Date.parse(body.nights[0]!.checkedAt)).not.toBeNaN();
  });

  it("is row-secured: another hotel's people see none of it, and nobody writes it directly", async () => {
    const res = await call(outsiderId, "GET", "/market-rates?from=2026-10-05&to=2026-10-06");
    expect(res.status).toBe(404);
    const seen = await withUser(outsiderId, (c) =>
      c.query("select count(*)::int as n from market_rates where hotel_id = $1", [hotel.id]));
    expect(seen.rows[0].n).toBe(0);
    const mine = await withUser(gmId, (c) =>
      c.query("select count(*)::int as n from market_rates where hotel_id = $1", [hotel.id]));
    expect(mine.rows[0].n).toBe(60);
    await expect(withUser(gmId, (c) => c.query(
      `insert into market_rates (hotel_id, stay_date, competitor, lowest_price)
       values ($1, '2026-10-05', 'Made up', 1)`, [hotel.id]))).rejects.toThrow(/permission denied|row-level security/);
  });

  /* The same rule as revenue management's own pickup route: `rate` view. */
  it("is for the people who see prices: housekeeping is refused", async () => {
    const res = await call(housekeepingId, "GET", "/market-rates?from=2026-10-05&to=2026-10-06");
    expect(res.status).toBe(403);
  });
});

describe("the switch: the owner, an Admin or the GM", () => {
  it("is off until saved, says whether the server has its key, and the GM switches it", async () => {
    const before = await call(gmId, "GET", "/market-rates/switch");
    expect(before.status, await before.clone().text()).toBe(200);
    expect(await before.json()).toMatchObject({ isOn: false, keySet: false, lastRunOn: null });
    const put = await call(gmId, "PUT", "/market-rates/switch", { isOn: true });
    expect(put.status, await put.clone().text()).toBe(200);
    process.env["SERPAPI_KEY"] = "test-key-not-real";
    const after = await (await call(gmId, "GET", "/market-rates/switch")).json();
    expect(after).toMatchObject({ isOn: true, keySet: true, changedBy: `${TAG} mktr-gm` });
  });

  it("is refused to reception, and to another hotel's GM", async () => {
    expect((await call(deskId, "PUT", "/market-rates/switch", { isOn: true })).status).toBe(403);
    expect((await call(outsiderId, "PUT", "/market-rates/switch", { isOn: true })).status).toBe(404);
    expect(await sql("select * from market_rate_settings")).toEqual([]);
  });
});

describe("the request to SerpApi", () => {
  it("asks Google Hotels in India, in English, in rupees, for one night", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: URL | string) => {
      urls.push(String(url));
      return new Response(JSON.stringify(answer("x")), { status: 200 });
    });
    try {
      await serpApi("hotels in Akkalkot", "2026-10-05", "2026-10-06", "test-key-not-real");
    } finally {
      vi.stubGlobal("fetch", () => { throw new Error("this test reached for the network"); });
    }
    const url = new URL(urls[0]!);
    expect(`${url.origin}${url.pathname}`).toBe("https://serpapi.com/search.json");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      engine: "google_hotels", q: "hotels in Akkalkot", check_in_date: "2026-10-05",
      check_out_date: "2026-10-06", gl: "in", hl: "en", currency: "INR", api_key: "test-key-not-real",
    });
  });

  it("fails on an error answer, without the key in the message", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "Invalid API key." }), { status: 401 }));
    try {
      await expect(serpApi("hotels in Akkalkot", "2026-10-05", "2026-10-06", "test-key-not-real"))
        .rejects.toThrow(/401/);
    } finally {
      vi.stubGlobal("fetch", () => { throw new Error("this test reached for the network"); });
    }
  });
});
