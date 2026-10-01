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

   ITS NEW FACTS (D27-215, migration 169): the hotel's contact, house
   policies and bank details, the group's office details, who booked,
   what the booking's bills have received, and the extra guests in a
   room. Keys ADDED: every line 168's function has is still in 169's,
   in order.
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
      "bank", "bookedBy", "bookedOn", "checkIn", "checkOut", "company", "confirmedAt", "confirmedBy",
      "contact", "group", "groupName", "guest", "hotel", "housePolicies", "logoPng", "nights",
      "payment", "reference", "rooms", "terms"]);
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

describe("the voucher's new facts (D27-215)", () => {
  const FOUR = [
    "Guests must present government photo identity at check in - driving licence, voter ID, Aadhaar or passport.",
    "A valid credit card may be required to guarantee incidental charges.",
    "Special requests are subject to availability at check in.",
    "Please share your company GST number at check in if the stay is billed to a company.",
  ];
  const facts = async (id: string) => (await sql<{ facts: Record<string, any> }>(
    "select app.guest_voucher($1::uuid) as facts", [id]))[0]!.facts;
  const HOTEL = "(select id from hotels where code = '5EL')";
  let booker = "";
  let byBooker = "";
  let source = { id: "", name: "" };
  let was: Record<string, Record<string, unknown>[]>;

  beforeAll(async () => {
    was = {
      hotel: await sql("select reservations_contact, house_policies from hotels where code = '5EL'"),
      bank: await sql(`select * from hotel_bank_details where hotel_id = ${HOTEL}`),
      group: await sql("select * from group_settings"),
      channel: await sql(`select * from channel_hotels where hotel_id = ${HOTEL}`),
    };
    await sql(`delete from hotel_bank_details where hotel_id = ${HOTEL}`);
    await sql(`delete from channel_hotels where hotel_id = ${HOTEL}`);
    await sql("delete from group_settings");
    await sql("update hotels set reservations_contact = null where code = '5EL'");

    /* A person at 5EL who makes a booking: three adults in a Deluxe. */
    booker = (await sql<{ id: string }>(
      `insert into staff (email, full_name) values ('vv-booker@fidato.in', '${tag} Booker')
       on conflict (email) do update set is_active = true, full_name = excluded.full_name
       returning id::text`))[0]!.id;
    await sql(
      `insert into staff_hotels (staff_id, hotel_id, role) select $1, id, 'gm' from hotels where code = '5EL'
       on conflict (staff_id, hotel_id) do update set role = 'gm'`, [booker]);
    source = (await sql<{ id: string; name: string }>(
      "select id::text, name from booking_sources where is_active and kind = 'direct' order by name limit 1"))[0]!;
    const [deluxe] = await sql<{ id: string; d: string; e: string }>(
      `select rt.id::text, (app.business_date(h.id) + 3)::text as d, (app.business_date(h.id) + 5)::text as e
         from room_types rt join hotels h on h.id = rt.hotel_id
        where h.code = '5EL' and rt.code = 'DLX'`);
    const res = await app.request("/api/hotels/5EL/bookings", {
      method: "POST",
      headers: { "x-dev-staff-id": booker, "content-type": "application/json" },
      body: JSON.stringify({
        guestName: `${tag} Three`, phone: "9812300002", checkIn: deluxe!.d, checkOut: deluxe!.e,
        bookingSourceId: source.id,
        lines: [{ roomTypeId: deluxe!.id, adults: 3, rooms: 1, agreedRate: 4000 }],
      }),
    });
    const text = await res.text();
    expect(res.status, text).toBeLessThan(300);
    byBooker = (JSON.parse(text) as { bookings: { id: string }[] }).bookings[0]!.id;
  });

  afterAll(async () => {
    await sql(`delete from channel_hotels where hotel_id = ${HOTEL}`);
    await sql(`delete from hotel_bank_details where hotel_id = ${HOTEL}`);
    await sql("delete from group_settings");
    const restore = async (table: string, rows: Record<string, unknown>[]) => {
      for (const row of rows) {
        const cols = Object.keys(row);
        await sql(`insert into ${table} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
          cols.map((c) => row[c]));
      }
    };
    await restore("group_settings", was["group"]!);
    await restore("hotel_bank_details", was["bank"]!);
    await restore("channel_hotels", was["channel"]!);
    await sql("update hotels set reservations_contact = $1, house_policies = $2 where code = '5EL'",
      [was["hotel"]![0]!["reservations_contact"], was["hotel"]![0]!["house_policies"]]);
    await sql("delete from guest_links where reservation_id = $1", [byBooker]);
    await sql("delete from folios where reservation_id = $1", [byBooker]).catch(() => {});
    await sql("delete from reservations where id = $1", [byBooker]).catch(() => {});
    await sql("delete from staff_hotels where staff_id = $1", [booker]);
    await sql("update staff set is_active = false where id = $1", [booker]);
  });

  it("the hotel's reservations contact, or nothing", async () => {
    expect((await facts(confirmed))["contact"]).toBeNull();
    await sql("update hotels set reservations_contact = 'Meera Kulkarni' where code = '5EL'");
    expect((await facts(confirmed))["contact"]).toBe("Meera Kulkarni");
  });

  it("the hotel's house policies, in its order: the reference's four to begin with, none once emptied", async () => {
    await sql("update hotels set house_policies = default where code = '5EL'");
    expect((await facts(confirmed))["housePolicies"]).toEqual(FOUR);
    await sql("update hotels set house_policies = array['Pets are welcome.', 'No smoking in the rooms.'] where code = '5EL'");
    expect((await facts(confirmed))["housePolicies"]).toEqual(["Pets are welcome.", "No smoking in the rooms."]);
    await sql("update hotels set house_policies = '{}' where code = '5EL'");
    expect((await facts(confirmed))["housePolicies"]).toEqual([]);
  });

  it("the hotel's bank details when set, null when not", async () => {
    expect((await facts(confirmed))["bank"]).toBeNull();
    await sql(
      `insert into hotel_bank_details (hotel_id, account_name, account_number, bank_name, branch, ifsc, upi_id)
       select id, 'Test Hotels Private Limited', '000011112222', 'Test Bank', 'Akkalkot', 'TEST0001234', null
         from hotels where code = '5EL'`);
    expect((await facts(confirmed))["bank"]).toEqual({
      accountName: "Test Hotels Private Limited", accountNumber: "000011112222",
      bankName: "Test Bank", branch: "Akkalkot", ifsc: "TEST0001234", upi: null,
    });
  });

  it("the group's office details, each null until typed", async () => {
    expect((await facts(confirmed))["group"]).toBeNull();
    await sql("insert into group_settings (name) values ('Test Group')");
    expect((await facts(confirmed))["group"]).toEqual({
      name: "Test Group", address: null, phone: null, email: null, website: null, gstin: null, instagram: null,
    });
    await sql(
      `update group_settings set office_address = '1 Office Road, Pune', phone = '+91 20 0000 0000',
              email = 'office@example.test', website = 'www.example.test',
              gstin = '27AAAAA0000A1Z5', instagram = '@testgroup'`);
    expect((await facts(confirmed))["group"]).toEqual({
      name: "Test Group", address: "1 Office Road, Pune", phone: "+91 20 0000 0000",
      email: "office@example.test", website: "www.example.test",
      gstin: "27AAAAA0000A1Z5", instagram: "@testgroup",
    });
    /* And the old key beside it still says what it said. */
    expect((await facts(confirmed))["groupName"]).toBe("Test Group");
  });

  it("what the booking's bills have received, from the ledger: a reversed payment is not money held", async () => {
    expect((await facts(confirmed))["payment"]).toEqual({ received: 0, billTo: "guest" });
    try {
    /* An advance, as the ledger holds one: a payment line on the booking's bill
       (this is about the read, so the line is written straight in). */
    await sql(
      `insert into folio_postings (hotel_id, folio_id, reservation_id, business_date, category, description, amount, posted_by)
       select f.hotel_id, f.id, f.reservation_id, app.business_date(f.hotel_id), 'payment', 'UPI', -2000, $2
         from folios f where f.reservation_id = $1`, [confirmed, owner]);
    expect((await facts(confirmed))["payment"]).toEqual({ received: 2000, billTo: "guest" });

    /* The payment reversed: its own line and the reversal both leave the sum. */
    await sql(
      `insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount, reverses_id, reservation_id)
       select hotel_id, folio_id, business_date, category, 'Reversal', -amount, id, reservation_id
         from folio_postings where reservation_id = $1 and category = 'payment' and reverses_id is null`,
      [confirmed]);
    expect((await facts(confirmed))["payment"]).toEqual({ received: 0, billTo: "guest" });
    } finally {
      /* The ledger is append-only; a test's own lines are taken out the way
         guards.test.ts takes out its own. */
      await sql("alter table folio_postings disable trigger folio_postings_append_only");
      try {
        await sql("delete from folio_postings where reservation_id = $1 and category = 'payment'", [confirmed]);
      } finally {
        await sql("alter table folio_postings enable trigger folio_postings_append_only");
      }
    }
  });

  it("whom the bill is made out to: a company's booking says so", async () => {
    const [company] = await sql<{ id: string }>(
      `insert into companies (name) values ('${tag} Company') returning id::text`);
    await sql("update folios set bill_to = 'company', company_id = $2 where reservation_id = $1",
      [confirmed, company!.id]);
    try {
      expect((await facts(confirmed))["payment"]["billTo"]).toBe("company");
    } finally {
      await sql("update folios set bill_to = 'guest', company_id = null where reservation_id = $1", [confirmed]);
      await sql("delete from companies where id = $1", [company!.id]);
    }
  });

  it("who booked: the person; its source for a booking a machine's account made; nothing with no record", async () => {
    expect((await facts(byBooker))["bookedBy"]).toBe(`${tag} Booker`);

    /* The same account as the channel manager's own: the booking came from a site. */
    await sql(
      `insert into channel_hotels (hotel_id, su_hotel_id, run_as) select id, 'VV-TEST', $1 from hotels where code = '5EL'`,
      [booker]);
    expect((await facts(byBooker))["bookedBy"]).toBe(source.name);
    await sql(`delete from channel_hotels where hotel_id = ${HOTEL}`);

    await sql("delete from audit_log where table_name = 'reservations' and row_id = $1 and action = 'INSERT'", [byBooker]);
    expect((await facts(byBooker))["bookedBy"]).toBeNull();
  });

  it("the extra guests in a room, by the tariff's own count", async () => {
    const three = (await facts(byBooker))["rooms"][0];
    const [tariff] = await sql<{ extra_adults: number; extra_children: number }>(
      `select t.extra_adults, t.extra_children
         from reservations r, app.tariff_for(r.room_type_id, r.meal_plan, r.check_in, r.adults::int, r.children::int) t
        where r.id = $1`, [byBooker]);
    expect([three.extraAdults, three.extraChildren]).toEqual([tariff!.extra_adults, tariff!.extra_children]);
    expect(three.extraAdults, "three adults in a room priced for two").toBe(1);
    const two = (await facts(confirmed))["rooms"][0];
    expect([two.extraAdults, two.extraChildren]).toEqual([0, 0]);
    /* The keys the room had are all still there. */
    expect(Object.keys(three).sort()).toEqual([
      "adults", "children", "complimentary", "extraAdults", "extraChildren", "gstRate",
      "mealPlan", "nights", "rate", "roomType"]);
  });

  it("is 168's function with lines added and none changed (MEMORY 317)", () => {
    const lines = (file: string) => {
      const text = readFileSync(new URL(`../../../../db/migrations/${file}`, import.meta.url), "utf8")
        .replace(/\r\n/g, "\n");
      const from = text.indexOf("create or replace function app.guest_voucher(");
      return text.slice(from, text.indexOf("$fn$;", from) + 5).split("\n");
    };
    const now = lines("169_the_voucher_to_the_reference.sql");
    const old = lines("168_the_hotels_own_profile.sql");
    /* Every old line, in order: what is left of 169 once its additions are skipped. */
    let at = 0;
    const missing = old.filter((line) => {
      const found = now.indexOf(line, at);
      if (found < 0) return true;
      at = found + 1;
      return false;
    });
    expect(missing, "lines of 168's function that 169's no longer has, in order").toEqual([]);
    expect(now.length).toBeGreaterThan(old.length);
  });
});
