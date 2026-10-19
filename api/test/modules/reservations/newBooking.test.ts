import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { app } from "../../../src/server.ts";
import { closePool, withUser } from "../../../src/db.ts";
import { sendIfOwed, messageFor, NOT_OWED, KIND } from "../../../src/modules/guest-messaging/jobs.ts";

/* ══════════════════════════════════════════════════════════════════
   NEW BOOKING, PHASE 1 (D27-33) - every rule the server holds

   The screen only reflects these; the server decides, and a refusal leaves
   nothing behind (MEMORY 243). Each test counts what is IN THE DATABASE
   afterwards, not only what the route answered.

     complimentary      the owner, an administrator or the GM; refused for
                        reception, with no guest and no booking written
     the discount       10% by hand with a reason; more only by a named
                        promotion (D27-36); it lowers the one nightly rate
                        the audit posts, so the bill follows by itself
     waiting            holds the room, is owed no message, and the voucher
                        is refused until somebody confirms it (D27-35)
     the voucher        once: the desk's second press is refused, and the
                        sweep's own sender will not send it again either
     the two lists      kept by the owner, an administrator or the GM
     the rest           title, nationality, address, company billed, the
                        hour they leave, sales person and segment, stored
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const TAG = "P1NB";
const SECRET = "a-secret-that-exists-only-in-this-test-run";

let hotelId: string;
let ownerId: string;
let typeId: string;
let source: string;
let companyId: string;
const staff = new Map<string, string>();

let server: Server;
let received: Array<{ kind: string; channel: string; sentBy: string | null }> = [];

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Client({ connectionString: SUPER });
  await db.connect();
  try { return await db.query(text, params); } finally { await db.end(); }
};

const person = async (role: string) => {
  const { rows } = await sql(
    `insert into staff (email, full_name, firebase_uid)
     values ($1, $2, $3)
     on conflict (email) do update set is_active = true, full_name = excluded.full_name
     returning id::text`,
    [`p1nb-${role}@fidato.in`, `${TAG} ${role}`, `test-uid-p1nb-${role}`]);
  const id = rows[0].id as string;
  await sql("delete from staff_hotels where staff_id = $1", [id]);
  await sql(`insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)`,
    [id, hotelId, role]);
  return id;
};

const call = (who: string, method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method,
    headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** A one-room booking two years out, at a typed rate: no calendar price is
    assumed, and none is invented. */
const booking = (name: string, over: Record<string, unknown> = {}) => ({
  guestName: `${TAG} ${name}`, phone: "9811100000", email: "p1nb@example.test",
  checkIn: "2029-05-10", checkOut: "2029-05-12", bookingSourceId: source,
  lines: [{ roomTypeId: typeId, mealPlan: "EP", adults: 2, children: 0, rooms: 1, agreedRate: 4000 }],
  ...over,
});

type Made = { ok: true; status: string; bookings: { id: string; reference: string; rate: number }[] };

/** The server's sentence on a refusal. */
const reasonOf = async (res: Response) => ((await res.json()) as { reason: string }).reason;

const onFile = async (name: string) => {
  const { rows } = await sql(
    `select (select count(*) from guests where full_name = $1)::int as guests,
            count(r.id)::int as reservations
       from reservations r join guests g on g.id = r.guest_id
      where g.full_name = $1`, [`${TAG} ${name}`]);
  return rows[0] as { guests: number; reservations: number };
};

const row = async (id: string) => (await sql(
  `select r.status, r.agreed_rate::text, r.is_complimentary, r.discount_percent::text,
          r.discount_reason, r.room_promotion_id::text, r.company_id::text,
          r.expected_departure::text, r.sales_person, r.market_segment,
          r.notes, r.special_request, r.is_single_lady, r.campaign,
          g.title, g.nationality, gd.address_line, gd.city, gd.state, gd.pincode, gd.country
     from reservations r join guests g on g.id = r.guest_id
     left join guest_documents gd on gd.guest_id = g.id
    where r.id = $1`, [id])).rows[0];

const sentAbout = async (id: string) => (await sql(
  `select status, sent_by::text from messages_sent
    where about_kind = 'reservation' and about_id = $1 and kind = 'booking-confirmation'`,
  [id])).rows as Array<{ status: string; sent_by: string | null }>;

