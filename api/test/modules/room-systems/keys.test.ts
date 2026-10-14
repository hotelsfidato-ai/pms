import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import { lockFor, standIn } from "../../../src/modules/room-systems/locks.ts";
import { MAX_CARDS } from "../../../src/modules/room-systems/keys.ts";

/* ══════════════════════════════════════════════════════════════════
   KEY CARDS (D27-178): cut for the room the stay holds, valid to its
   departure at the check-out time, every act recorded; cancelled by front
   desk's check-out, move and exchange; a lock that refuses never stops
   a check-out.

   At a property of the test's own (RSK) whose business date is today, so
   a card's validity is in the future, as at a real desk. The stand-in
   lock serves it; nothing here is a real lock.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const admin = async () =>
  new (await import("pg")).default.Pool({ connectionString: SUPER });

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = await admin();
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const CODE = "RSK";
let hotelId = "";
let today = "";
let tomorrow = "";
const saved = {
  driver: process.env["ROOM_SYSTEMS_DRIVER"], hotels: process.env["ROOM_SYSTEMS_HOTELS"],
};

const call = (path: string, method = "GET", body?: unknown) =>
  app.request(`/api/hotels/${CODE}${path}`, {
    method,
    headers: {
      "x-dev-staff-id": "dev-owner",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

type Act = { act: string; why: string; cards: number | null; room: string; outcome: string };
type Keys = {
  connected: boolean; live: { room: string; cards: number; validUntil: string } | null;
  acts: Act[];
};
const keysOf = async (stay: string) => {
  const res = await call(`/stays/${stay}/keys`);
  expect(res.status, await res.clone().text()).toBe(200);
  return await res.json() as Keys;
};
const cut = (stay: string, body: unknown) => call(`/stays/${stay}/keys`, "POST", body);
const reason = async (res: Response) => ((await res.json()) as { reason: string }).reason;

let n = 0;
/** A booking arriving today for `nights` (0 is a day use), checked in to
    `room` through the desk's own route. */
async function arrive(room: string, checkIn = true, nights = 2): Promise<string> {
  const [row] = await sql<{ id: string }>(
    `insert into reservations (hotel_id, reference, guest_id, room_type_id,
                               check_in, check_out, agreed_rate, status)
     values ($1, $2, (select id from guests where full_name = 'Key card guest' limit 1),
             (select id from room_types where hotel_id = $1 and code = 'STD'),
             $3::date, $3::date + $4::int, 2000, 'confirmed')
     returning id::text`, [hotelId, `${CODE}-${process.pid}-${++n}`, today, nights]);
  if (checkIn) {
    const res = await call(`/stays/${row!.id}/check-in`, "POST", {
      roomNumber: room, idSkipReason: "Key-card fixture - the ID is not what this tests" });
    expect(res.status, await res.clone().text()).toBe(200);
  }
  return row!.id;
}

/** Pays what the stay owes - its first night is charged at check-in
    (D27-204) - so the check-out is about the cards, not the money. */
async function settle(stay: string) {
  const [owed] = await sql<{ due: string }>(
    `select coalesce(sum(fp.amount + fp.tax_amount), 0)::text as due
       from folio_postings fp join folios f on f.id = fp.folio_id
      where f.reservation_id = $1 and fp.reverses_id is null
        and not exists (select 1 from folio_postings r where r.reverses_id = fp.id)`, [stay]);
  const due = Number(owed!.due);
  if (due <= 0) return;
  const res = await call(`/stays/${stay}/payments`, "POST", { method: "UPI", amount: due });
  expect(res.status, await res.clone().text()).toBe(200);
}

beforeAll(async () => {
  process.env["ROOM_SYSTEMS_DRIVER"] = "stand-in";
  process.env["ROOM_SYSTEMS_HOTELS"] = CODE;
  const db = await admin();
  try {
    const owner = (await db.query<{ id: string }>(
      "select id::text from staff where email = 'owner@fidato.in'")).rows[0]!.id;
    await db.query("select set_config('app.user_id', $1, false)", [owner]);
    hotelId = (await db.query<{ id: string }>(
      "select app.provision_property_unchecked($1,'Key Card Test','Nowhere')::text as id",
      [CODE])).rows[0]!.id;
    /* Today on the property's clock; open all day, so neither an early
       arrival nor a late departure is what a test meets. */
    const [d] = (await db.query<{ d: string; t: string }>(
      `update hotels set business_date = (now() at time zone timezone)::date,
                         check_in_time = '00:00', check_out_time = '23:59'
        where id = $1
        returning business_date::text as d, (business_date + 1)::text as t`, [hotelId])).rows;
    today = d!.d;
    tomorrow = d!.t;
    await db.query("select app.bulk_create_rooms($1,'STD',1::smallint,101,111)", [hotelId]);
    /* A room charge needs a GST rule (067), as at any real property. */
    await db.query(
      `insert into tax_rules (hotel_id, kind, over_amount, rate, note)
       values ($1, 'room', 0, 5, 'Test')`, [hotelId]);
    await db.query("insert into guests (full_name) values ('Key card guest')");
  } finally { await db.end(); }
});

