import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../src/server.ts";
import { closePool } from "../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE BANQUET HALL

   Two things are worth an API test here rather than only a database
   one, because they are the two places the interface could disagree
   with the server:

   THE MODULE GATE. 041 says hiding a screen is not disabling it. So
   the routes must refuse while `banquet` is off at a property, and
   that refusal has to survive somebody typing the URL.

   THE REFUSAL TEXT. app.confirm_banquet_event names the function
   standing in the way, and the route must pass that sentence through
   rather than replacing it with "unavailable". A GM on the telephone
   can act on "the Sharma sangeet, until 23:00"; they cannot act on
   "conflict".

   TEARDOWN. This file creates a hall, functions, catering and a folio
   at a REAL property, and removes every one of them. Defects 114-116:
   four test files were leaking into the shared demo, and the two that
   leaked most were the ones with a partial teardown.
   ══════════════════════════════════════════════════════════════════ */

let ownerStaffId: string;
let hotelId: string;

/* WHAT WAS ALREADY HERE. Recorded before the first assertion so the
   teardown can remove only what this file made.

   The first version of this teardown deleted banquet rows BY HOTEL,
   and it did exactly what that says: it removed a real booking
   somebody had entered while the suite ran. Cleaning up after
   yourself and clearing the table are not the same act, and the
   difference only shows when somebody else is using the database. */
let venuesBefore: string[] = [];
let eventsBefore: string[] = [];
let packagesBefore: string[] = [];
let moduleBefore: boolean | null = null;   // null = no row at all

/* A NAME NOTHING REAL WILL COLLIDE WITH. The first version called its
   hall "Emerald Hall", which is exactly what somebody would call a real
   one — and the moment a real Emerald Hall existed this file failed on
   the unique constraint, for a reason that had nothing to do with what
   it was testing. The pid makes two runs on one database safe too. */
const TAG = `fixture-${process.pid}`;
const HALL = `Hall ${TAG}`;
const SANGEET = `Sangeet ${TAG}`;
const RECEPTION = `Reception ${TAG}`;

const admin = async () =>
  new (await import("pg")).default.Pool({
    connectionString:
      process.env["SUPER_DATABASE_URL"] ??
      "postgres://postgres:pw@127.0.0.1:55432/fidato",
  });

beforeAll(async () => {
  const db = await admin();
  const staff = await db.query<{ id: string }>(
    "select id from staff where email = 'owner@fidato.in'",
  );
  ownerStaffId = staff.rows[0]!.id;
  const hotel = await db.query<{ id: string }>(
    "select id from hotels where code = '5EL'",
  );
  hotelId = hotel.rows[0]!.id;

  const ids = async (sql: string) =>
    (await db.query<{ id: string }>(sql, [hotelId])).rows.map((r) => r.id);
  venuesBefore = await ids("select id::text from banquet_venues where hotel_id = $1");
  eventsBefore = await ids("select id::text from banquet_events where hotel_id = $1");
  packagesBefore = await ids("select id::text from banquet_packages where hotel_id = $1");

  const mod = await db.query<{ is_enabled: boolean }>(
    "select is_enabled from hotel_modules where hotel_id = $1 and module = 'banquet'",
    [hotelId]);
  moduleBefore = mod.rows[0]?.is_enabled ?? null;

  await db.end();
});

afterAll(async () => {
  const db = await admin();
  try {
    /* `<> all($2)` — everything this file made, and nothing that was
       already here. Ordered the way a migration runs backwards:
       catering and folios name the event, the event names the venue.
       Defect 115. */
    await db.query(
      `delete from banquet_event_packages where event_id in
         (select id from banquet_events
           where hotel_id = $1 and id <> all($2::uuid[]))`,
      [hotelId, eventsBefore]);
    await db.query(
      `delete from folios where event_id in
         (select id from banquet_events
           where hotel_id = $1 and id <> all($2::uuid[]))`,
      [hotelId, eventsBefore]);
    await db.query(
      "delete from banquet_events where hotel_id = $1 and id <> all($2::uuid[])",
      [hotelId, eventsBefore]);
    await db.query(
      "delete from banquet_packages where hotel_id = $1 and id <> all($2::uuid[])",
      [hotelId, packagesBefore]);
    await db.query(
      "delete from banquet_venues where hotel_id = $1 and id <> all($2::uuid[])",
      [hotelId, venuesBefore]);

    /* The module goes back to whatever it was, which is NOT the same as
       "off". A property that had banquet switched on before this file
       ran must still have it switched on afterwards. */
    if (moduleBefore === null) {
      await db.query(
        "delete from hotel_modules where hotel_id = $1 and module = 'banquet'",
        [hotelId]);
    } else {
      await db.query(
        `insert into hotel_modules (hotel_id, module, is_enabled)
         values ($1,'banquet',$2)
         on conflict (hotel_id, module) do update set is_enabled = excluded.is_enabled`,
        [hotelId, moduleBefore]);
    }
  } finally {
    await db.end();
  }
  await closePool();
});