beforeAll(async () => {
  ownerId = (await sql("select id::text from staff where email = 'owner@fidato.in'")).rows[0].id;
  hotelId = (await sql("select id::text from hotels where code = '5EL'")).rows[0].id;
  typeId = (await sql(
    `select id::text from room_types where hotel_id = $1 and is_active
      order by sort_order limit 1`, [hotelId])).rows[0].id;
  source = (await sql(
    "select id::text from booking_sources where is_active order by name limit 1")).rows[0].id;
  companyId = (await sql(
    `insert into companies (name) values ($1) returning id::text`, [`${TAG} Tata Travel`])).rows[0].id;
  for (const role of ["front_desk", "gm"]) staff.set(role, await person(role));

  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      if (req.headers["x-fidato-secret"] !== SECRET) { res.writeHead(401).end(); return; }
      received.push(JSON.parse(raw));
      res.writeHead(200).end("sent");
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
});

beforeEach(() => {
  received = [];
  process.env["CRS_N8N_URL"] = process.env["M2R_N8N_URL"] = `http://127.0.0.1:${(server.address() as AddressInfo).port}/pms-send`;
  process.env["WHATSAPP_PHONE_NUMBER_ID"] = "100000000000001";
  process.env["CRS_N8N_SECRET"] = process.env["M2R_N8N_SECRET"] = SECRET;
});

afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  delete process.env["CRS_N8N_URL"];
  delete process.env["M2R_N8N_URL"];
  delete process.env["CRS_N8N_SECRET"];
  delete process.env["M2R_N8N_SECRET"];
  const { rows } = await sql(
    `select r.id::text from reservations r join guests g on g.id = r.guest_id
      where g.full_name like $1`, [`${TAG} %`]);
  const ids = rows.map((r) => r.id as string);
  await sql("delete from messages_sent where about_kind = 'reservation' and about_id = any($1::text[])", [ids]);
  await sql("delete from guest_links where reservation_id = any($1::uuid[])", [ids]);
  await sql("delete from folios where reservation_id = any($1::uuid[])", [ids]);
  await sql("delete from reservations where id = any($1::uuid[])", [ids]);
  await sql("delete from room_promotions where name like $1", [`${TAG} %`]);
  await sql("delete from sales_people where name like $1", [`${TAG} %`]);
  await sql("delete from companies where id = $1", [companyId]);
  await sql("alter table guests disable trigger guests_no_delete");
  try {
    await sql("delete from guests where full_name like $1", [`${TAG} %`]);
  } finally {
    await sql("alter table guests enable trigger guests_no_delete");
  }
  const ids2 = [...staff.values()];
  await sql("delete from staff_hotels where staff_id = any($1::uuid[])", [ids2]);
  await sql("update staff set is_active = false where id = any($1::uuid[])", [ids2]);
  expect((await sql("select count(*)::int as n from guests where full_name like $1",
    [`${TAG} %`])).rows[0].n).toBe(0);
  await closePool();
});

describe("a complimentary room", () => {
  it("is refused for reception, and nothing is written", async () => {
    const res = await call(staff.get("front_desk")!, "POST", "/bookings", booking("Comp refused", {
      lines: [{ roomTypeId: typeId, adults: 2, rooms: 1, complimentary: true }],
    }));
    expect(res.status).toBe(409);
    expect(await reasonOf(res)).toMatch(/owner, an administrator or the general manager/);
    expect(await onFile("Comp refused")).toEqual({ guests: 0, reservations: 0 });
  });

  it("is given by the GM at ₹0, with no discount on it", async () => {
    const res = await call(staff.get("gm")!, "POST", "/bookings", booking("Comp given", {
      lines: [{ roomTypeId: typeId, adults: 2, rooms: 1, complimentary: true }],
      discount: { percent: 10, reason: "Also asked" },
    }));
    expect(res.status).toBe(200);
    const made = (await res.json()) as Made;
    const r = await row(made.bookings[0]!.id);
    expect(r.is_complimentary).toBe(true);
    expect(r.agreed_rate).toBe("0.00");
    expect(r.discount_percent).toBeNull();
  });
});

