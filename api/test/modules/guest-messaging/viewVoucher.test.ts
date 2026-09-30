import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   VIEW VOUCHER (D27-187): the confirmation's own PDF, to look at, print
   or save. It sends nothing; only a confirmed booking has one.

   ITS LOGO (D27-214): the hotel's own PNG where it has one, the group's
   PNG where it has not - the PDF draws PNG only, so a hotel whose own
   logo is an SVG prints the group's. Migration 168 re-creates
   app.guest_voucher for that one expression; nothing else in it moved.
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

describe("the voucher's logo (D27-214)", () => {
  const picture = (words: string) => Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(words)]);
  const GROUPS = picture("the group's");
  const HOTELS = picture("5 Elements' own");
  const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>');
  let was: { group: Record<string, unknown>[]; hotel: Record<string, unknown>[] };

  const facts = async () => (await sql<{ facts: Record<string, unknown> }>(
    "select app.guest_voucher($1::uuid) as facts", [confirmed]))[0]!.facts;
  const hotelLogo = async (type: string | null, bytes?: Buffer) => {
    await sql("delete from hotel_logos where hotel_id = (select id from hotels where code = '5EL')");
    if (type) {
      await sql(
        "insert into hotel_logos (hotel_id, logo_type, logo) select id, $1, $2 from hotels where code = '5EL'",
        [type, bytes]);
    }
  };

  beforeAll(async () => {
    was = {
      group: await sql("select name, logo_type, logo, changed_by from group_settings"),
      hotel: await sql(
        "select hotel_id, logo_type, logo, changed_by from hotel_logos where hotel_id = (select id from hotels where code = '5EL')"),
    };
    await sql("delete from group_settings");
    await sql("insert into group_settings (name, logo_type, logo) values ('Test Group', 'image/png', $1)", [GROUPS]);
  });

  afterAll(async () => {
    await hotelLogo(null);
    await sql("delete from group_settings");
    for (const g of was.group) {
      await sql("insert into group_settings (name, logo_type, logo, changed_by) values ($1, $2, $3, $4)",
        [g["name"], g["logo_type"], g["logo"], g["changed_by"]]);
    }
    for (const h of was.hotel) {
      await sql("insert into hotel_logos (hotel_id, logo_type, logo, changed_by) values ($1, $2, $3, $4)",
        [h["hotel_id"], h["logo_type"], h["logo"], h["changed_by"]]);
    }
  });

  it("is the hotel's own PNG where it has one, the group's for an SVG or none, and nothing else moves", async () => {
    await hotelLogo(null);
    const none = await facts();
    expect(none["logoPng"]).toBe(GROUPS.toString("base64"));

    await hotelLogo("image/svg+xml", SVG);
    const svg = await facts();
    expect(svg["logoPng"]).toBe(GROUPS.toString("base64"));

    await hotelLogo("image/png", HOTELS);
    const own = await facts();
    expect(own["logoPng"]).toBe(HOTELS.toString("base64"));

    /* The rest of the answer is the same whichever logo it carries. */
    const rest = ({ logoPng: _logo, ...others }: Record<string, unknown>) => others;
    expect(rest(own)).toEqual(rest(none));
    expect(rest(svg)).toEqual(rest(none));
    expect(Object.keys(own).sort()).toEqual([
      "bookedOn", "checkIn", "checkOut", "company", "confirmedAt", "confirmedBy", "groupName",
      "guest", "hotel", "logoPng", "nights", "reference", "rooms", "terms"]);
    expect(own["groupName"]).toBe("Test Group");
  });

  it("is 158's function word for word, but for the logo (MEMORY 317)", () => {
    const definition = (file: string) => {
      const text = readFileSync(new URL(`../../../../db/migrations/${file}`, import.meta.url), "utf8")
        .replace(/\r\n/g, "\n");
      const from = text.indexOf("create or replace function app.guest_voucher(");
      const body = text.slice(from, text.indexOf("$fn$;", from));
      const logo = body.indexOf("'logoPng',");
      return body.slice(0, logo) + "<the logo>" + body.slice(body.indexOf("    'guest',", logo));
    };
    const now = definition("168_the_hotels_own_profile.sql");
    expect(now).toContain("returns jsonb");
    expect(now).toBe(definition("158_the_code_to_the_bookings_phone.sql"));
  });
});
