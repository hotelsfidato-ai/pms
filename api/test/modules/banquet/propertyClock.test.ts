import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   A FUNCTION'S TIME BELONGS TO THE PROPERTY (BQ-8, MEMORY 297)

   A clerk at Akkalkot types 19:00. That is 19:00 in Akkalkot, whatever
   the server thinks the time is - and the hotel's server keeps its
   database in GMT, so "whatever the server thinks" was five and a half
   hours out. The diary read it back in the server's zone and showed
   19:00; the till converted to the property's zone and saw half past
   midnight the next day. One moment, two days.

   THIS FILE ASKS IN THE SERVER'S WORST CASE, deliberately: every query
   below runs with the session time zone set to UTC, the way the live box
   runs it. Before the fix, "19:00" stored as 19:00 UTC and every
   assertion here failed by 5 hours 30.
   ══════════════════════════════════════════════════════════════════ */

const SUPER = process.env["SUPER_DATABASE_URL"]
  ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";

/** A connection that thinks it is in GMT, as the hotel's server does. */
const inUtc = async <T>(
  fn: (q: (text: string, params?: unknown[]) => Promise<{ rows: T[] }>) => Promise<void>,
) => {
  const pg = (await import("pg")).default;
  const db = new pg.Pool({ connectionString: SUPER });
  try {
    await db.query("set time zone 'UTC'");
    await fn(async (text, params) => {
      const result = await db.query(text, params);
      return { rows: result.rows as T[] };
    });
  } finally {
    await db.end();
  }
};

const TAG = "CLOCKTEST";
let ownerStaffId: string;
let hotelId: string;
let venueId: string;
let eventId: string;

const post = (path: string, body?: unknown) =>
  app.request(`/api/hotels${path}`, {
    method: "POST",
    headers: { "x-dev-staff-id": ownerStaffId, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

beforeAll(async () => {
  await inUtc<{ id: string; is_enabled?: boolean }>(async (q) => {
    ownerStaffId = (await q("select id::text as id from staff where email = 'owner@fidato.in'")).rows[0]!.id;
    hotelId = (await q("select id::text as id from hotels where code = '5EL'")).rows[0]!.id;
    await q(
      `insert into hotel_modules (hotel_id, module, is_enabled) values ($1,'banquet',true)
       on conflict (hotel_id, module) do update set is_enabled = true`, [hotelId]);
  });

  const venue = await post("/5EL/banquet/venues", { name: `${TAG} Hall` });
  expect(venue.status, await venue.clone().text()).toBe(200);
  venueId = ((await venue.json()) as { id: string }).id;
});

afterAll(async () => {
  await inUtc(async (q) => {
    await q("delete from banquet_events where title like $1", [`${TAG}%`]);
    await q("delete from banquet_venues where name like $1", [`${TAG}%`]);
  });
  await closePool();
});

describe("a time typed at the property", () => {
  it("is stored as the property's own clock, not the server's", async () => {
    /* 19:00 on the 17th, typed by a clerk in Akkalkot, with no offset -
       exactly what the screen sends. */
    const made = await post("/5EL/banquet/events", {
      venueId, title: `${TAG} Reception`, hostName: "Mr Sharma",
      startsAt: "2029-03-17T19:00", endsAt: "2029-03-17T23:00",
    });
    expect(made.status, await made.clone().text()).toBe(200);
    eventId = ((await made.json()) as { id: string }).id;

    await inUtc<{ same: boolean; utc: string }>(async (q) => {
      const { rows } = await q(
        `select starts_at = timestamptz '2029-03-17 19:00+05:30' as same,
                to_char(starts_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') as utc
           from banquet_events where id = $1`, [eventId]);
      /* The moment a guest would arrive: 19:00 in Akkalkot, which is 13:30
         the same day in GMT. Stored as 19:00 GMT before the fix. */
      expect(rows[0]!.same, `stored as ${rows[0]!.utc} UTC`).toBe(true);
      expect(rows[0]!.utc).toBe("2029-03-17 13:30");
    });
  });

  it("reads back on the property's clock, on every screen that shows it", async () => {
    const one = await app.request(`/api/hotels/5EL/banquet/events/${eventId}`,
      { headers: { "x-dev-staff-id": ownerStaffId } });
    const body = (await one.json()) as { startsAt: string; endsAt: string };
    expect(body.startsAt, "the screen shows what the clerk typed").toBe("2029-03-17T19:00");
    expect(body.endsAt).toBe("2029-03-17T23:00");

    const diary = await app.request(
      "/api/hotels/5EL/banquet?from=2029-03-17&to=2029-03-17",
      { headers: { "x-dev-staff-id": ownerStaffId } });
    const days = (await diary.json()) as {
      venues: Array<{ events: Array<{ title: string; startsAt: string }> }>;
    };
    const mine = days.venues.flatMap((v) => v.events).find((e) => e.title.startsWith(TAG));
    expect(mine?.startsAt, "the diary agrees with the function's own screen").toBe("2029-03-17T19:00");
  });

  it("takes a time that carries its own offset as the moment it names", async () => {
    /* A machine - a channel manager, another system - says exactly which
       moment. That is not a clerk's local time and must not be re-read. */
    const made = await post("/5EL/banquet/events", {
      venueId, title: `${TAG} Machine`, hostName: "A machine",
      startsAt: "2029-03-18T19:00+00:00", endsAt: "2029-03-18T21:00+00:00",
    });
    expect(made.status, await made.clone().text()).toBe(200);
    const id = ((await made.json()) as { id: string }).id;

    await inUtc<{ same: boolean }>(async (q) => {
      const { rows } = await q(
        `select starts_at = timestamptz '2029-03-18 19:00+00' as same
           from banquet_events where id = $1`, [id]);
      expect(rows[0]!.same).toBe(true);
    });

    /* And it is shown on the property's clock: 19:00 GMT is half past
       midnight in Akkalkot, the next day. */
    const one = await app.request(`/api/hotels/5EL/banquet/events/${id}`,
      { headers: { "x-dev-staff-id": ownerStaffId } });
    expect(((await one.json()) as { startsAt: string }).startsAt).toBe("2029-03-19T00:30");
  });
});
