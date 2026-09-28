import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool, pool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   POST /:code/bookings — THE DOOR A CHANNEL MANAGER WILL KNOCK ON

   RES-3 · A BOOKING SENT TWICE IS ONE BOOKING. A machine whose request
   timed out sends it again; that is what machines do. Before 091 each
   copy made another guest, group, set of confirmed bookings holding
   inventory, and set of open folios — none of which can be deleted.
   The sender's own reference (`externalRef`) is the key: the same one
   from the same channel is answered with the first booking; the same
   one with different details is a changed booking, and is refused.

   RES-1 · A REFUSED BOOKING LEAVES NOTHING BEHIND. The route wrote the
   guest and the group, then could refuse — and a booking of two room
   types had the first type's rooms confirmed before the second was
   turned down. These tests were run against that code on 16 September
   and failed: each refusal left a guest, and three left two bookings.

   RES-2 · ONE REFERENCE, FROM ONE PLACE. The door asks app.next_reference
   (092) inside its own transaction: FH-<hotel code>-<YYMM>-<number>.

   Every test here counts what is IN THE DATABASE afterwards, not only
   what the route said. A door that answers "duplicate" while writing a
   second booking behind the answer is the defect with better manners.
   ══════════════════════════════════════════════════════════════════ */

let ownerStaffId: string;
let typeId: string;
let agoda: string;
let otherSource: string;

const admin = async () =>
  new (await import("pg")).default.Pool({
    connectionString:
      process.env["SUPER_DATABASE_URL"] ??
      "postgres://postgres:pw@127.0.0.1:55432/fidato",
  });

beforeAll(async () => {
  const db = await admin();
  try {
    const { rows: staff } = await db.query<{ id: string }>(
      "select id::text from staff where email = 'owner@fidato.in'");
    ownerStaffId = staff[0]!.id;

    /* The type the booking tests in guards.test.ts price for two adults
       from the demo's own tariff — no rate is invented here. */
    const { rows: types } = await db.query<{ id: string }>(
      `select rt.id::text from room_types rt join hotels h on h.id = rt.hotel_id
        where h.code = '5EL' and rt.max_occupancy > rt.base_occupancy
        order by rt.sort_order limit 1`);
    typeId = types[0]!.id;

    /* Seeded by 082. Two real channels, because "unique per channel" is
       only proved by a second channel. */
    const { rows: sources } = await db.query<{ id: string; name: string }>(
      `select id::text, name from booking_sources
        where is_active and kind = 'ota' order by name`);
    agoda = sources.find((s) => s.name === "Agoda")!.id;
    otherSource = sources.find((s) => s.name !== "Agoda")!.id;
  } finally { await db.end(); }
});

afterAll(async () => {
  const db = await admin();
  try {
    /* A teardown is a migration run backwards: folios point at the
       reservations, reservations at the groups and the guests. */
    const { rows } = await db.query<{ id: string; group_id: string | null; guest_id: string }>(
      `select r.id::text, r.group_id::text, r.guest_id::text
         from reservations r join guests g on g.id = r.guest_id
        where g.full_name like 'RES3 %' or g.full_name like 'RES1 %'
           or g.full_name like 'RES2 %'`);
    const ids = rows.map((r) => r.id);
    await db.query("delete from folios where reservation_id = any($1::uuid[])", [ids]);
    await db.query("delete from reservations where id = any($1::uuid[])", [ids]);
    /* By id AND by name: a refusal the old code committed left a group
       with no rooms in it, which no reservation leads back to. The
       default name starts with the guest's. */
    await db.query(
      `delete from reservation_groups
        where id = any($1::uuid[]) or name like 'RES3 %' or name like 'RES1 %'
           or name like 'RES2 %'`,
      [rows.map((r) => r.group_id).filter(Boolean)]);
    await db.query("alter table guests disable trigger guests_no_delete");
    try {
      await db.query(
        "delete from guests where full_name like 'RES3 %' or full_name like 'RES1 %' "
        + "or full_name like 'RES2 %'");
    } finally {
      await db.query("alter table guests enable trigger guests_no_delete");
    }
  } finally { await db.end(); }
  await closePool();
});

