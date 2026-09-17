import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   DOES THE INVENTORY SUBTRACT A ROOM THAT IS OUT OF SERVICE?
   Every way a room can be marked so, asked of GET /:code/inventory.

   Asked because two screens disagree about room 308: the notification
   bell says it is out of service, the Rooms screen draws it as a room
   that can be sold. On 16 September the development database had

       308   housekeeping_status 'inspected'
             one block, out_of_service, 14 Aug → open (covers today, 25 Aug)

   A room is "out of service" in TWO places, and they are not kept in step:

     room_blocks               dated, with a reason. Read by the inventory
                               (app.sellable_rooms, 022/044), every
                               occupancy figure, the bell and the tape chart.
     rooms.housekeeping_status the state NOW. Read by the Rooms screen's
                               "Out of service" (stayview.ts), the property's
                               room count (GET /:code) and the check-in guard.

   The ways a room can be marked, and what this file asserts for each:

     a block, through the Housekeeping board, for each of its five
       reasons (NC is house_use)                      subtracted
     a block's first and last day, and no further    subtracted, inclusive
     an open-ended block, a year on                   subtracted
     the room's status alone, out_of_service         NOT subtracted
     the room's status alone, out_of_order           NOT subtracted
     the room retired (is_active false)               subtracted
     308's shape: a block covering today, the
       room's status saying it is clean               subtracted — and the
                                                      Rooms screen's data
                                                      and the bell disagree

   The last case is reproduced through the API, not typed into the
   database, because the path matters: releasing ONE of a room's two
   blocks sets the room 'dirty' even while the other block still covers
   today, and housekeeping can then clean it. INV-6.

   EVERY MARK IS REMOVED after its case, and the dated ones are in 2029,
   so no other file's August 2026 figures move.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const admin = async () =>
  new (await import("pg")).default.Pool({ connectionString: SUPER });

let ownerId: string;
let room: { id: string; number: string; typeId: string; status: string };
let businessDate: string;

