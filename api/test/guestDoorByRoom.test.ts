import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { app } from "../src/server.ts";
import { closePool } from "../src/db.ts";
import { forgetKnocksForTests } from "../src/routes/guestDoor.ts";

/* ══════════════════════════════════════════════════════════════════
   THE ROOM AND THE PHONE (D27-235 2.4), through the door

   A guest staying now types their room number and their phone number; the
   WhatsApp code goes only to the BOOKING's own number, and only when both
   match. Every answer reads the same, matched or not - the body, the status,
   the length of the ticket - so the door is no "is this number in room 101"
   oracle. Limits per address and per booking; over them, the same answer.

   Everything is made at a property this file provisions and removes.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";
const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

const CODE = `RP${String(process.pid).slice(-1)}${String(process.pid).slice(-2, -1)}`;
const PHONE = "+91 91234 56780";
let hotelId: string;
let stay: string;

type Sent = { channel: string; kind: string; to: { phone: string | null }; data: Record<string, string> };

/* The one door out, stood in for by a local receiver (guestDoor.test.ts's way). */
async function withReceiver<T>(fn: (seen: Sent[]) => Promise<T>): Promise<T> {
  const { createServer } = await import("node:http");
  const seen: Sent[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => { seen.push(JSON.parse(raw)); res.writeHead(200).end("ok"); });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as { port: number }).port;
  process.env["CRS_N8N_URL"] = `http://127.0.0.1:${port}/pms-send`;
  process.env["CRS_N8N_SECRET"] = "only-this-test-run-knows-this";
  process.env["WHATSAPP_PHONE_NUMBER_ID"] = "100000000000001";
  try { return await fn(seen); } finally {
    for (const k of ["CRS_N8N_URL", "CRS_N8N_SECRET", "WHATSAPP_PHONE_NUMBER_ID"]) delete process.env[k];
    await new Promise<void>((done) => server.close(() => done()));
  }
}

const post = (path: string, body: unknown, ip = "203.0.113.7") =>
  app.request(`/api/guest${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": ip },
    body: JSON.stringify(body),
  });

const send = (room: string, phone: string, ip?: string) =>
  post("/by-room/send", { hotel: CODE, room, phone }, ip);

/* The code is sent without awaiting it (so a match is not slower than a
   mismatch): wait for it to arrive, or long enough to be sure none will. */
const settle = () => new Promise((done) => setTimeout(done, 1500));
const arrived = (seen: Sent[], n: number) =>
  vi.waitFor(() => expect(seen).toHaveLength(n), { timeout: 8000, interval: 100 });

beforeAll(async () => {
  const owner = (await sql("select id::text from staff where email = 'owner@fidato.in'")).rows[0].id as string;
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  await db.query("select set_config('app.user_id', $1, false)", [owner]);
  hotelId = (await db.query("select app.provision_property_unchecked($1,'Room Phone API','Nowhere')::text as id",
    [CODE])).rows[0].id;
  await db.query("select app.bulk_create_rooms($1, 'STD', 1::smallint, 101, 102)", [hotelId]);
  const guest = (await db.query("insert into guests (full_name, phone) values ('RPTEST Guest', $1) returning id::text",
    [PHONE])).rows[0].id;
  stay = (await db.query(
    `insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate, status)
     values ($1, app.next_reference($1), $2, (select id from room_types where hotel_id = $1 limit 1),
             app.business_date($1), app.business_date($1) + 2, 2000, 'checked_in') returning id::text`,
    [hotelId, guest])).rows[0].id;
  await db.query(
    `insert into room_assignments (hotel_id, reservation_id, room_id, from_date, to_date, reason)
     select $1, $2, id, app.business_date($1), app.business_date($1) + 2, 'arrival'
       from rooms where hotel_id = $1 and number = '101'`, [hotelId, stay]);
  await db.end();
});

beforeEach(async () => {
  forgetKnocksForTests();
  await sql("delete from guest_links where hotel_id = $1", [hotelId]);
});

afterAll(async () => {
  await sql("delete from guest_links where hotel_id = $1", [hotelId]);
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  await db.query("alter table hotels disable trigger hotels_no_delete");
  await db.query("delete from hotels where id = $1", [hotelId]);
  await db.query("alter table hotels enable trigger hotels_no_delete");
  await db.end();
  await closePool();
});

describe("the room and the phone (D27-235 2.4)", () => {
  it("answers a match and a mismatch the same, and sends only to the booking's own number", async () => {
    await withReceiver(async (seen) => {
      const right = await send("101", "91234 56780");
      const wrong = await send("101", "91234 56781");
      const empty = await send("102", "91234 56780");
      const answers = await Promise.all([right, wrong, empty].map(async (r) => ({ status: r.status, body: await r.json() as Record<string, unknown> })));
      const shape = (a: { status: number; body: Record<string, unknown> }) =>
        ({ status: a.status, keys: Object.keys(a.body).sort(), message: a.body["message"],
           ticketLength: String(a.body["ticket"]).length });
      expect(shape(answers[1]!)).toEqual(shape(answers[0]!));
      expect(shape(answers[2]!)).toEqual(shape(answers[0]!));
      await arrived(seen, 1);
      await settle();
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ channel: "whatsapp", kind: "guest-link-code", to: { phone: PHONE } });
    });
  });

  it("opens the stay with the ticket and the code, and the page is unlocked on this phone", async () => {
    await withReceiver(async (seen) => {
      const { ticket } = await (await send("101", "+91 9123456780")).json() as { ticket: string };
      await arrived(seen, 1);
      const opened = await post("/by-room/open", { ticket, code: seen[0]!.data["code"] });
      const body = await opened.json() as { verified: boolean; unlock: string };
      expect(body.verified).toBe(true);
      const page = await app.request(`/api/guest/${ticket}`, { headers: { authorization: `Guest ${body.unlock}` } });
      expect((await page.json() as { verified: boolean }).verified).toBe(true);
    });
  });

  it("refuses a ticket that matched nothing exactly as it refuses a wrong code", async () => {
    await withReceiver(async () => {
      const { ticket: real } = await (await send("101", "9123456780")).json() as { ticket: string };
      const { ticket: none } = await (await send("101", "9123456789")).json() as { ticket: string };
      await settle();
      const a = await post("/by-room/open", { ticket: real, code: "000000" });
      const b = await post("/by-room/open", { ticket: none, code: "000000" });
      const c = await post("/by-room/open", { ticket: none, code: "12" });
      expect([b.status, await b.json()]).toEqual([a.status, await a.json()]);
      expect(c.status).toBe(a.status);
    });
  });

  it("sends nothing past five tries an hour from one address, and says the same", async () => {
    await withReceiver(async (seen) => {
      for (let i = 0; i < 5; i++) await send("102", "9123456780", "198.51.100.9");
      const sixth = await send("101", "9123456780", "198.51.100.9");
      const first = await send("101", "9123456781", "198.51.100.10");
      await settle();
      expect(seen).toHaveLength(0);
      expect(Object.keys(await sixth.json() as object).sort()).toEqual(Object.keys(await first.json() as object).sort());
    });
  });

  it("says plainly when nothing can be sent, the same for every room", async () => {
    const a = await (await send("101", "9123456780")).json() as { sent: boolean; message: string };
    const b = await (await send("102", "9123456780")).json() as { sent: boolean; message: string };
    expect(a).toEqual(b);
    expect(a.sent).toBe(false);
    const links = await sql("select count(*)::int as n from guest_links where hotel_id = $1", [hotelId]);
    expect(links.rows[0].n).toBe(0);
  });
});
