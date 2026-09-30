import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   VIEW VOUCHER (D27-187): the confirmation's own PDF, to look at, print
   or save. It sends nothing; only a confirmed booking has one.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const tag = `VV-${process.pid}`;
let owner = "";
let confirmed = "";
let inHouse = "";

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}
const view = (id: string) => app.request(`/api/hotels/5EL/stays/${id}/voucher.pdf`,
  { headers: { "x-dev-staff-id": owner } });

beforeAll(async () => {
  owner = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  const [source] = await sql<{ id: string }>(
    "select id::text from booking_sources where is_active and kind = 'direct' order by name limit 1");
  const [type] = await sql<{ id: string; d: string; e: string }>(
    `select rt.id::text, app.business_date(h.id)::text as d, (app.business_date(h.id) + 2)::text as e
       from room_types rt join hotels h on h.id = rt.hotel_id
      where h.code = '5EL' and rt.is_active order by rt.sort_order limit 1`);
  const res = await app.request("/api/hotels/5EL/bookings", {
    method: "POST",
    headers: { "x-dev-staff-id": owner, "content-type": "application/json" },
    body: JSON.stringify({
      guestName: `${tag} Asha`, phone: "9812300001", checkIn: type!.d, checkOut: type!.e,
      bookingSourceId: source!.id,
      lines: [{ roomTypeId: type!.id, adults: 2, rooms: 1, agreedRate: 3000 }],
    }),
  });
  const out = (await res.json()) as { bookings: { id: string }[] };
  confirmed = out.bookings[0]!.id;
  inHouse = (await sql<{ id: string }>(
    `select r.id::text from reservations r join hotels h on h.id = r.hotel_id
      where h.code = '5EL' and r.status = 'checked_in' limit 1`))[0]!.id;
});

afterAll(async () => {
  await sql("delete from guest_links where reservation_id = $1", [confirmed]);
  await sql("delete from folios where reservation_id = $1", [confirmed]);
  await sql("delete from reservations where id = $1", [confirmed]);
  await closePool();
});

describe("View voucher", () => {
  it("draws a confirmed booking's voucher as a PDF, and sends nothing", async () => {
    const before = await sql("select 1 from messages_sent where about_id = $1", [confirmed]);
    const res = await view(confirmed);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(new TextDecoder().decode((await res.arrayBuffer()).slice(0, 5))).toBe("%PDF-");
    expect(await sql("select 1 from messages_sent where about_id = $1", [confirmed]))
      .toEqual(before);
  });

  it("has none for a guest already in house", async () => {
    const res = await view(inHouse);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Only a confirmed booking has a voucher." });
  });

  it("is no such booking for an id that is not one", async () => {
    expect((await view("not-an-id")).status).toBe(404);
    expect((await view("00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });
});
