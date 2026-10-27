import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   A REPRINT WAKES THE PRINTING COMPUTER AT ONCE (243; the owner, 27
   October: "reprint on KOT is taking long time to print")

   The printing computer re-reads its queue when it hears `pos_changed`
   for its hotel, and every 30 seconds otherwise. A reprint and a bill
   asked of the bill printer announced nothing, so each waited for the
   30-second read. Each must now be heard when it is asked.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

let db: pg.Client;
let listener: pg.Client;
const heard: string[] = [];
let hotelId: string, orderId: string, kindId: string, staffId: string;

/** What the channel carried while `act` ran, after its commit. */
async function during(act: () => Promise<unknown>): Promise<string[]> {
  heard.length = 0;
  await act();
  await new Promise((r) => setTimeout(r, 300));
  return [...heard];
}

beforeAll(async () => {
  db = new pg.Client({ connectionString: SUPER });
  await db.connect();
  hotelId = (await db.query("select id::text from hotels where code = '5EL'")).rows[0].id;
  staffId = (await db.query("select id::text from staff where email = 'owner@fidato.in'")).rows[0].id;
  /* An order of our own, as the KOT section's test opens one. */
  const opened = await app.request("/api/hotels/5EL/till/orders", {
    method: "POST",
    headers: { "x-dev-staff-id": staffId, "content-type": "application/json" },
    body: JSON.stringify({ outlet: "REST", table: "PRWAKE" }),
  });
  expect(opened.status, await opened.clone().text()).toBe(200);
  orderId = ((await opened.json()) as { id: string }).id;
  kindId = (await db.query(
    "select id::text from pos_kot_kinds where hotel_id = $1 limit 1", [hotelId])).rows[0].id;

  listener = new pg.Client({ connectionString: SUPER });
  await listener.connect();
  listener.on("notification", (msg) => {
    if (msg.channel === "pos_changed" && msg.payload) heard.push(msg.payload);
  });
  await listener.query("listen pos_changed");
});

afterAll(async () => {
  if (orderId) {
    await db.query("delete from pos_kot_reprints where order_id = $1", [orderId]);
    await db.query("delete from pos_bill_prints where order_id = $1", [orderId]);
    await db.query("delete from pos_orders where id = $1", [orderId]);
  }
  await listener?.end();
  await db?.end();
  await closePool();
});

describe("a slip asked again is heard at once (243)", () => {
  it("a KOT reprint", async () => {
    const got = await during(() => db.query(
      `insert into pos_kot_reprints (hotel_id, order_id, kot_no, kind_id, asked_by)
       values ($1, $2, 1, $3, $4)`, [hotelId, orderId, kindId, staffId]));
    expect(got).toContain(hotelId);
  });

  it("a bill sent to be printed", async () => {
    const got = await during(() => db.query(
      `insert into pos_bill_prints (hotel_id, order_id, heading, asked_by, printed_here)
       values ($1, $2, 'interim', $3, true)`, [hotelId, orderId, staffId]));
    expect(got).toContain(hotelId);
  });
});