const post = async (body: unknown): Promise<Response> =>
  app.request("/api/hotels/5EL/bookings", {
    method: "POST",
    headers: { "x-dev-staff-id": ownerStaffId, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

type Made = {
  ok: true; duplicate?: true; groupId: string | null; rooms: number;
  guest: string; bookings: { reference: string; roomType: string; rate: number }[];
  nightly: number;
};

/* A wedding: two rooms, one guest, from Agoda, with Agoda's number. */
const request = (guestName: string, externalRef: unknown, over: Record<string, unknown> = {}) => ({
  guestName, phone: "9800000000",
  checkIn: "2028-03-10", checkOut: "2028-03-12",
  bookingSourceId: agoda, externalRef,
  lines: [{ roomTypeId: typeId, mealPlan: "EP", adults: 2, children: 0, rooms: 2 }],
  ...over,
});

/* What exists for a guest name — the database's answer, not the route's. */
const onFile = async (guestName: string) => {
  const db = await admin();
  try {
    const { rows } = await db.query<{
      guests: string; reservations: string; groups: string; folios: string;
    }>(
      /* Groups counted by name as well as through their rooms: the group a
         refusal left behind has no rooms, so nothing else leads to it. No
         test here names its group, so each carries the route's default,
         "<guest> — <n> rooms". */
      `select (select count(*) from guests where full_name = $1)::text as guests,
              count(r.id)::text as reservations,
              (select count(*) from reservation_groups rg
                where rg.name like $1 || ' - %'
                   or rg.id in (select r3.group_id from reservations r3
                                  join guests g3 on g3.id = r3.guest_id
                                 where g3.full_name = $1))::text as groups,
              (select count(*) from folios f
                 join reservations r2 on r2.id = f.reservation_id
                 join guests g2 on g2.id = r2.guest_id
                where g2.full_name = $1)::text as folios
         from reservations r join guests g on g.id = r.guest_id
        where g.full_name = $1`,
      [guestName]);
    const r = rows[0]!;
    return {
      guests: Number(r.guests), reservations: Number(r.reservations),
      groups: Number(r.groups), folios: Number(r.folios),
    };
  } finally { await db.end(); }
};

/* TWO REQUESTS THAT GENUINELY OVERLAP. Fired with a bare Promise.all they
   did not: RES-3's race test passed with the race handling deleted — most
   likely the second was still opening its connection while the first
   booked. So `reservation_groups` is locked: both requests pass every
   check, write their guest, stop at the group insert (each must book more
   than one room to reach it), and are released together.

   Two connections are opened in the API's own pool first; otherwise the
   second request opens one while the first holds the other, which on a
   busy machine outlasted the pool's five seconds. */
const heldTogether = async (
  send: () => [Promise<Response>, Promise<Response>],
): Promise<[Response, Response]> => {
  const warm = await Promise.all([pool.connect(), pool.connect()]);
  for (const c of warm) c.release();

  const gate = new (await import("pg")).default.Client({
    connectionString: process.env["SUPER_DATABASE_URL"]
      ?? "postgres://postgres:pw@127.0.0.1:55432/fidato",
  });
  await gate.connect();
  let sent: [Promise<Response>, Promise<Response>] | null = null;
  let waiting = 0;
  try {
    await gate.query("begin");
    await gate.query("lock table reservation_groups in exclusive mode");
    sent = send();

    /* ⚠ THE SNAPSHOT IS CLEARED EVERY TIME. Inside a transaction,
       pg_stat_activity answers from a copy taken at its first read, so
       this loop once kept seeing the moment it started — 0, while both
       requests sat at the lock in plain view from any other connection. */
    const until = Date.now() + 30_000;
    while (waiting < 2 && Date.now() < until) {
      await gate.query("select pg_stat_clear_snapshot()");
      const { rows } = await gate.query<{ n: string }>(
        `select count(*)::text as n from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'
            and query ilike '%insert into reservation_groups%'`);
      waiting = Number(rows[0]!.n);
      if (waiting < 2) await new Promise((r) => setTimeout(r, 100));
    }
  } finally {
    /* Released whatever happened above. A lock left held keeps both
       requests waiting, and closePool waits for them — for ever. */
    await gate.query("commit").catch(() => undefined);
    await gate.end();
  }
  expect(waiting, "both requests should have been held at the group insert").toBe(2);
  return Promise.all(sent!);
};

describe("RES-3 · a booking sent twice is one booking", () => {
  it("answers the second copy with the first booking, and writes nothing more", async () => {
    const first = await post(request("RES3 Twice", "AGODA-1001"));
    expect(first.status, await first.clone().text()).toBe(200);
    const one = (await first.json()) as Made;
    expect(one.duplicate).toBeUndefined();
    expect(one.bookings).toHaveLength(2);

    const second = await post(request("RES3 Twice", "AGODA-1001"));
    expect(second.status, await second.clone().text()).toBe(200);
    const two = (await second.json()) as Made;

    /* The first answer, marked. */
    expect(two.duplicate).toBe(true);
    expect(two.bookings).toEqual(one.bookings);
    expect(two.groupId).toBe(one.groupId);
    expect(two.rooms).toBe(one.rooms);
    expect(two.guest).toBe(one.guest);
    expect(two.nightly).toBe(one.nightly);

    expect(await onFile("RES3 Twice")).toEqual(
      { guests: 1, reservations: 2, groups: 1, folios: 2 });
  });

  it("treats a default left out as the same booking it would have made", async () => {
    const first = await post(request("RES3 Defaults", "AGODA-1002"));
    expect(first.status, await first.clone().text()).toBe(200);

    /* No meal plan and no children: the route would book EP and 0, so it
       is the same booking, and a retry built by a different serialiser
       must not become a refusal. */
    const second = await post(request("RES3 Defaults", "AGODA-1002", {
      lines: [{ roomTypeId: typeId, adults: 2, rooms: 2 }],
    }));
    expect(second.status, await second.clone().text()).toBe(200);
    expect(((await second.json()) as Made).duplicate).toBe(true);
    expect((await onFile("RES3 Defaults")).reservations).toBe(2);
  });

  it("refuses the same reference with different details, by name, and writes nothing", async () => {
    const first = await post(request("RES3 Changed", "AGODA-1003"));
    expect(first.status, await first.clone().text()).toBe(200);
    const one = (await first.json()) as Made;

    const changed = await post(request("RES3 Changed", "AGODA-1003", {
      checkOut: "2028-03-14",
    }));
    expect(changed.status).toBe(409);
    const reason = ((await changed.json()) as { reason: string }).reason;
    expect(reason).toMatch(/already received/i);
    expect(reason).toMatch(/different details/i);
    /* It names the bookings that exist, so whoever reads it can open one. */
    for (const b of one.bookings) expect(reason).toContain(b.reference);

    expect(await onFile("RES3 Changed")).toEqual(
      { guests: 1, reservations: 2, groups: 1, folios: 2 });
  });

  it("keeps two channels' numbers apart: the same number from another channel is another booking", async () => {
    const fromAgoda = await post(request("RES3 Channels", "SAME-2001"));
    expect(fromAgoda.status, await fromAgoda.clone().text()).toBe(200);
    const a = (await fromAgoda.json()) as Made;

    const fromOther = await post(request("RES3 Channels", "SAME-2001", {
      bookingSourceId: otherSource,
    }));
    expect(fromOther.status, await fromOther.clone().text()).toBe(200);
    const b = (await fromOther.json()) as Made;

    expect(b.duplicate).toBeUndefined();
    expect(b.bookings.map((x) => x.reference))
      .not.toEqual(a.bookings.map((x) => x.reference));
    expect((await onFile("RES3 Channels")).reservations).toBe(4);
  });

  it("makes one booking when two copies arrive at the same moment", async () => {
    /* Both can pass the "already received?" read before either commits.
       The unique index on line 1 decides; the loser is answered as the
       repeat it is, not with a 500. Proved 16 September: with the race
       handling deleted, this test fails with the loser's 500. */
    const [x, y] = await heldTogether(() => [
      post(request("RES3 Race", "AGODA-3001")),
      post(request("RES3 Race", "AGODA-3001")),
    ]);
    expect(x.status, await x.clone().text()).toBe(200);
    expect(y.status, await y.clone().text()).toBe(200);
    const bx = (await x.json()) as Made;
    const by = (await y.json()) as Made;

    expect(bx.bookings).toEqual(by.bookings);
    expect([bx.duplicate, by.duplicate].filter((d) => d === true)).toHaveLength(1);
    expect(await onFile("RES3 Race")).toEqual(
      { guests: 1, reservations: 2, groups: 1, folios: 2 });
  }, 90_000);

  it("still answers a retry after the channel has been switched off", async () => {
    const first = await post(request("RES3 Switched off", "AGODA-4001"));
    expect(first.status, await first.clone().text()).toBe(200);
    const one = (await first.json()) as Made;

    const db = await admin();
    try {
      await db.query("update booking_sources set is_active = false where id = $1", [agoda]);
      const retry = await post(request("RES3 Switched off", "AGODA-4001"));
      /* The booking exists. "That source is not on the list any more"
         would tell the sender it failed, and it would try again. */
      expect(retry.status, await retry.clone().text()).toBe(200);
      const two = (await retry.json()) as Made;
      expect(two.duplicate).toBe(true);
      expect(two.bookings).toEqual(one.bookings);
    } finally {
      await db.query("update booking_sources set is_active = true where id = $1", [agoda]);
      await db.end();
    }
    expect((await onFile("RES3 Switched off")).reservations).toBe(2);
  });

  it("refuses a reference that is not text, before anything is written", async () => {
    for (const externalRef of [12345, "   ", "x".repeat(101)]) {
      const res = await post(request("RES3 Bad reference", externalRef));
      expect(res.status, JSON.stringify(externalRef)).toBe(409);
      expect(((await res.json()) as { reason: string }).reason).toMatch(/externalRef/);
    }
    expect(await onFile("RES3 Bad reference")).toEqual(
      { guests: 0, reservations: 0, groups: 0, folios: 0 });
  });

  it("leaves the desk as it was: no reference, no key, no duplicate", async () => {
    const res = await post(request("RES3 Desk", undefined));
    expect(res.status, await res.clone().text()).toBe(200);
    const made = (await res.json()) as Made;
    expect(made.duplicate).toBeUndefined();

    const db = await admin();
    try {
      const { rows } = await db.query<{ keyed: string }>(
        `select count(*) filter (where ota_reference is not null or ota_line is not null
                                   or ota_fingerprint is not null)::text as keyed
           from reservations where reference = any($1)`,
        [made.bookings.map((b) => b.reference)]);
      expect(rows[0]!.keyed).toBe("0");
    } finally { await db.end(); }
  });
});

describe("RES-1 · a refused booking leaves nothing behind", () => {
  /* ⚠ INSIDE `withSession` A REFUSAL IS A COMMIT (root MEMORY 243). The
     route used to write the guest, then the group, then each line's rooms
     and folios — and only then could it refuse: a channel switched off, a
     room type that is not here, a party the room cannot sleep, a line with
     no price. The caller saw `ok:false` and retried, and every retry left
     another guest (which can never be deleted, 015), another group, and
     the earlier lines' rooms confirmed and holding inventory.

     Each booking here is refused on its SECOND line, so the old code would
     already have written the first line's two rooms. Each test counts the
     database afterwards: nothing, not merely "refused". The walk-in desk
     had the same fault and was fixed the same way; its test is the shape. */

  let base: number;
  let max: number;
  let savedExtraAdult: string | null;

  beforeAll(async () => {
    const db = await admin();
    try {
      const { rows } = await db.query<{
        base: number; max: number; extra: string | null;
      }>(
        `select base_occupancy as base, max_occupancy as max,
                extra_adult_rate::text as extra
           from room_types where id = $1`, [typeId]);
      base = rows[0]!.base;
      max = rows[0]!.max;
      savedExtraAdult = rows[0]!.extra;
      /* One person more than the rate covers, with no extra-adult rate:
         the tariff answers NULL and names what is missing. Put back
         afterwards — this is the demo's own room type. */
      await db.query(
        "update room_types set extra_adult_rate = null where id = $1", [typeId]);
    } finally { await db.end(); }
  });

  afterAll(async () => {
    const db = await admin();
    try {
      await db.query(
        "update room_types set extra_adult_rate = $2::numeric where id = $1",
        [typeId, savedExtraAdult]);
    } finally { await db.end(); }
  });

  const nothing = { guests: 0, reservations: 0, groups: 0, folios: 0 };

  /* Two rooms that would be booked, then the line that is refused. */
  const refusedOnLineTwo = (guestName: string, second: Record<string, unknown>,
                            over: Record<string, unknown> = {}) => ({
    guestName, checkIn: "2028-04-01", checkOut: "2028-04-03",
    bookingSourceId: agoda,
    lines: [{ roomTypeId: typeId, mealPlan: "EP", adults: base, rooms: 2 }, second],
    ...over,
  });

  it("⚠ a line with no price writes nothing - not the lines before it", async () => {
    const res = await post(refusedOnLineTwo("RES1 Unpriced",
      { roomTypeId: typeId, mealPlan: "EP", adults: base + 1, rooms: 1 }));
    expect(res.status, await res.clone().text()).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toMatch(/no price/i);
    expect(await onFile("RES1 Unpriced")).toEqual(nothing);
  });

  it("a room type that is not here writes nothing", async () => {
    const res = await post(refusedOnLineTwo("RES1 Wrong type",
      { roomTypeId: "00000000-0000-0000-0000-000000000000", adults: 1, rooms: 1 }));
    expect(res.status, await res.clone().text()).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toMatch(/not here/i);
    expect(await onFile("RES1 Wrong type")).toEqual(nothing);
  });

  it("a party the room cannot sleep writes nothing", async () => {
    const res = await post(refusedOnLineTwo("RES1 Too many",
      { roomTypeId: typeId, adults: max + 1, rooms: 1 }));
    expect(res.status, await res.clone().text()).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toMatch(/will not fit/i);
    expect(await onFile("RES1 Too many")).toEqual(nothing);
  });

  it("a channel switched off writes nothing - not even the guest", async () => {
    const db = await admin();
    try {
      await db.query("update booking_sources set is_active = false where id = $1", [otherSource]);
      const res = await post(refusedOnLineTwo("RES1 Channel off",
        { roomTypeId: typeId, mealPlan: "EP", adults: base, rooms: 1 },
        { bookingSourceId: otherSource }));
      expect(res.status, await res.clone().text()).toBe(409);
      expect(((await res.json()) as { reason: string }).reason).toMatch(/not on the list/i);
    } finally {
      await db.query("update booking_sources set is_active = true where id = $1", [otherSource]);
      await db.end();
    }
    expect(await onFile("RES1 Channel off")).toEqual(nothing);
  });

  it("and once the reason is put right, the same booking goes through whole", async () => {
    /* The refusal is a question, not an answer: nothing was kept, so the
       retry is a clean first booking — three rooms, one guest, one group. */
    const res = await post(refusedOnLineTwo("RES1 Put right",
      { roomTypeId: typeId, mealPlan: "EP", adults: base, rooms: 1 }));
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await onFile("RES1 Put right")).toEqual(
      { guests: 1, reservations: 3, groups: 1, folios: 3 });
  });
});

describe("RES-2 · one booking reference, from app.next_reference", () => {
  /* The owner's format, 16 September: FH-<hotel code>-<YYMM>-<number>,
     the month on the hotel's own clock. This door made its own until
     092: `'FH-' || to_char(now(),'DDMM')`, no lock, and lpad — so two
     bookings in the same moment built one reference and the second was
     a 500. 092's own file (api/test/bookingReference.test.ts) proves the
     function; these prove THIS DOOR uses it, inside its own transaction. */

  /* The month is the hotel's BUSINESS date since D27-123 (BK-12, migration
     153), not the clock's. */
  it("is FH, the hotel's code, the month of the business date, and a running number - every room", async () => {
    const db = await admin();
    let yymm: string;
    try {
      const { rows } = await db.query<{ yymm: string }>(
        `select to_char(app.business_date(id), 'YYMM') as yymm
           from hotels where code = '5EL'`);
      yymm = rows[0]!.yymm;
    } finally { await db.end(); }

    const res = await post({
      guestName: "RES2 Format", checkIn: "2028-05-01", checkOut: "2028-05-02",
      bookingSourceId: agoda,
      lines: [{ roomTypeId: typeId, mealPlan: "EP", adults: 2, rooms: 3 }],
    });
    expect(res.status, await res.clone().text()).toBe(200);
    const made = (await res.json()) as Made;

    const shape = new RegExp(String.raw`^FH-5EL-${yymm}-\d{4,}$`);
    for (const b of made.bookings) expect(b.reference).toMatch(shape);

    /* One transaction holds the hotel's lock from the first room to the
       last, so nobody's number lands in between. */
    const n = made.bookings.map((b) => Number(b.reference.match(/(\d+)$/)![1]));
    expect(n).toEqual([n[0], n[0]! + 1, n[0]! + 2]);
  });

  it("gives two different bookings made at the same moment two different references", async () => {
    /* Before 092 both read the same highest number and built the same
       reference; the second waited at the unique index and was a 500. */
    const booking = (guestName: string) => post({
      guestName, checkIn: "2028-05-10", checkOut: "2028-05-11",
      bookingSourceId: agoda,
      lines: [{ roomTypeId: typeId, mealPlan: "EP", adults: 2, rooms: 2 }],
    });
    const [a, b] = await heldTogether(() => [
      booking("RES2 Same moment A"), booking("RES2 Same moment B"),
    ]);
    expect(a.status, await a.clone().text()).toBe(200);
    expect(b.status, await b.clone().text()).toBe(200);

    const refs = [
      ...((await a.json()) as Made).bookings,
      ...((await b.json()) as Made).bookings,
    ].map((x) => x.reference);
    expect(new Set(refs).size, refs.join(", ")).toBe(4);

    expect((await onFile("RES2 Same moment A")).reservations).toBe(2);
    expect((await onFile("RES2 Same moment B")).reservations).toBe(2);
  }, 90_000);
});