const as = (path: string, init?: RequestInit) =>
  app.request(`/api/hotels${path}`, {
    ...init,
    headers: {
      "x-dev-staff-id": ownerStaffId,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

const post = (path: string, body?: unknown) =>
  as(path, {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const enableBanquet = async (on: boolean) => {
  const db = await admin();
  await db.query(
    `insert into hotel_modules (hotel_id, module, is_enabled)
     values ($1,'banquet',$2)
     on conflict (hotel_id, module) do update set is_enabled = excluded.is_enabled`,
    [hotelId, on]);
  await db.end();
};

/* Across EVERY hall, not `venues[0]`. Indexing the first venue assumed
   this property had exactly one, which is true of a fresh demo and of
   nothing else. */
const findEvent = async (title: string) => {
  const list = await as("/5EL/banquet?from=2026-11-01&to=2026-11-30");
  const l = await list.json() as {
    venues: Array<{ events: Array<{ id: string; title: string }> }>;
  };
  const hit = l.venues.flatMap((v) => v.events).find((e) => e.title === title);
  if (!hit) throw new Error(`no function called ${title} in the diary`);
  return hit;
};

describe("the module gate", () => {
  it("refuses the routes while the property has no banquet hall", async () => {
    await enableBanquet(false);
    const res = await as("/5EL/banquet");
    expect(res.status).toBe(403);
    const body = await res.json() as { reason: string };
    /* Not a 404 and not a blank screen: it says what is wrong and where
       to change it. Rule 6. */
    expect(body.reason).toMatch(/no banquet hall/i);
    expect(body.reason).toMatch(/settings/i);
  });

  it("answers once somebody turns it on", async () => {
    await enableBanquet(true);
    const res = await as("/5EL/banquet");
    expect(res.status).toBe(200);
  });
});

describe("the halls", () => {
  it("adds one with no price", async () => {
    const before = await as("/5EL/banquet/setup");
    const b = await before.json() as { venues: unknown[] };

    const res = await post("/5EL/banquet/venues", {
      name: HALL, seated: 250, floating: 400,
    });
    expect(res.status).toBe(200);

    const after = await as("/5EL/banquet/setup");
    const a = await after.json() as {
      venues: Array<{ name: string; defaultRate: number | null; seated: number }>;
    };
    /* RELATIVE to what was already here. Asserting "exactly one hall"
       passed only on a property nobody had touched, and made this file
       fail the moment somebody entered a real hall. */
    expect(a.venues).toHaveLength(b.venues.length + 1);

    const mine = a.venues.find((v) => v.name === HALL)!;
    expect(mine.seated).toBe(250);
    /* NULL, not 0. An unpriced hall is not a free hall, and seven
       assertions elsewhere exist to keep it that way. */
    expect(mine.defaultRate).toBeNull();
  });

  it("refuses a second hall with the same name", async () => {
    const res = await post("/5EL/banquet/venues", { name: HALL });
    expect(res.status).toBe(409);
    const body = await res.json() as { reason: string };
    expect(body.reason).toMatch(/already a hall/i);
  });
});

describe("registering a function", () => {
  let venueId: string;
  let eventId: string;

  it("needs to know until when", async () => {
    const setup = await as("/5EL/banquet/setup");
    const s = await setup.json() as { venues: Array<{ id: string; name: string }> };
    /* This file's own hall, found by name. `venues[0]` was whichever
       hall sorted first, which is not necessarily one this test made. */
    venueId = s.venues.find((v) => v.name === HALL)!.id;

    const res = await post("/5EL/banquet/events", {
      venueId, title: SANGEET, hostName: "Mr Sharma",
      startsAt: "2026-11-14T18:00",
    });
    expect(res.status).toBe(409);
    const body = await res.json() as { reason: string };
    /* The whole module exists because this question was not being
       asked, so the refusal explains rather than just rejecting. */
    expect(body.reason).toMatch(/until when/i);
    expect(body.reason).toMatch(/nobody else can be sold/i);
  });

  it("lands as an enquiry, unpriced", async () => {
    const res = await post("/5EL/banquet/events", {
      venueId, title: SANGEET, hostName: "Mr Sharma", pax: 220,
      startsAt: "2026-11-14T18:00", endsAt: "2026-11-14T23:00",
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; reference: string };
    eventId = body.id;
    expect(body.reference).toMatch(/^BQ-\d{4}-\d{4}$/);

    const one = await as(`/5EL/banquet/events/${eventId}`);
    const e = await one.json() as {
      status: string; agreedAmount: number | null;
      money: { total: number | null; unpriced: string | null };
      registeredBy: string;
    };
    expect(e.status).toBe("enquiry");
    expect(e.agreedAmount).toBeNull();
    /* Unpriced makes the total NULL and says so. A screen showing 0
       here would be quoting a wedding as free. */
    expect(e.money.total).toBeNull();
    expect(e.money.unpriced).toMatch(/the hall/i);
    /* Somebody registered it — the point of the whole module. */
    expect(e.registeredBy).toBeTruthy();
  });

  it("does not hold the hall until it is confirmed", async () => {
    const res = await post("/5EL/banquet/events", {
      venueId, title: RECEPTION, hostName: "Mrs Verma",
      startsAt: "2026-11-14T19:00", endsAt: "2026-11-14T23:30",
    });
    /* Two families asking about one Saturday is normal business.
       Refusing the second loses a booking that was never made. */
    expect(res.status).toBe(200);
  });

  it("takes the hall on confirmation, and opens a folio", async () => {
    const res = await post(`/5EL/banquet/events/${eventId}/confirm`);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; folioId: string };
    expect(body.ok).toBe(true);
    expect(body.folioId).toBeTruthy();

    const one = await as(`/5EL/banquet/events/${eventId}`);
    const e = await one.json() as { status: string; folioId: string | null };
    expect(e.status).toBe("confirmed");
    /* A folio that bills an event rather than a stay. 060 had to widen
       folios_belongs_to_one for this — before that the CHECK refused it
       and named neither events nor the reason. */
    expect(e.folioId).toBe(body.folioId);
  });

  it("will not sell the same hall twice, and NAMES what is in it", async () => {
    const verma = await findEvent(RECEPTION);

    const res = await post(`/5EL/banquet/events/${verma.id}/confirm`);
    expect(res.status).toBe(409);
    const body = await res.json() as { reason: string };
    expect(body.reason).toContain(SANGEET);
    expect(body.reason).toMatch(/BQ-/);
    /* "unavailable" would be true and useless. A GM holding a telephone
       needs to know which function to move. */
    expect(body.reason).not.toMatch(/exclusion constraint/);
  });
});

describe("the money", () => {
  let eventId: string;

  beforeAll(async () => {
    eventId = (await findEvent(SANGEET)).id;
  });

  it("takes a price nobody defaulted", async () => {
    const res = await as(`/5EL/banquet/events/${eventId}`, {
      method: "PATCH", body: JSON.stringify({ agreedAmount: 60000 }),
    });
    expect(res.status).toBe(200);

    const one = await as(`/5EL/banquet/events/${eventId}`);
    const e = await one.json() as {
      money: { venue: number | null; total: number | null; unpriced: string | null };
    };
    /* No catering is a complete booking: a hall let for a meeting feeds
       nobody, and the total is simply the hall. */
    expect(e.money.venue).toBe(60000);
    expect(e.money.total).toBe(60000);
    expect(e.money.unpriced).toBeNull();
  });

  it("goes NULL again when a course has no price, and says which", async () => {
    const res = await post(`/5EL/banquet/events/${eventId}/catering`, {
      name: "Dinner buffet", pax: 200,
    });
    expect(res.status).toBe(200);

    const one = await as(`/5EL/banquet/events/${eventId}`);
    const e = await one.json() as {
      money: { total: number | null; unpriced: string | null };
      catering: Array<{ name: string; ratePerHead: number | null }>;
    };
    expect(e.catering[0]!.ratePerHead).toBeNull();
    /* Quoting 60,000 while two hundred plates are unpriced is the worst
       available answer — it looks finished and is short by the food. */
    expect(e.money.total).toBeNull();
    expect(e.money.unpriced).toMatch(/Dinner buffet/);
  });

  it("adds up once the food is priced", async () => {
    const one = await as(`/5EL/banquet/events/${eventId}`);
    const e = await one.json() as { catering: Array<{ id: string }> };

    const db = await admin();
    await db.query(
      "update banquet_event_packages set rate_per_head = 850 where id = $1",
      [e.catering[0]!.id]);
    await db.end();

    const after = await as(`/5EL/banquet/events/${eventId}`);
    const a = await after.json() as {
      money: { food: number | null; total: number | null; unpriced: string | null };
    };
    expect(a.money.food).toBe(170000);
    expect(a.money.total).toBe(230000);
    expect(a.money.unpriced).toBeNull();
  });

  it("refuses a course for nobody", async () => {
    const res = await post(`/5EL/banquet/events/${eventId}/catering`, {
      name: "Tea", pax: 0,
    });
    expect(res.status).toBe(409);
    const body = await res.json() as { reason: string };
    expect(body.reason).toMatch(/head count is not a price/i);
  });
});

describe("cancelling", () => {
  it("has to say why, and then gives the hall back", async () => {
    const sharma = await findEvent(SANGEET);
    const verma = await findEvent(RECEPTION);

    const bare = await post(`/5EL/banquet/events/${sharma.id}/cancel`, {});
    expect(bare.status).toBe(409);
    const b = await bare.json() as { reason: string };
    expect(b.reason).toMatch(/why/i);

    const done = await post(`/5EL/banquet/events/${sharma.id}/cancel`, {
      reason: "family postponed",
    });
    expect(done.status).toBe(200);

    /* The hall is free, so the function that could not be confirmed
       before now can be. */
    const now = await post(`/5EL/banquet/events/${verma.id}/confirm`);
    expect(now.status).toBe(200);
  });
});