describe("the discount (D27-36)", () => {
  it("over 10% by hand is refused, and nothing is written", async () => {
    const res = await call(ownerId, "POST", "/bookings", booking("Too much",
      { discount: { percent: 15, reason: "Friend of the owner" } }));
    expect(res.status).toBe(409);
    expect(await reasonOf(res)).toMatch(/named promotion/);
    expect(await onFile("Too much")).toEqual({ guests: 0, reservations: 0 });
  });

  it("by hand with no reason is refused", async () => {
    const res = await call(ownerId, "POST", "/bookings", booking("No reason",
      { discount: { percent: 5 } }));
    expect(res.status).toBe(409);
    expect(await onFile("No reason")).toEqual({ guests: 0, reservations: 0 });
  });

  it("10% with a reason lowers the nightly rate the audit will post", async () => {
    const res = await call(staff.get("front_desk")!, "POST", "/bookings", booking("Ten off",
      { discount: { percent: 10, reason: "Returning family" } }));
    expect(res.status).toBe(200);
    const made = (await res.json()) as Made;
    expect(made.bookings[0]!.rate).toBe(3600);
    const r = await row(made.bookings[0]!.id);
    expect([r.agreed_rate, r.discount_percent, r.discount_reason, r.room_promotion_id])
      .toEqual(["3600.00", "10.00", "Returning family", null]);
  });

  it("over 10% only through a named promotion, which the GM keeps", async () => {
    /* Kept on Money › Discounts since D27-259 (191). */
    const saved = await call(staff.get("gm")!, "POST", "/discounts",
      { name: `${TAG} Wedding`, percent: 25 });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const list = (await (await call(ownerId, "GET", "/room-promotions")).json()) as
      Array<{ id: string; name: string; percent: number }>;
    const promo = list.find((p) => p.name === `${TAG} Wedding`)!;
    expect(promo.percent).toBe(25);

    const res = await call(staff.get("front_desk")!, "POST", "/bookings", booking("Wedding",
      { discount: { promotionId: promo.id } }));
    expect(res.status).toBe(200);
    const r = await row(((await res.json()) as Made).bookings[0]!.id);
    expect([r.agreed_rate, r.discount_percent, r.room_promotion_id])
      .toEqual(["3000.00", "25.00", promo.id]);
  });
});

describe("waiting for the hotel (D27-35)", () => {
  it("holds the room, is owed no message, refuses the voucher, and is then confirmed", async () => {
    const res = await call(staff.get("front_desk")!, "POST", "/bookings",
      booking("Waiting", { tentative: true }));
    expect(res.status).toBe(200);
    const made = (await res.json()) as Made;
    const id = made.bookings[0]!.id;
    expect(made.status).toBe("tentative");
    expect((await row(id)).status).toBe("tentative");

    const due = await sql(
      `select 1 from app.guest_messages_due(null, 3, '10:00', '09:00', '21:00', $1)
        where reservation_id = $2`, [hotelId, id]);
    expect(due.rowCount).toBe(0);

    const voucher = await call(staff.get("front_desk")!, "POST", `/stays/${id}/confirmation`, {});
    expect(voucher.status).toBe(409);
    expect(await reasonOf(voucher)).toMatch(/waiting for the hotel/);
    expect(received).toHaveLength(0);
    expect(await sentAbout(id)).toHaveLength(0);

    const confirmed = await call(staff.get("front_desk")!, "POST", `/stays/${id}/confirm`, {});
    expect(confirmed.status).toBe(200);
    expect((await row(id)).status).toBe("confirmed");
    expect((await call(staff.get("front_desk")!, "POST", `/stays/${id}/confirm`, {})).status).toBe(409);
  });
});

