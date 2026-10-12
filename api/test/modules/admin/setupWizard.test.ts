import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   SET UP THIS HOTEL (the owner's D27-311, 13 October)

   A NEW, EMPTY hotel (no rooms, no rates, nobody given it - as SHI was) is
   walked through the 18 steps' states: what the PMS derives from the rows,
   what only a hand can mark, what is refused, who may read and choose, and
   the reminder that appears in the bell on its day - derived, never stored.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const CODE = "SWZ";
let hotelId = "";
let owner = "";
const people: Record<"gm" | "admin" | "desk" | "manager" | "elsewhere", string> =
  { gm: "", admin: "", desk: "", manager: "", elsewhere: "" };

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const call = (who: string, method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

type Step = { id: string; state: string; automatic: boolean; detail: string | null;
              remindOn: string | null; by: string | null; at: string | null };
type Setup = { steps: Step[]; ready: boolean };

const read = async (who = owner) => {
  const res = await call(who, "GET", `/api/hotels/${CODE}/setup`);
  expect(res.status).toBe(200);
  return (await res.json()) as Setup;
};
const step = async (id: string, who = owner) => (await read(who)).steps.find((s) => s.id === id)!;
const choose = (id: string, body: unknown, who = owner) => call(who, "PUT", `/api/hotels/${CODE}/setup/${id}`, body);
const reason = async (res: Response) => ((await res.json()) as { ok: boolean; reason: string });
const bell = async (who: string) =>
  (await (await call(who, "GET", `/api/hotels/${CODE}/notifications`)).json()) as Array<Record<string, unknown>>;
/** The hotel's own date (India), as the server counts a reminder's day. */
const today = async (plus = 0) => (await sql<{ d: string }>(
  "select ((now() at time zone 'Asia/Kolkata')::date + $1::int)::text as d", [plus]))[0]!.d;

beforeAll(async () => {
  owner = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  await sql("delete from hotels where code = $1", [CODE]).catch(() => undefined);
  hotelId = (await sql<{ id: string }>(
    "insert into hotels (code, name, city) values ($1, 'Setup Wizard Hotel', 'Nowhere') returning id::text",
    [CODE]))[0]!.id;
});

afterAll(async () => {
  await sql("delete from staff_hotels where staff_id = any($1::uuid[])", [Object.values(people)]);
  await sql("update staff set is_active = false where id = any($1::uuid[])", [Object.values(people)]);
  await closePool();
  /* ONE statement list, one transaction: a teardown cut off by a timeout
     must never leave the hotels' no-delete guard switched off for the files
     after this one. The id is the database's own uuid, never typed. */
  await sql(`alter table hotels disable trigger hotels_no_delete;
             delete from hotels where id = '${hotelId}';
             alter table hotels enable trigger hotels_no_delete;`);
});

const roster = async () => {
  const at: [keyof typeof people, string, string][] = [
    ["gm", CODE, "gm"], ["admin", CODE, "admin"], ["desk", CODE, "front_desk"],
    ["manager", CODE, "hotel_manager"], ["elsewhere", "AGR", "gm"],
  ];
  for (const [who, code, role] of at) {
    const [row] = await sql<{ id: string }>(
      `insert into staff (email, full_name) values ($1, $2)
       on conflict (email) do update set is_active = true returning id::text`,
      [`swz-${who}@fidato.in`, `Setup ${who}`]);
    people[who] = row!.id;
    await sql("delete from staff_hotels where staff_id = $1", [row!.id]);
    await sql("insert into staff_hotels (staff_id, hotel_id, role) select $1, id, $3 from hotels where code = $2",
      [row!.id, code, role]);
  }
};

describe("D27-311 - a new, empty hotel: what the PMS sees", () => {
  it("answers the 18 steps in the owner's order, each in its group", async () => {
    const { steps, ready } = await read();
    expect(steps.map((s) => s.id)).toEqual([
      "profile", "taxes", "room-types", "rooms", "prices",
      "payments", "front-desk", "cancellation", "charges", "booking-sources", "people", "messages", "modules",
      "branding", "policies", "lists", "connections", "go-live"]);
    expect(ready).toBe(false);
  });

  it("every step the PMS can check is todo, says what is missing, and is automatic", async () => {
    const { steps } = await read();
    const by = (id: string) => steps.find((s) => s.id === id)!;
    expect(by("profile")).toMatchObject({ state: "todo", automatic: true });
    expect(by("profile").detail).toBe("Still missing: the GSTIN, the address, the phone, the email.");
    expect(by("taxes")).toMatchObject({ state: "todo", automatic: true, detail: "No GST rule for rooms yet." });
    expect(by("room-types")).toMatchObject({ state: "todo", detail: "No room types yet." });
    expect(by("rooms")).toMatchObject({ state: "todo", detail: "No rooms yet." });
    expect(by("prices")).toMatchObject({ state: "todo", detail: "No room types yet." });
    /* Five ways of paying come with every hotel; the bank details do not. */
    expect(by("payments")).toMatchObject({ state: "todo", automatic: true, detail: "Still missing: the bank details." });
    expect(by("cancellation")).toMatchObject({ state: "todo", detail: "No cancellation terms yet." });
    expect(by("people")).toMatchObject({ state: "todo", detail: "Nobody has been given this hotel yet." });
    expect(by("go-live")).toMatchObject({ state: "todo", automatic: true,
      detail: "Before the first booking: Hotel profile, Taxes, Room types, Rooms, A price on every room type." });
  });

  it("the steps it cannot always see are by hand, todo, with nothing invented as missing", async () => {
    const { steps } = await read();
    for (const id of ["front-desk", "charges", "booking-sources", "messages", "modules", "branding",
                      "policies", "lists", "connections"]) {
      expect(steps.find((s) => s.id === id), id).toMatchObject({ state: "todo", automatic: false, detail: null });
    }
  });
});

describe("D27-311 - who may read and choose", () => {
  beforeAll(roster);

  it("the hotel's owner, GM and Admin read it; reception and the hotel manager are refused", async () => {
    for (const who of [owner, people.gm, people.admin]) {
      expect((await call(who, "GET", `/api/hotels/${CODE}/setup`)).status).toBe(200);
    }
    for (const who of [people.desk, people.manager]) {
      const res = await call(who, "GET", `/api/hotels/${CODE}/setup`);
      expect(res.status).toBe(403);
      expect((await reason(res)).ok).toBe(false);
    }
  });

  it("a GM of another hotel is told there is no such property", async () => {
    expect((await call(people.elsewhere, "GET", `/api/hotels/${CODE}/setup`)).status).toBe(404);
    expect((await choose("modules", { choice: "later" }, people.elsewhere)).status).toBe(404);
  });

  it("reception and the hotel manager cannot choose, and nothing is stored", async () => {
    for (const who of [people.desk, people.manager]) {
      const res = await choose("modules", { choice: "later" }, who);
      expect(res.status).toBe(403);
      expect(await reason(res)).toMatchObject({ ok: false });
    }
    expect((await sql("select 1 from hotel_setup_steps where hotel_id = $1", [hotelId])).length).toBe(0);
  });

  it("people and roles ticks itself once somebody is given the hotel", async () => {
    expect(await step("people")).toMatchObject({ state: "done", detail: null });
  });
});

describe("D27-311 - the four choices", () => {
  it("Completed by hand on a step the PMS cannot check: done, with who and when", async () => {
    const res = await choose("front-desk", { choice: "completed" }, people.gm);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const s = await step("front-desk");
    expect(s).toMatchObject({ state: "done", by: "Setup gm", remindOn: null });
    expect(Date.parse(s.at!)).toBeGreaterThan(Date.now() - 60_000);
  });

  it("Completed is refused where the PMS checks it, and on the summary", async () => {
    for (const id of ["profile", "taxes", "rooms", "payments", "go-live"]) {
      const res = await choose(id, { choice: "completed" });
      expect(res.status, id).toBe(409);
      expect((await reason(res)).ok).toBe(false);
    }
    expect((await step("rooms")).state).toBe("todo");
    expect((await sql("select 1 from hotel_setup_steps where hotel_id = $1 and step in ('profile', 'rooms')",
      [hotelId])).length).toBe(0);
  });

  it("Later: the step waits, and an automatic step may wait too", async () => {
    expect((await choose("modules", { choice: "later" }, people.admin)).status).toBe(200);
    expect((await choose("rooms", { choice: "later" })).status).toBe(200);
    expect(await step("modules")).toMatchObject({ state: "later", by: "Setup admin" });
    expect(await step("rooms")).toMatchObject({ state: "later", detail: "No rooms yet.", by: "Group Owner" });
  });

  it("Remind me needs a day, from today on", async () => {
    expect((await choose("lists", { choice: "remind" })).status).toBe(400);
    expect((await choose("lists", { choice: "remind", remindOn: "2026-02-30" })).status).toBe(400);
    expect((await choose("lists", { choice: "remind", remindOn: await today(-1) })).status).toBe(400);
    const on = await today(3);
    expect((await choose("lists", { choice: "remind", remindOn: on })).status).toBe(200);
    expect(await step("lists")).toMatchObject({ state: "remind", remindOn: on });
  });

  it("an unknown step and an unknown choice are refused", async () => {
    expect((await choose("swimming-pool", { choice: "later" })).status).toBe(404);
    expect((await choose("lists", { choice: "skip" })).status).toBe(400);
  });

  it("Clear takes the choice away", async () => {
    expect((await choose("modules", { choice: "clear" })).status).toBe(200);
    expect(await step("modules")).toMatchObject({ state: "todo", by: null, at: null });
  });

  it("done wins over a stored choice: a discount set ticks charges, however it was left", async () => {
    expect((await choose("charges", { choice: "later" })).status).toBe(200);
    expect((await step("charges")).state).toBe("later");
    await sql("insert into room_promotions (hotel_id, name, percent) values ($1, 'Setup test 10%', 10)", [hotelId]);
    expect((await step("charges")).state).toBe("done");
  });
});

describe("D27-311 - the first five settled: ready, and go-live is done", () => {
  it("a real GSTIN and contact, a GST rule, a room type with a price and a room", async () => {
    await sql(`update hotels set gstin = '27AAGCF5655B1Z9', address_line = '1 Test Road', phone = '9000000000',
                 email = 'swz@example.com' where id = $1`, [hotelId]);
    await sql("insert into tax_rules (hotel_id, kind, over_amount, rate) values ($1, 'room', 0, 12)", [hotelId]);
    const [type] = await sql<{ id: string }>(
      "insert into room_types (hotel_id, code, name) values ($1, 'STD', 'Standard') returning id::text", [hotelId]);
    expect((await step("prices")).detail).toBe("1 of 1 room types have no price.");
    await sql("update room_types set base_rate = 3000 where id = $1", [type!.id]);
    await sql("insert into rooms (hotel_id, room_type_id, number) values ($1, $2, '101')", [hotelId, type!.id]);

    const { steps, ready } = await read(people.gm);
    expect(ready).toBe(true);
    for (const id of ["profile", "taxes", "room-types", "rooms", "prices", "go-live"]) {
      expect(steps.find((s) => s.id === id), id).toMatchObject({ state: "done", detail: null });
    }
    /* "Later" on rooms is still stored; done wins. */
    expect(steps.find((s) => s.id === "rooms")!.by).toBe("Group Owner");
  });

  it("the dummy GSTIN is not a real one", async () => {
    await sql("update hotels set gstin = '27AAAAA0000A1Z5' where id = $1", [hotelId]);
    expect(await step("profile")).toMatchObject({ state: "todo",
      detail: "Still missing: a real GSTIN (the one set is a dummy)." });
    expect((await read()).ready).toBe(false);
    await sql("update hotels set gstin = '27AAGCF5655B1Z9' where id = $1", [hotelId]);
  });
});

describe("D27-311 - the reminder in the bell, on its day, derived", () => {
  const reminders = async (who: string) => (await bell(who)).filter((n) => String(n["id"]).startsWith("setup-"));

  it("on the day: the hotel's owner, GM and Admin see it; reception does not", async () => {
    expect((await choose("modules", { choice: "remind", remindOn: await today() }, people.gm)).status).toBe(200);
    for (const who of [owner, people.gm, people.admin]) {
      expect(await reminders(who)).toEqual([{
        id: "setup-reminder-modules", hotelId: CODE, category: "system",
        title: "Setup: Modules", body: "You asked to be reminded today.",
        isRead: false, at: expect.any(String), link: `/h/${CODE}/setup?step=modules`, actionRequired: true,
      }]);
    }
    expect(await reminders(people.desk)).toEqual([]);
  });

  it("not before its day", async () => {
    /* lists: reminded in three days (above). */
    expect((await reminders(people.gm)).map((n) => n["id"])).not.toContain("setup-reminder-lists");
  });

  it("and after its day, until it is done", async () => {
    await sql("update hotel_setup_steps set remind_on = remind_on - 2 where hotel_id = $1 and step = 'modules'",
      [hotelId]);
    expect((await reminders(people.gm)).map((n) => n["id"])).toEqual(["setup-reminder-modules"]);
    expect((await choose("modules", { choice: "completed" }, people.gm)).status).toBe(200);
    expect(await reminders(people.gm)).toEqual([]);
  });

  it("gone when the PMS sees the step done, or the choice is cleared", async () => {
    const day = await today();
    expect((await choose("connections", { choice: "remind", remindOn: day })).status).toBe(200);
    expect((await choose("branding", { choice: "remind", remindOn: day })).status).toBe(200);
    expect((await reminders(owner)).map((n) => n["id"]).sort())
      .toEqual(["setup-reminder-branding", "setup-reminder-connections"]);
    await sql("insert into market_rate_settings (hotel_id, is_on) values ($1, true)", [hotelId]);
    expect((await choose("branding", { choice: "clear" })).status).toBe(200);
    expect(await reminders(owner)).toEqual([]);
    /* Nothing was stored for the bell: the table holds only the choices. */
    expect((await sql("select step from hotel_setup_steps where hotel_id = $1 order by step", [hotelId]))
      .map((r) => (r as { step: string }).step))
      .toEqual(["charges", "connections", "front-desk", "lists", "modules", "rooms"]);
  });
});
