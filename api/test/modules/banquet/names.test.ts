import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   BQ-7 · A FUNCTION NOBODY ELSE COULD OPEN

   `staff` is row-secured (027): a GM reads the colleagues rostered at
   their hotel but not the owner, who is rostered nowhere; a clerk reads
   only their own row. The function screen joined `staff` for "Registered
   by", so for them the join found no row and the WHOLE FUNCTION came
   back as "No such function". Courses a colleague added vanished the
   same way while the total went on counting them.

   Measured on 17 September before the fix: signed in as the GM, the
   staff rows readable were agra, desk and gm — not the owner.

   The owner's answer the same day: fix it and keep the names. So these
   tests are run AS THE ROLES THE SCREEN IS FOR, never as the owner, who
   sees every row and proves nothing (root MEMORY.md 283).
   ══════════════════════════════════════════════════════════════════ */

let ownerId: string;
let ownerName: string;
let hotelId: string;
let gmId: string;
let clerkId: string;
let venuesBefore: string[] = [];
let eventsBefore: string[] = [];
let moduleBefore: boolean | null = null;
let eventId: string;

const TAG = `names-${process.pid}`;

const admin = async () =>
  new (await import("pg")).default.Pool({
    connectionString:
      process.env["SUPER_DATABASE_URL"] ??
      "postgres://postgres:pw@127.0.0.1:55432/fidato",
  });

const as = (who: string, path: string, init?: RequestInit) =>
  app.request(`/api/hotels${path}`, {
    ...init,
    headers: { "x-dev-staff-id": who, "content-type": "application/json" },
  });

beforeAll(async () => {
  const db = await admin();
  try {
    const owner = (await db.query<{ id: string; full_name: string }>(
      "select id::text, full_name from staff where email = 'owner@fidato.in'")).rows[0]!;
    ownerId = owner.id;
    ownerName = owner.full_name;
    hotelId = (await db.query<{ id: string }>(
      "select id from hotels where code = '5EL'")).rows[0]!.id;

    const ids = async (sql: string) =>
      (await db.query<{ id: string }>(sql, [hotelId])).rows.map((r) => r.id);
    venuesBefore = await ids("select id::text from banquet_venues where hotel_id = $1");
    eventsBefore = await ids("select id::text from banquet_events where hotel_id = $1");
    moduleBefore = (await db.query<{ is_enabled: boolean }>(
      "select is_enabled from hotel_modules where hotel_id = $1 and module = 'banquet'",
      [hotelId])).rows[0]?.is_enabled ?? null;

    await db.query(
      `insert into hotel_modules (hotel_id, module, is_enabled) values ($1,'banquet',true)
       on conflict (hotel_id, module) do update set is_enabled = true`, [hotelId]);

    const mk = async (email: string, name: string, role: string) => {
      const { rows } = await db.query<{ id: string }>(
        `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
         on conflict (email) do update set is_active = true, full_name = excluded.full_name
         returning id::text`,
        [email, name, `test-uid-${email.replace(/\W/g, "")}`]);
      await db.query(
        `insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)
         on conflict (staff_id, hotel_id) do update set role = excluded.role`,
        [rows[0]!.id, hotelId, role]);
      return rows[0]!.id;
    };
    gmId = await mk("bq7-gm@fidato.in", "BQ7 Manager", "gm");
    clerkId = await mk("bq7-desk@fidato.in", "BQ7 Reception", "front_desk");
  } finally {
    await db.end();
  }

  /* The OWNER registers the function and adds its course. */
  const post = (path: string, body: unknown) =>
    as(ownerId, path, { method: "POST", body: JSON.stringify(body) });
  expect((await post("/5EL/banquet/venues", { name: `Hall ${TAG}` })).status).toBe(200);
  const setup = await (await as(ownerId, "/5EL/banquet/setup")).json() as {
    venues: Array<{ id: string; name: string }>;
  };
  const venueId = setup.venues.find((v) => v.name === `Hall ${TAG}`)!.id;
  const res = await post("/5EL/banquet/events", {
    venueId, title: `Reception ${TAG}`, hostName: "Mrs Verma", agreedAmount: 50000,
    startsAt: "2026-12-05T18:00", endsAt: "2026-12-05T23:00",
  });
  expect(res.status).toBe(200);
  eventId = ((await res.json()) as { id: string }).id;
  expect((await post(`/5EL/banquet/events/${eventId}/catering`,
    { name: "Dinner", pax: 100, ratePerHead: 700 })).status).toBe(200);
});

afterAll(async () => {
  const db = await admin();
  try {
    const mine = "select id from banquet_events where hotel_id = $1 and id <> all($2::uuid[])";
    await db.query(`delete from banquet_event_packages where event_id in (${mine})`,
      [hotelId, eventsBefore]);
    await db.query(`delete from folios where event_id in (${mine})`, [hotelId, eventsBefore]);
    await db.query("delete from banquet_events where hotel_id = $1 and id <> all($2::uuid[])",
      [hotelId, eventsBefore]);
    await db.query("delete from banquet_venues where hotel_id = $1 and id <> all($2::uuid[])",
      [hotelId, venuesBefore]);
    if (moduleBefore === null) {
      await db.query("delete from hotel_modules where hotel_id = $1 and module = 'banquet'",
        [hotelId]);
    } else {
      await db.query(
        "update hotel_modules set is_enabled = $2 where hotel_id = $1 and module = 'banquet'",
        [hotelId, moduleBefore]);
    }
    await db.query("delete from staff_hotels where staff_id = any($1)", [[gmId, clerkId]]);
    await db.query("update staff set is_active = false where id = any($1)", [[gmId, clerkId]]);
  } finally {
    await db.end();
  }
  await closePool();
});

type Fn = {
  title: string; registeredBy: string | null;
  catering: Array<{ name: string; addedBy: string | null }>;
  money: { total: number | null };
};

describe("a function the owner registered", () => {
  for (const [role, id] of [["the GM", () => gmId], ["a reception clerk", () => clerkId]] as const) {
    it(`opens for ${role}, with every course and the owner's name`, async () => {
      const res = await as(id(), `/5EL/banquet/events/${eventId}`);
      expect(res.status).toBe(200);
      const e = await res.json() as Fn;
      expect(e.title).toBe(`Reception ${TAG}`);
      /* The course is listed, and agrees with the total that counts it. */
      expect(e.catering.map((c) => c.name)).toEqual(["Dinner"]);
      expect(e.money.total).toBe(120000);   // the hall 50,000 + 100 plates at 700
      /* The names stay (the owner's answer): the owner is a colleague of
         everybody rostered at the property. */
      expect(e.registeredBy).toBe(ownerName);
      expect(e.catering[0]!.addedBy).toBe(ownerName);
    });
  }

  it("names who registered it on the GM's diary", async () => {
    const res = await as(gmId, "/5EL/banquet?from=2026-12-01&to=2026-12-31");
    expect(res.status).toBe(200);
    const d = await res.json() as {
      venues: Array<{ events: Array<{ id: string; registeredBy: string | null }> }>;
    };
    const mine = d.venues.flatMap((v) => v.events).find((e) => e.id === eventId);
    expect(mine?.registeredBy).toBe(ownerName);
  });
});