describe("the voucher (D27-35)", () => {
  it("says so, and records nothing, when sending is switched off", async () => {
    const made = (await (await call(ownerId, "POST", "/bookings", booking("Switched off"))).json()) as Made;
    delete process.env["CRS_N8N_URL"];
    delete process.env["M2R_N8N_URL"];
    const res = await call(staff.get("front_desk")!, "POST",
      `/stays/${made.bookings[0]!.id}/confirmation`, {});
    expect(res.status).toBe(503);
    expect(await reasonOf(res)).toMatch(/Sending is not set up yet/);
    expect(await sentAbout(made.bookings[0]!.id)).toHaveLength(0);
  });

  it("goes once, with the clerk's name; the second press and the sweep send nothing", async () => {
    const made = (await (await call(ownerId, "POST", "/bookings", booking("Voucher"))).json()) as Made;
    const id = made.bookings[0]!.id;
    const clerk = staff.get("front_desk")!;

    const first = await call(clerk, "POST", `/stays/${id}/confirmation`, {});
    expect(first.status, await first.clone().text()).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ kind: "booking-confirmation", channel: "email" });
    expect(await sentAbout(id)).toEqual([{ status: "sent", sent_by: clerk }]);

    const second = await call(clerk, "POST", `/stays/${id}/confirmation`, {});
    expect(second.status).toBe(409);
    expect(await reasonOf(second)).toMatch(/sent once/);

    /* The sweep's own sender, as the server runs it - nobody signed in. */
    const sweep = await withUser("", (client) => sendIfOwed(client, messageFor({
      kind: KIND.confirmation, channel: "email", reservationId: id, reference: made.bookings[0]!.reference,
      hotel: { id: hotelId, code: "5EL", name: "5 Elements Akkalkot", phone: null },
      guest: { name: `${TAG} Voucher`, phone: null, email: "p1nb@example.test" },
      whatsappAgreed: false, checkIn: "2029-05-10", checkOut: "2029-05-12", nights: 2, held: false,
    }, "http://localhost/g/not-sent")!));
    expect(sweep).toEqual({ ok: false, reason: NOT_OWED });
    expect(received).toHaveLength(1);
    expect(await sentAbout(id)).toHaveLength(1);
  });
});

describe("the two lists (the owner, 27 September)", () => {
  it("reception may not change the sales people; the GM may, and a name taken off is switched off", async () => {
    const refused = await call(staff.get("front_desk")!, "PUT", "/sales-people",
      { names: [`${TAG} Intruder`] });
    expect(refused.status).toBe(403);
    expect((await sql("select count(*)::int as n from sales_people where name = $1",
      [`${TAG} Intruder`])).rows[0].n).toBe(0);

    expect((await call(staff.get("gm")!, "PUT", "/sales-people",
      { names: [`${TAG} Asha`, `${TAG} Ravi`] })).status).toBe(200);
    expect((await call(staff.get("gm")!, "PUT", "/sales-people",
      { names: [`${TAG} Asha`] })).status).toBe(200);
    const listed = (await (await call(staff.get("front_desk")!, "GET", "/sales-people")).json()) as
      Array<{ name: string }>;
    expect(listed.map((p) => p.name)).toContain(`${TAG} Asha`);
    expect(listed.map((p) => p.name)).not.toContain(`${TAG} Ravi`);
    expect((await sql("select is_active from sales_people where name = $1",
      [`${TAG} Ravi`])).rows).toEqual([{ is_active: false }]);
  });

  it("reception may not change the promotions", async () => {
    const res = await call(staff.get("front_desk")!, "POST", "/discounts",
      { name: `${TAG} Sneaky`, percent: 50 });
    expect(res.status).toBe(403);
  });
});