const call = (path: string, method = "GET", body?: unknown) =>
  app.request(`/api/hotels${path}`, {
    method,
    headers: { "x-dev-staff-id": ownerId, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** Sellable rooms of the test room's type on a date — the inventory's answer. */
const sellableOn = async (date: string) => {
  const res = await call(`/5EL/inventory?from=${date}&to=${date}`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    cells: { roomTypeId: string; date: string; sellable: number }[];
  };
  const cell = body.cells.find((c) => c.roomTypeId === room.typeId && c.date === date);
  expect(cell, `no inventory cell for ${date}`).toBeDefined();
  return cell!.sellable;
};

const block = async (reason: string, from: string, to: string | null) => {
  const res = await call(`/5EL/rooms/${room.number}/block`, "POST", { reason, from, to });
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as { id: string }).id;
};

const sql = async (text: string, params: unknown[] = []) => {
  const db = await admin();
  try { return await db.query(text, params); } finally { await db.end(); }
};

beforeAll(async () => {
  ownerId = (await sql(
    "select id::text from staff where email = 'owner@fidato.in'")).rows[0]!.id;

  /* A room nobody is in, with no block of its own, whose type has others —
     so a subtraction is visible and nothing else is marked on it. */
  const { rows } = await sql(
    `select r.id::text, r.number, r.room_type_id::text as type_id,
            r.housekeeping_status as status, app.business_date(r.hotel_id)::text as bd
       from rooms r join hotels h on h.id = r.hotel_id
      where h.code = '5EL' and r.is_active
        /* Vacant as well as unassigned: retiring a room reads occupancy_status,
           and the first run picked one the demo leaves 'occupied'. */
        and r.occupancy_status = 'vacant'
        and not exists (select 1 from room_blocks b where b.room_id = r.id)
        and not exists (select 1 from room_assignments ra
                          join reservations res on res.id = ra.reservation_id
                         where ra.room_id = r.id and ra.released_at is null
                           and res.status = 'checked_in')
        and (select count(*) from rooms o
              where o.room_type_id = r.room_type_id and o.is_active) > 1
      order by r.number limit 1`);
  expect(rows[0], "5EL needs a free, unblocked room").toBeDefined();
  room = { id: rows[0].id, number: rows[0].number, typeId: rows[0].type_id,
           status: rows[0].status };
  businessDate = rows[0].bd;
});

/* Whatever a case did to the room, undone — blocks, status, retirement. */
afterEach(async () => {
  await sql("delete from room_blocks where room_id = $1", [room.id]);
  await sql("update rooms set housekeeping_status = $1, is_active = true where id = $2",
    [room.status, room.id]);
});

afterAll(async () => { await closePool(); });

describe("a block, through the Housekeeping board", () => {
  it.each([
    ["out_of_service"],
    ["out_of_order"],
    ["refurbishment"],
    ["house_use"],          // NC — not for sale, house use (owner, 16 September)
    ["owner_occupied"],
  ])("subtracts a room blocked as %s", async (reason) => {
    const before = await sellableOn("2029-06-11");
    await block(reason, "2029-06-10", "2029-06-12");
    expect(await sellableOn("2029-06-11")).toBe(before - 1);
  });

  it("subtracts it on the first and the last day of the block, and on no other", async () => {
    const outside = await sellableOn("2029-06-09");
    await block("out_of_service", "2029-06-10", "2029-06-12");

    /* Inclusive at both ends — `p_date <= b.to_date` (022, 044), the same
       reading the bell and the tape chart use. */
    expect(await sellableOn("2029-06-09")).toBe(outside);
    expect(await sellableOn("2029-06-10")).toBe(outside - 1);
    expect(await sellableOn("2029-06-12")).toBe(outside - 1);
    expect(await sellableOn("2029-06-13")).toBe(outside);
  });

  it("subtracts an open-ended block a year after it starts", async () => {
    const before = await sellableOn("2030-06-10");
    await block("out_of_order", "2029-06-10", null);
    expect(await sellableOn("2030-06-10")).toBe(before - 1);
  });
});

describe("the room's own status, with no block", () => {
  /* What the inventory does TODAY, asserted as a fact rather than a wish.
     Its one definition is room_blocks, and this proves it reads nothing
     else. Whether a status with no block should count is not the
     inventory's to decide (INV-6); if that changes, these two go red and
     say so. */
  it.each([["out_of_service"], ["out_of_order"]])(
    "does NOT subtract a room whose status alone says %s",
    async (status) => {
      const before = await sellableOn("2029-06-11");
      await sql("update rooms set housekeeping_status = $1 where id = $2", [status, room.id]);
      expect(await sellableOn("2029-06-11")).toBe(before);
    },
  );
});

describe("a retired room", () => {
  it("subtracts a room taken off the property's list", async () => {
    const before = await sellableOn("2029-06-11");
    const res = await call(`/5EL/rooms/${room.number}`, "PATCH", { isActive: false });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await sellableOn("2029-06-11")).toBe(before - 1);
  });
});

describe("room 308's shape - a block covering today, a status saying clean", () => {
  it("is subtracted by the inventory and the bell, and sellable on the Rooms screen's data", async () => {
    const before = await sellableOn(businessDate);

    /* Two blocks, as the demo gives 308: one that ended before today, one
       from before today with no end. Each started on or before the business
       date, so each set the room 'out_of_service'. */
    const past = await block("out_of_service", "2026-08-01", "2026-08-07");
    await block("out_of_service", "2026-08-14", null);
    expect((await sql("select housekeeping_status from rooms where id = $1",
      [room.id])).rows[0].housekeeping_status).toBe("out_of_service");

    /* Release the one that already ended. */
    const released = await call(`/5EL/rooms/${room.number}/block/${past}`, "DELETE");
    expect(released.status, await released.clone().text()).toBe(200);

    /* THE PATH: the release set the room back to 'dirty' although the other
       block still covers today, so housekeeping may clean it. */
    const cleaned = await call(`/5EL/rooms/${room.number}/housekeeping`, "PUT",
      { state: "clean" });
    expect(cleaned.status, "housekeeping could clean a room still blocked today")
      .toBe(200);

    /* The inventory reads the block: the room is out. */
    expect(await sellableOn(businessDate)).toBe(before - 1);

    /* The bell reads the block: the room is out. */
    const bell = (await (await call(`/5EL/notifications?asOn=${businessDate}`)).json()) as
      { id: string; body: string }[];
    const out = bell.find((n) => n.id === "rooms-out-of-service");
    expect(out?.body ?? "", "the bell does not list the room").toContain(room.number);

    /* The Rooms screen reads the status (stayview.ts: status ===
       "out-of-service"): the room is clean, so it is drawn as sellable. */
    const rooms = (await (await call("/5EL/rooms")).json()) as
      { number: string; status: string; blocks: unknown[] }[];
    const mine = rooms.find((r) => r.number === room.number)!;
    expect(mine.status).toBe("clean");
    expect(mine.blocks, "the block is in the same response").toHaveLength(1);
  });
});