afterAll(async () => {
  process.env["ROOM_SYSTEMS_DRIVER"] = saved.driver;
  process.env["ROOM_SYSTEMS_HOTELS"] = saved.hotels;
  const db = await admin();
  try {
    /* A payment points at its posting: it goes first (formIII.test's lesson). */
    await db.query("delete from payments where hotel_id = $1", [hotelId]);
    await db.query("alter table key_cards disable trigger key_cards_append_only");
    await db.query("alter table folio_postings disable trigger folio_postings_append_only");
    await db.query("alter table hotels disable trigger hotels_no_delete");
    await db.query("delete from hotels where id = $1", [hotelId]);
    await db.query("alter table hotels enable trigger hotels_no_delete");
    await db.query("alter table folio_postings enable trigger folio_postings_append_only");
    await db.query("alter table key_cards enable trigger key_cards_append_only");
  } finally { await db.end(); }
  await closePool();
});

describe("which lock serves a property", () => {
  it("only the properties named, and never the stand-in on the live server", () => {
    const on = { ROOM_SYSTEMS_DRIVER: "stand-in", ROOM_SYSTEMS_HOTELS: "5el, RSK" };
    expect(lockFor("5EL", on)?.name).toBe("stand-in");
    expect(lockFor("PUN", on)).toBeNull();
    expect(lockFor("5EL", { ...on, NODE_ENV: "production" })).toBeNull();
    expect(lockFor("5EL", { ...on, ROOM_SYSTEMS_DRIVER: "onity" })).toBeNull();
  });
});

describe("cutting cards", () => {
  let stay = "";
  beforeAll(async () => { stay = await arrive("101"); });

  it("cuts them for the room the stay holds, valid to its departure at the check-out time", async () => {
    /* A room in the body is not how a card is aimed: 104 is ignored. */
    const res = await cut(stay, { cards: 2, roomNumber: "104" });
    expect(res.status, await res.clone().text()).toBe(200);

    const k = await keysOf(stay);
    expect(k.live).toMatchObject({ room: "101", cards: 2 });
    const [ends] = await sql<{ at: Date }>(
      "select app.hotel_moment($1, ($2::date + 2)::text || ' 23:59') as at", [hotelId, today]);
    expect(new Date(k.live!.validUntil).getTime()).toBe(ends!.at.getTime());
    expect(k.acts[0]).toMatchObject({ act: "issue", why: "check_in", outcome: "done" });
  });

  it("records who cut them, whatever the request said", async () => {
    const [row] = await sql<{ email: string }>(
      `select s.email from key_cards k join staff s on s.id = k.by_staff
        where k.reservation_id = $1 order by k.id desc limit 1`, [stay]);
    expect(row!.email).toBe("owner@fidato.in");
  });

  it(`refuses 0 cards, more than ${MAX_CARDS}, and a guest not checked in`, async () => {
    expect(await reason(await cut(stay, { cards: 0 }))).toMatch(/Between 1 and/);
    expect(await reason(await cut(stay, { cards: MAX_CARDS + 1 }))).toMatch(/Between 1 and/);
    const waiting = await arrive("102", false);
    expect(await reason(await cut(waiting, { cards: 1 }))).toMatch(/checked in/);
    expect((await keysOf(waiting)).acts).toHaveLength(0);
  });

  it("answers a stay id that is not one with 404, not a 500 (RS-2)", async () => {
    expect((await call("/stays/not-a-stay/keys")).status).toBe(404);
    expect((await cut("not-a-stay", { cards: 1 })).status).toBe(404);
  });

  it("refuses a day use in words: the property has no time a day use ends", async () => {
    const day = await arrive("111", true, 0);
    const res = await cut(day, { cards: 1 });
    expect(res.status).toBe(409);
    expect(await reason(res)).toMatch(/day use/);
    expect((await keysOf(day)).acts).toHaveLength(0);
  });

  it("refuses, and records nothing, where no lock system is connected", async () => {
    process.env["ROOM_SYSTEMS_HOTELS"] = "";
    try {
      const before = (await keysOf(stay)).acts.length;
      const res = await cut(stay, { cards: 1 });
      expect(res.status).toBe(409);
      expect(await reason(res)).toMatch(/No lock system/);
      const k = await keysOf(stay);
      expect(k.connected).toBe(false);
      expect(k.acts).toHaveLength(before);
    } finally { process.env["ROOM_SYSTEMS_HOTELS"] = CODE; }
  });

  it("makes a lost card a cancel and a new issue, and the new cards the live ones", async () => {
    const res = await cut(stay, { cards: 1, lost: true });
    expect(res.status, await res.clone().text()).toBe(200);
    const k = await keysOf(stay);
    expect(k.acts.slice(0, 2)).toMatchObject([
      { act: "issue", why: "lost", cards: 1, outcome: "done" },
      { act: "cancel", why: "lost", outcome: "done" },
    ]);
    expect(k.live).toMatchObject({ room: "101", cards: 1 });
  });

  it("records a lock's refusal, and the cards live before stay live", async () => {
    standIn.failNext = true;
    const res = await cut(stay, { cards: 3 });
    expect(res.status).toBe(409);
    expect(await reason(res)).toMatch(/lock system said/);
    const k = await keysOf(stay);
    expect(k.acts[0]).toMatchObject({ act: "issue", why: "reissue", outcome: "failed" });
    expect(k.live).toMatchObject({ cards: 1 });
  });
});