describe("a discount in rupees off each night (191, the owner's D27-259 Q4)", () => {
  /* Its own dates: the cancel test below counts the rooms left on 10 May. */
  const JUNE = { checkIn: "2029-06-10", checkOut: "2029-06-12" };

  it("by hand is at most 10% of the night, with a reason", async () => {
    const over = await call(ownerId, "POST", "/bookings", booking("Rupees over",
      { ...JUNE, discount: { amount: 500, reason: "Regular guest" } }));
    expect(over.status).toBe(409);
    expect(await reasonOf(over)).toMatch(/more than 10% of the night's ₹4000/);
    const res = await call(staff.get("front_desk")!, "POST", "/bookings", booking("Rupees off",
      { ...JUNE, discount: { amount: 400, reason: "Regular guest" } }));
    expect(res.status, await res.clone().text()).toBe(200);
    const made = (await res.json()) as Made;
    expect(made.bookings[0]!.rate).toBe(3600);
    const { rows: [r] } = await sql(
      "select discount_amount::text, discount_percent from reservations where id = $1",
      [made.bookings[0]!.id]);
    expect([r.discount_amount, r.discount_percent]).toEqual(["400.00", null]);
  });

  it("more only through a named promotion in rupees", async () => {
    const saved = await call(staff.get("gm")!, "POST", "/discounts",
      { name: `${TAG} Corporate 1500`, amount: 1500 });
    expect(saved.status, await saved.clone().text()).toBe(200);
    const promo = ((await (await call(ownerId, "GET", "/room-promotions")).json()) as
      Array<{ id: string; name: string; amount: number | null }>)
      .find((p) => p.name === `${TAG} Corporate 1500`)!;
    expect(promo.amount).toBe(1500);
    const res = await call(staff.get("front_desk")!, "POST", "/bookings", booking("Corporate",
      { ...JUNE, discount: { promotionId: promo.id } }));
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as Made).bookings[0]!.rate).toBe(2500);
  });
});

