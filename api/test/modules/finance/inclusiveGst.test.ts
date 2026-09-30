import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   A RATE THAT INCLUDES GST (D27-187, D27-195)

   The typed figure is split per night into the rate before GST and the GST
   by the slab, worked on the pre-tax value, rounded a night as the audit
   rounds it. 5EL's card: 5% up to 7,500 a night, 18% above.
     - the slab gap (7,875.01 to 8,850) is refused, in the owner's words
     - a figure no paisa split can reach takes the nearest total NOT above it
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const tag = `IGST-${process.pid}`;
const GAP = "An inclusive rate between ₹7,875 and ₹8,850 can't be split under the GST slab: "
  + "type ₹7,875 or less, or more than ₹8,850.";
let owner = "";

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}
const split = async (gross: number) => (await (await app.request(
  `/api/hotels/5EL/tax/room/before-gst?gross=${gross}`, { headers: { "x-dev-staff-id": owner } })).json());

beforeAll(async () => {
  owner = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
});

afterAll(async () => {
  const ids = (await sql<{ id: string }>(
    `select r.id::text from reservations r join guests g on g.id = r.guest_id
      where g.full_name like $1`, [`${tag} %`])).map((r) => r.id);
  await sql("delete from guest_links where reservation_id = any($1::uuid[])", [ids]);
  await sql("delete from folios where reservation_id = any($1::uuid[])", [ids]);
  await sql("delete from reservations where id = any($1::uuid[])", [ids]);
  await closePool();
});

describe("the split", () => {
  it("is exact for a plain figure: 4,000 is 3,809.52 + 190.48", async () => {
    expect(await split(4000)).toEqual({ ok: true, pre: 3809.52, rate: 5, total: 4000 });
  });

  it("takes 5% at 7,875 and 18% at 8,850.01, and refuses the gap between", async () => {
    expect(await split(7875)).toEqual({ ok: true, pre: 7500, rate: 5, total: 7875 });
    expect(await split(7875.01)).toEqual({ ok: false, reason: GAP });
    expect(await split(8850)).toEqual({ ok: false, reason: GAP });
    expect(await split(8850.01)).toEqual({ ok: true, pre: 7500.01, rate: 18, total: 8850.01 });
  });

  it("takes the nearest total not above a figure no paisa split reaches: 502 is 501.99", async () => {
    expect(await split(502)).toEqual({ ok: true, pre: 478.09, rate: 5, total: 501.99 });
  });
});

describe("a booking at an inclusive rate", () => {
  const book = async (name: string, rate: number) => {
    const [source] = await sql<{ id: string }>(
      "select id::text from booking_sources where is_active and kind = 'direct' order by name limit 1");
    const [type] = await sql<{ id: string; d: string; e: string }>(
      `select rt.id::text, (app.business_date(h.id) + 3)::text as d, (app.business_date(h.id) + 4)::text as e
         from room_types rt join hotels h on h.id = rt.hotel_id
        where h.code = '5EL' and rt.is_active order by rt.sort_order limit 1`);
    return app.request("/api/hotels/5EL/bookings", {
      method: "POST",
      headers: { "x-dev-staff-id": owner, "content-type": "application/json" },
      body: JSON.stringify({
        guestName: `${tag} ${name}`, phone: "9812300003", checkIn: type!.d, checkOut: type!.e,
        bookingSourceId: source!.id,
        lines: [{ roomTypeId: type!.id, adults: 2, rooms: 1, agreedRate: rate, rateIncludesGst: true }],
      }),
    });
  };

  it("keeps the rate before GST, which the audit's GST adds back to the typed figure", async () => {
    const res = await book("Plain", 4000);
    expect(res.status, await res.clone().text()).toBe(200);
    const id = ((await res.json()) as { bookings: { id: string }[] }).bookings[0]!.id;
    const [r] = await sql<{ rate: string; night: string }>(
      `select agreed_rate::text as rate,
              (agreed_rate + round(agreed_rate * app.gst_rate_or_null(hotel_id, 'room', agreed_rate) / 100, 2))::text as night
         from reservations where id = $1`, [id]);
    expect(r).toEqual({ rate: "3809.52", night: "4000.00" });
  });

  it("is refused in the slab gap, and nothing is written", async () => {
    const res = await book("Gap", 8000);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toBe(GAP);
    expect(await sql("select 1 from guests where full_name = $1", [`${tag} Gap`])).toEqual([]);
  });
});
