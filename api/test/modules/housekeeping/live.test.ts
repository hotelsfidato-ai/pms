import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   A ROOM THAT CHANGES SAYS SO — HK-1, the owner's D17-39

   The board's half of refreshing itself: every change the housekeeping
   board shows raises "<hotel id>:housekeeping" on the live channel, from a
   trigger on the row — whichever route made the change.

   Listened to on the DATABASE channel directly, not through the stream,
   because carrying the topic to the screen is the master's change to the
   shared listener (the request in src/modules/housekeeping/MODULE.md).
   What is proved here holds whatever that change looks like:

     · a housekeeper's tap, an assignment, a work order, a block and a put
       back each announce the hotel and the topic
     · a change at another hotel announces THAT hotel, never this one
     · nothing is announced as a bare hotel id — which is what would wake
       every till and kitchen in the hotel for a room marked clean

   Everything written is put back or removed afterwards.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const sql = async (text: string, params: unknown[] = []) => {
  const db = new pg.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

let listener: pg.Client;
const heard: string[] = [];
let hotelId: string;
let otherHotelId: string;
let ownerUid: string;
let room: { id: string; number: string; state: string };
let otherRoom: { id: string; state: string };

const call = (path: string, method = "GET", body?: unknown, code = "5EL") =>
  app.request(`/api/hotels/${code}${path}`, {
    method,
    headers: { "x-dev-staff-id": ownerUid, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** What arrives on the channel while `act` runs, waiting until `want` shows. */
async function during(act: () => Promise<unknown>, want: string): Promise<string[]> {
  heard.length = 0;
  await act();
  for (let i = 0; i < 60 && !heard.includes(want); i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
  /* A little longer, so anything ELSE that was going to arrive has. */
  await new Promise((r) => setTimeout(r, 150));
  return [...heard];
}

beforeAll(async () => {
  hotelId = (await sql("select id::text from hotels where code = '5EL'")).rows[0].id;
  otherHotelId = (await sql("select id::text from hotels where code = 'AGR'")).rows[0].id;
  ownerUid = (await sql("select firebase_uid from staff where email = 'owner@fidato.in'")).rows[0].firebase_uid;

  /* A room nobody is in and that is not out, so every change here is allowed. */
  room = (await sql(
    `select r.id::text, r.number, r.housekeeping_status as state from rooms r
      where r.hotel_id = $1 and r.is_active and r.housekeeping_status <> 'out_of_service'
        and not exists (select 1 from room_assignments ra
                          join reservations rs on rs.id = ra.reservation_id
                         where ra.room_id = r.id and ra.released_at is null
                           and rs.status = 'checked_in')
        and not exists (select 1 from room_blocks b where b.room_id = r.id)
      order by r.number limit 1`, [hotelId])).rows[0];
  otherRoom = (await sql(
    `select id::text, housekeeping_status as state from rooms
      where hotel_id = $1 and housekeeping_status <> 'out_of_service'
      order by number limit 1`, [otherHotelId])).rows[0];

  listener = new pg.Client({ connectionString: SUPER });
  await listener.connect();
  listener.on("notification", (msg) => {
    if (msg.channel === "pos_changed" && msg.payload) heard.push(msg.payload);
  });
  await listener.query("listen pos_changed");
});

afterAll(async () => {
  await listener.end();
  await sql("update rooms set housekeeping_status = $1 where id = $2", [room.state, room.id]);
  await sql("update rooms set housekeeping_status = $1 where id = $2", [otherRoom.state, otherRoom.id]);
  await sql("delete from housekeeping_assignments where room_id = $1", [room.id]);
  await sql("update work_orders set block_id = null where title like 'HKLIVE %'");
  await sql("delete from room_blocks where note like 'HKLIVE %'");
  await sql("delete from work_orders where title like 'HKLIVE %'");
  await closePool();
});

describe("the housekeeping board hears a change (D17-39)", () => {
  const topic = () => `${hotelId}:housekeeping`;

  it("when a housekeeper marks a room", async () => {
    const next = room.state === "dirty" ? "clean" : "dirty";
    const got = await during(async () => {
      const res = await call(`/rooms/${room.number}/housekeeping`, "PUT", { state: next });
      expect(res.status, await res.clone().text()).toBe(200);
    }, topic());
    expect(got).toContain(topic());
  });

  it("when a room is given to somebody", async () => {
    const staffId = (await sql(
      `select sh.staff_id::text from staff_hotels sh join staff s on s.id = sh.staff_id
        where sh.hotel_id = $1 and s.is_active limit 1`, [hotelId])).rows[0].staff_id;
    const got = await during(async () => {
      const res = await call(`/housekeeping/assignments/${room.number}`, "PUT", { staffId });
      expect(res.status, await res.clone().text()).toBe(200);
    }, topic());
    expect(got).toContain(topic());
  });

  it("when a repair is raised, and when the room is taken out and put back", async () => {
    let orderId = "";
    let got = await during(async () => {
      const res = await call("/work-orders", "POST", { title: "HKLIVE Ceiling leak", roomNumber: room.number });
      expect(res.status, await res.clone().text()).toBe(200);
      orderId = ((await res.json()) as { id: string }).id;
    }, topic());
    expect(got).toContain(topic());

    let blockId = "";
    got = await during(async () => {
      const res = await call(`/rooms/${room.number}/block`, "POST",
        { reason: "out_of_order", from: "2020-01-01", note: "HKLIVE leak", workOrderId: orderId });
      expect(res.status, await res.clone().text()).toBe(200);
      blockId = ((await res.json()) as { id: string }).id;
    }, topic());
    expect(got).toContain(topic());

    got = await during(async () => {
      const res = await call(`/rooms/${room.number}/block/${blockId}`, "DELETE");
      expect(res.status, await res.clone().text()).toBe(200);
    }, topic());
    expect(got).toContain(topic());
  });

  it("announces another hotel's change as THAT hotel, never this one", async () => {
    const got = await during(async () => {
      await sql("update rooms set housekeeping_status = $1 where id = $2",
        [otherRoom.state === "dirty" ? "clean" : "dirty", otherRoom.id]);
    }, `${otherHotelId}:housekeeping`);
    expect(got).toContain(`${otherHotelId}:housekeeping`);
    expect(got).not.toContain(topic());
  });

  it("never as a bare hotel id — a room marked clean does not wake the tills", async () => {
    const got = await during(async () => {
      await call(`/rooms/${room.number}/housekeeping`, "PUT", { state: "dirty" });
      await call(`/rooms/${room.number}/housekeeping`, "PUT", { state: "clean" });
    }, topic());
    expect(got.length).toBeGreaterThan(0);
    expect(got.filter((p) => p === hotelId), "a housekeeping change woke the restaurant").toEqual([]);
  });
});