describe("what else New booking records", () => {
  it("title, nationality, address, the company billed, the hour they leave, sales person, segment, the note and the single-lady tick", async () => {
    const res = await call(staff.get("front_desk")!, "POST", "/bookings", booking("Everything", {
      title: "Mrs", nationality: "gb", companyId, expectedDeparture: "09:30",
      salesPerson: `${TAG} Asha`, marketSegment: "Leisure",
      /* D27-163: the one page's Notes box and the walk-in's tick. */
      notes: "  Late train, keep the room  ", isSingleLady: true,
      /* D27-347: the guest's own request, its own box, for the voucher. */
      specialRequest: "  A quiet room, high floor  ",
      /* D27-170: "Book this lead" keeps the lead's campaign (leads' 161). */
      campaign: "meta_120211234567890",
      address: { addressLine: "12 High St", city: "Leeds", state: "West Yorkshire",
                 pincode: "LS1 4AP", country: "United Kingdom" },
    }));
    expect(res.status).toBe(200);
    const made = (await res.json()) as Made;
    expect(made.bookings[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(made.status).toBe("confirmed");
    expect(await row(made.bookings[0]!.id)).toMatchObject({
      status: "confirmed", company_id: companyId, expected_departure: "09:30:00",
      sales_person: `${TAG} Asha`, market_segment: "Leisure", title: "Mrs", nationality: "GB",
      address_line: "12 High St", city: "Leeds", state: "West Yorkshire",
      pincode: "LS1 4AP", country: "United Kingdom",
      notes: "Late train, keep the room", is_single_lady: true, campaign: "meta_120211234567890",
      special_request: "A quiet room, high floor",
    });
  });

  it("refuses a special request over 500 characters in words", async () => {
    const res = await call(ownerId, "POST", "/bookings", booking("Long request", { specialRequest: "x".repeat(501) }));
    expect(res.status).toBe(409);
    expect(await res.text()).toContain("A special request is at most 500 characters.");
  });

  it("refuses a campaign over 200 characters in words, and writes nothing", async () => {
    const res = await call(ownerId, "POST", "/bookings", booking("Long campaign", { campaign: "x".repeat(201) }));
    expect(res.status).toBe(409);
    expect(await reasonOf(res)).toMatch(/at most 200 characters/);
    expect(await onFile("Long campaign")).toEqual({ guests: 0, reservations: 0 });
  });

  it("refuses a title that is not on the owner's list, and writes nothing", async () => {
    const res = await call(ownerId, "POST", "/bookings", booking("Sir", { title: "Sir" }));
    expect(res.status).toBe(409);
    expect(await onFile("Sir")).toEqual({ guests: 0, reservations: 0 });
  });

  /* The QA of 28 September, round D: BK-4 "ZZ" fed Form III; BK-3 a booking
     that "arrived" five days ago was confirmed; X-2 a phone "abc" and an
     email "not-an-email" were saved. 5EL's business date is 25 Aug 2026. */
  it.each([
    ["ZZ", { nationality: "ZZ" }, /"ZZ" is not a country code/],
    ["Past", { checkIn: "2026-08-20", checkOut: "2026-08-30" }, /before the hotel's business date, 2026-08-25/],
    ["Phone", { phone: "abc" }, /not a phone number/],
    ["Email", { email: "not-an-email" }, /not an email address/],
  ])("refuses %s, and writes nothing", async (name, over, why) => {
    const res = await call(ownerId, "POST", "/bookings", booking(name, over));
    expect(res.status).toBe(409);
    expect(await reasonOf(res)).toMatch(why);
    expect(await onFile(name)).toEqual({ guests: 0, reservations: 0 });
  });

  /* X-3: 0 adults reached the database's own check as a 500. */
  it("refuses a room for nobody in words, and writes nothing", async () => {
    const res = await call(ownerId, "POST", "/bookings", booking("Nobody",
      { lines: [{ roomTypeId: typeId, adults: 0, rooms: 1, agreedRate: 4000 }] }));
    expect(res.status).toBe(409);
    expect(await reasonOf(res)).toBe("Adults is a whole number from 1 to 99.");
    expect(await onFile("Nobody")).toEqual({ guests: 0, reservations: 0 });
  });
});

describe("cancelling a booking waiting for the hotel (D27-64)", () => {
  /* What the grid says is left of this room type on the booking's first
     night - the figure New booking and the channel manager read (044). */
  const left = async () => Number((await sql(
    `select min(available)::int as n from app.inventory_grid($1, '2029-05-10'::date, '2029-05-10'::date)
      where room_type_id = $2`, [hotelId, typeId])).rows[0].n);

  it("frees the room at once, charges nothing, sends nothing, and keeps the reason", async () => {
    const clerk = staff.get("front_desk")!;
    const made = (await (await call(clerk, "POST", "/bookings", booking("Cancel waiting",
      { tentative: true, lines: [{ roomTypeId: typeId, adults: 2, rooms: 2, agreedRate: 4000 }] }),
    )).json()) as Made;
    const [a, b] = made.bookings.map((x) => x.id);
    const held = await left();

    const noReason = await call(clerk, "POST", `/stays/${a}/cancel`, {});
    expect(noReason.status).toBe(409);
    expect((await row(a!)).status).toBe("tentative");

    const res = await call(clerk, "POST", `/stays/${a}/cancel`, { reason: "Hotel full that week" });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as { rooms: number }).rooms).toBe(2);

    /* Both rooms of the booking, as Confirm takes both; the grid gives both back. */
    for (const id of [a!, b!]) expect((await row(id)).status).toBe("cancelled");
    expect(await left()).toBe(held + 2);
    const kept = (await sql(
      "select cancel_reason, cancelled_by::text from reservations where id = $1", [a])).rows[0];
    expect(kept).toEqual({ cancel_reason: "Hotel full that week", cancelled_by: clerk });

    /* No charge: nothing on either folio. Nothing owed, nothing sent. */
    expect((await sql(
      `select count(*)::int as n from folio_postings p join folios f on f.id = p.folio_id
        where f.reservation_id = any($1::uuid[])`, [[a, b]])).rows[0].n).toBe(0);
    expect((await sql(
      `select count(*)::int as n from app.guest_messages_due(null, 3, '10:00', '09:00', '21:00', $1)
        where reservation_id = any($2::uuid[])`, [hotelId, [a, b]])).rows[0].n).toBe(0);
    expect(await sentAbout(a!)).toHaveLength(0);
    expect(received).toHaveLength(0);
  });

  /* A CONFIRMED booking is cancelled too since BK-1 (28 September) - one
     room, under its terms (cancelConfirmed.test.ts) - never its whole group
     as a waiting one is. */
  it("cancels one room of a confirmed booking, and leaves the other", async () => {
    const made = (await (await call(ownerId, "POST", "/bookings", booking("Cancel confirmed",
      { lines: [{ roomTypeId: typeId, adults: 2, rooms: 2, agreedRate: 4000 }] }))).json()) as Made;
    const [a, b] = made.bookings.map((x) => x.id);
    const res = await call(staff.get("front_desk")!, "POST", `/stays/${a}/cancel`, { reason: "Changed plans" });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await row(a!)).status).toBe("cancelled");
    expect((await row(b!)).status).toBe("confirmed");
  });
});
