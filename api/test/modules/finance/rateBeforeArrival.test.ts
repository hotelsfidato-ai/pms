import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* D27-187, D27-195: Change rate after confirmation, before check-in. With
   no night charged there is no line to carry the reason, so the booking's
   notes keep it: "Rate ₹3,433.68 → ₹3,200.00: <reason>". Nothing is posted. */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const tag = `RBA-${process.pid}`;
let owner = "";
let stay = "";

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}
const post = (path: string, body: unknown) => app.request(`/api/hotels/5EL${path}`, {
  method: "POST",
  headers: { "x-dev-staff-id": owner, "content-type": "application/json" },
  body: JSON.stringify(body),
});

beforeAll(async () => {
  owner = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  const [source] = await sql<{ id: string }>(
    "select id::text from booking_sources where is_active and kind = 'direct' order by name limit 1");
  const [type] = await sql<{ id: string; d: string; e: string }>(
    `select rt.id::text, (app.business_date(h.id) + 3)::text as d, (app.business_date(h.id) + 5)::text as e
       from room_types rt join hotels h on h.id = rt.hotel_id
      where h.code = '5EL' and rt.is_active order by rt.sort_order limit 1`);
  const res = await post("/bookings", {
    guestName: `${tag} Rohit`, phone: "9812300002", checkIn: type!.d, checkOut: type!.e,
    bookingSourceId: source!.id, notes: "Late arrival",
    lines: [{ roomTypeId: type!.id, adults: 2, rooms: 1, agreedRate: 3433.68 }],
  });
  stay = ((await res.json()) as { bookings: { id: string }[] }).bookings[0]!.id;
});

afterAll(async () => {
  await sql("delete from guest_links where reservation_id = $1", [stay]);
  await sql("delete from folios where reservation_id = $1", [stay]);
  await sql("delete from reservations where id = $1", [stay]);
  await closePool();
});

describe("Change rate before check-in", () => {
  it("changes the agreed rate, posts nothing, and keeps the reason in the notes", async () => {
    const res = await post(`/stays/${stay}/rate`, { rate: 3200, reason: "Corporate rate agreed" });
    expect(res.status, await res.clone().text()).toBe(200);
    const [r] = await sql<{ agreed_rate: string; notes: string }>(
      "select agreed_rate::text, notes from reservations where id = $1", [stay]);
    expect(r).toEqual({
      agreed_rate: "3200.00",
      notes: "Late arrival · Rate ₹3,433.68 → ₹3,200.00: Corporate rate agreed",
    });
    expect(await sql("select 1 from folio_postings where reservation_id = $1", [stay])).toEqual([]);
  });

  /* D27-199: the same "Includes GST" tick as the booking page. The typed
     figure is split before it is kept; the note keeps what was typed. */
  it("splits a rate that includes GST, and the note says the all-in figure", async () => {
    const res = await post(`/stays/${stay}/rate`,
      { rate: 4000, reason: "Walk-in price agreed", includesGst: true });
    expect(res.status, await res.clone().text()).toBe(200);
    const [r] = await sql<{ agreed_rate: string; notes: string }>(
      "select agreed_rate::text, notes from reservations where id = $1", [stay]);
    expect(r!.agreed_rate).toBe("3809.52");
    expect(r!.notes.endsWith("Rate ₹3,200.00 → ₹4,000.00 incl. GST: Walk-in price agreed")).toBe(true);
  });

  it("refuses an all-in figure in the slab gap, and nothing changes", async () => {
    const res = await post(`/stays/${stay}/rate`, { rate: 8000, reason: "Upgrade", includesGst: true });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toBe(
      "An inclusive rate between ₹7,875 and ₹8,850 can't be split under the GST slab: "
      + "type ₹7,875 or less, or more than ₹8,850.");
    expect((await sql<{ r: string }>(
      "select agreed_rate::text as r from reservations where id = $1", [stay]))[0]!.r).toBe("3809.52");
  });
});
