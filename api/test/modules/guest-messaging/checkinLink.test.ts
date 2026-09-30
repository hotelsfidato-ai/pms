import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   SEND CHECK-IN LINK (D27-105) - the guest's page, on its own

   A confirmed booking's own page goes the guest's way (email here: the
   booking is not ticked for WhatsApp), with the clerk's name on the
   record. A second press is a second message, with its own id - the
   workflow would drop a repeated id, and the clerk meant it. A booking
   waiting for the hotel sends nothing and records nothing.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const TAG = "CKLK";
const SECRET = "a-secret-that-exists-only-in-this-test-run";

let hotelId: string;
let ownerId: string;
let typeId: string;
let source: string;
let clerk: string;
let server: Server;
let received: Array<{ messageId: string; kind: string; channel: string; sentBy: string | null;
  to: { email: string | null }; data: { link: string; reference: string } }> = [];

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Client({ connectionString: SUPER });
  await db.connect();
  try { return await db.query(text, params); } finally { await db.end(); }
};

const call = (who: string, method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method,
    headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const book = async (name: string, over: Record<string, unknown> = {}) => {
  const res = await call(ownerId, "POST", "/bookings", {
    guestName: `${TAG} ${name}`, phone: "9811100000", email: "cklk@example.test",
    checkIn: "2029-06-10", checkOut: "2029-06-12", bookingSourceId: source,
    lines: [{ roomTypeId: typeId, mealPlan: "EP", adults: 2, children: 0, rooms: 1, agreedRate: 4000 }],
    ...over,
  });
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as { bookings: { id: string; reference: string }[] }).bookings[0]!;
};

const recorded = async (id: string) => (await sql(
  `select status, channel, sent_by::text from messages_sent
    where about_kind = 'reservation' and about_id = $1 and kind = 'checkin-link'`,
  [id])).rows as Array<{ status: string; channel: string; sent_by: string | null }>;

beforeAll(async () => {
  ownerId = (await sql("select id::text from staff where email = 'owner@fidato.in'")).rows[0].id;
  hotelId = (await sql("select id::text from hotels where code = '5EL'")).rows[0].id;
  typeId = (await sql(
    `select id::text from room_types where hotel_id = $1 and is_active
      order by sort_order limit 1`, [hotelId])).rows[0].id;
  source = (await sql(
    "select id::text from booking_sources where is_active order by name limit 1")).rows[0].id;
  clerk = (await sql(
    `insert into staff (email, full_name, firebase_uid)
     values ('cklk-desk@fidato.in', '${TAG} Desk', 'test-uid-cklk-desk')
     on conflict (email) do update set is_active = true returning id::text`)).rows[0].id;
  await sql("delete from staff_hotels where staff_id = $1", [clerk]);
  await sql("insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, 'front_desk')",
    [clerk, hotelId]);

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
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/pms-send`;
  process.env["CRS_N8N_URL"] = process.env["M2R_N8N_URL"] = url;
  process.env["CRS_N8N_SECRET"] = process.env["M2R_N8N_SECRET"] = SECRET;
  process.env["WHATSAPP_PHONE_NUMBER_ID"] = "100000000000001";
});

afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  for (const name of ["CRS_N8N_URL", "M2R_N8N_URL", "CRS_N8N_SECRET", "M2R_N8N_SECRET",
    "WHATSAPP_PHONE_NUMBER_ID"]) delete process.env[name];
  const ids = (await sql(
    `select r.id::text from reservations r join guests g on g.id = r.guest_id
      where g.full_name like $1`, [`${TAG} %`])).rows.map((r) => r.id as string);
  await sql("delete from messages_sent where about_kind = 'reservation' and about_id = any($1::text[])", [ids]);
  await sql("delete from guest_links where reservation_id = any($1::uuid[])", [ids]);
  await sql("delete from folios where reservation_id = any($1::uuid[])", [ids]);
  await sql("delete from reservations where id = any($1::uuid[])", [ids]);
  await sql("alter table guests disable trigger guests_no_delete");
  try {
    await sql("delete from guests where full_name like $1", [`${TAG} %`]);
  } finally {
    await sql("alter table guests enable trigger guests_no_delete");
  }
  await sql("delete from staff_hotels where staff_id = $1", [clerk]);
  await sql("update staff set is_active = false where id = $1", [clerk]);
  await closePool();
});

describe("Send check-in link (D27-105)", () => {
  it("sends the booking's own page the guest's way, with the clerk's name", async () => {
    const b = await book("Sent");
    const res = await call(clerk, "POST", `/stays/${b.id}/checkin-link`, {});
    expect(res.status, await res.clone().text()).toBe(200);

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ kind: "checkin-link", channel: "email", sentBy: `${TAG} Desk` });
    expect(received[0]!.data.link).toMatch(/\/g\/[A-Za-z0-9_-]{40,}$/);
    expect(received[0]!.data.reference).toBe(b.reference);
    expect(await recorded(b.id)).toEqual([{ status: "sent", channel: "email", sent_by: clerk }]);
  });

  it("sends it again when pressed again, as a new message with its own id", async () => {
    const b = await book("Twice");
    expect((await call(clerk, "POST", `/stays/${b.id}/checkin-link`, {})).status).toBe(200);
    expect((await call(clerk, "POST", `/stays/${b.id}/checkin-link`, {})).status).toBe(200);
    expect(received).toHaveLength(2);
    expect(received[0]!.messageId).not.toBe(received[1]!.messageId);
    expect(received[0]!.data.link, "a fresh page each time").not.toBe(received[1]!.data.link);
    expect(await recorded(b.id)).toHaveLength(2);
  });

  it("sends nothing for a booking waiting for the hotel, and records nothing", async () => {
    const b = await book("Waiting", { tentative: true });
    const res = await call(clerk, "POST", `/stays/${b.id}/checkin-link`, {});
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toMatch(/waiting for the hotel/);
    expect(received).toHaveLength(0);
    expect(await recorded(b.id)).toHaveLength(0);
  });

  /* D27-171, D27-172: the voucher email carries the voucher, a PDF in the
     CRS's design, made from this booking's own figures. */
  it("sends the booking's voucher PDF with the voucher's email", async () => {
    const b = await book("Voucher PDF");
    const res = await call(clerk, "POST", `/stays/${b.id}/confirmation`, {});
    expect(res.status, await res.clone().text()).toBe(200);
    const sent = received[0] as unknown as { kind: string; channel: string;
      file?: { name: string; contentType: string; base64: string } };
    expect(sent).toMatchObject({ kind: "booking-confirmation", channel: "email" });
    expect(sent.file?.name).toBe(`Voucher-${b.reference.replace(/[^A-Za-z0-9-]/g, "")}.pdf`);
    expect(sent.file?.contentType).toBe("application/pdf");
    expect(Buffer.from(sent.file!.base64, "base64").subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("says so, and records nothing, when sending is switched off", async () => {
    const b = await book("Off");
    delete process.env["CRS_N8N_URL"];
    const res = await call(clerk, "POST", `/stays/${b.id}/checkin-link`, {});
    expect(res.status).toBe(503);
    expect(await recorded(b.id)).toHaveLength(0);
  });
});