describe("front desk's calls: check-out, move and exchange", () => {
  /* The check-outs book ONE night: its first night is charged at check-in
     (D27-204), so leaving today frees no night and the desk does not ask
     why the guest leaves early (D27-315 A) - the check-out is about the
     cards, not the dates. */
  it("check-out cancels the cards", async () => {
    const stay = await arrive("103", true, 1);
    expect((await cut(stay, { cards: 1 })).status).toBe(200);
    await settle(stay);
    const res = await call(`/stays/${stay}/check-out`, "POST", {});
    expect(res.status, await res.clone().text()).toBe(200);
    const k = await keysOf(stay);
    expect(k.acts[0]).toMatchObject({ act: "cancel", why: "check_out", room: "103", outcome: "done" });
    expect(k.live).toBeNull();
  });

  it("a lock that refuses at check-out is recorded, and the guest still checks out", async () => {
    const stay = await arrive("104", true, 1);
    expect((await cut(stay, { cards: 1 })).status).toBe(200);
    await settle(stay);
    standIn.failNext = true;
    const res = await call(`/stays/${stay}/check-out`, "POST", {});
    expect(res.status, await res.clone().text()).toBe(200);
    const k = await keysOf(stay);
    expect(k.acts[0]).toMatchObject({ act: "cancel", why: "check_out", outcome: "failed" });
    /* Still live in the record: the desk sees the lock has not been told. */
    expect(k.live).toMatchObject({ room: "104" });
  });

  it("a move from tonight cancels the old room's cards; a move from tomorrow leaves them", async () => {
    const later = await arrive("105");
    expect((await cut(later, { cards: 1 })).status).toBe(200);
    const res1 = await call(`/stays/${later}/move`, "POST", {
      roomNumber: "106", from: tomorrow, reason: "move" });
    expect(res1.status, await res1.clone().text()).toBe(200);
    expect((await keysOf(later)).live).toMatchObject({ room: "105" });

    const now = await arrive("107");
    expect((await cut(now, { cards: 1 })).status).toBe(200);
    const res2 = await call(`/stays/${now}/move`, "POST", {
      roomNumber: "108", from: today, reason: "move" });
    expect(res2.status, await res2.clone().text()).toBe(200);
    const k = await keysOf(now);
    expect(k.acts[0]).toMatchObject({ act: "cancel", why: "move", room: "107" });
    expect(k.live).toBeNull();
  });

  it("an exchange tonight cancels both guests' cards", async () => {
    const a = await arrive("109");
    const b = await arrive("110");
    for (const s of [a, b]) expect((await cut(s, { cards: 1 })).status).toBe(200);
    const res = await call(`/stays/${a}/exchange`, "POST",
      { withStayId: b, reason: "Key-card fixture - the swap is not what this tests" });
    expect(res.status, await res.clone().text()).toBe(200);
    for (const s of [a, b]) {
      expect((await keysOf(s)).acts[0]).toMatchObject({ act: "cancel", why: "move" });
    }
  });
});

