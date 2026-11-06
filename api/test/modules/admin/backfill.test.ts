import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   BACKFILL DATA - the owner's D27-398 (migration "backfill data")

   Settings → Backfill data: what happened before a hotel's first day, in a
   register of its own. Who may (the owner, an Admin and the GM write; the
   Accountant reads; reception never), the date rule, one room a night, a
   dash for a figure nobody typed, the send tick sending once, a removal
   kept, and the live ledgers untouched. Everything is tagged BKF; the days
   used are 40 to 30 days before 5EL's first day, which nothing else uses.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "BKF";
const SECRET = "backfill-test-secret";

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const as = (who: string, method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method,
    headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const people: Record<string, string> = {};
let hotel = "";
let first = "";
let room1 = "";
let room2 = "";
let room1Number = "";
let returning = "";
let server: Server;
let received: Array<{ kind: string; channel: string; to: { email: string | null }; data: Record<string, string> }> = [];

const day = (offset: number) => {
  const d = new Date(`${first}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

const stay = (over: Record<string, unknown> = {}) => ({
  guestName: `${TAG} Asha`, phone: "", email: "", nationality: "IN",
  idType: "driving_licence", idNumber: "DL0420110012345", roomId: room1,
  arrival: day(-40), departure: day(-38), adults: 2, children: 0, ...over,
});

type View = {
  firstDay: string; mayWrite: boolean; showsId: boolean; sending: { ok: boolean; reason: string | null };
  stays: Array<Record<string, unknown> & { id: string; guestId: string; message: { status: string } | null }>;
  bills: Array<Record<string, unknown> & { id: string }>;
  cash: Array<Record<string, unknown> & { id: string }>;
};
const view = async (who = people["gm"]!) => (await (await as(who, "GET", "/backfill")).json()) as View;

beforeAll(async () => {
  hotel = (await sql<{ id: string }>("select id::text from hotels where code = '5EL'"))[0]!.id;
  first = (await sql<{ d: string }>("select app.backfill_first_day($1)::text as d", [hotel]))[0]!.d;
  const rooms = await sql<{ id: string; number: string }>(
    "select id::text, number from rooms where hotel_id = $1 and is_active order by number limit 2", [hotel]);
  room1 = rooms[0]!.id; room1Number = rooms[0]!.number; room2 = rooms[1]!.id;
  people["owner"] = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  for (const role of ["admin", "gm", "hotel_manager", "front_desk", "finance"]) {
    const [p] = await sql<{ id: string }>(
      `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
       on conflict (email) do update set is_active = true returning id::text`,
      [`bkf-${role}@fidato.in`, `${TAG} ${role}`, `test-uid-bkf-${role}`]);
    people[role] = p!.id;
    await sql("delete from staff_hotels where staff_id = $1", [p!.id]);
    await sql("insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)", [p!.id, hotel, role]);
  }
  returning = (await sql<{ id: string }>(
    "insert into guests (full_name, phone) values ($1, '9811100398') returning id::text", [`${TAG} Returning`]))[0]!.id;

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

beforeEach(() => { received = []; });

const setUpSending = () => {
  process.env["CRS_N8N_URL"] = `http://127.0.0.1:${(server.address() as AddressInfo).port}/pms-send`;
  process.env["CRS_N8N_SECRET"] = SECRET;
  process.env["WHATSAPP_PHONE_NUMBER_ID"] = "100000000000001";
};
const noSending = () => {
  for (const name of ["CRS_N8N_URL", "CRS_N8N_SECRET", "WHATSAPP_PHONE_NUMBER_ID"]) delete process.env[name];
};

afterAll(async () => {
  noSending();
  await new Promise<void>((done) => server.close(() => done()));
  await sql("delete from messages_sent where about_kind = 'backfill-stay'");
  await sql("delete from backfill_stays where hotel_id = $1", [hotel]);
  await sql("delete from backfill_restaurant_bills where hotel_id = $1", [hotel]);
  await sql("delete from backfill_cash where hotel_id = $1", [hotel]);
  await sql("alter table guests disable trigger guests_no_delete");
  await sql("delete from guests where full_name like $1", [`${TAG} %`]);
  await sql("alter table guests enable trigger guests_no_delete");
  const ids = Object.entries(people).filter(([r]) => r !== "owner").map(([, id]) => id);
  await sql("delete from staff_hotels where staff_id = any($1)", [ids]);
  await sql("update staff set is_active = false where id = any($1)", [ids]);
  await closePool();
});

describe("who may (D27-398)", () => {
  it("is refused to reception and the hotel manager, reading or writing, and nothing is written", async () => {
    for (const role of ["front_desk", "hotel_manager"]) {
      expect((await as(people[role]!, "GET", "/backfill")).status, role).toBe(403);
      const res = await as(people[role]!, "POST", "/backfill/cash",
        { cashDate: day(-35), direction: "in", amount: 500, purpose: `${TAG} advance`, person: "A guest" });
      expect(res.status, role).toBe(403);
    }
    expect(await sql("select 1 from backfill_cash where hotel_id = $1", [hotel])).toHaveLength(0);
  });

  it("lets the GM, the owner and an Admin add, and the Accountant only read - without the guests' ID numbers", async () => {
    for (const role of ["gm", "owner", "admin"]) {
      const res = await as(people[role]!, "POST", "/backfill/cash",
        { cashDate: day(-35), direction: "out", amount: 100, purpose: `${TAG} ${role}`, person: "Ramesh" });
      expect(res.status, `${role}: ${await res.clone().text()}`).toBe(200);
    }
    const add = await as(people["gm"]!, "POST", "/backfill/stays", stay({ arrival: day(-31), departure: day(-30) }));
    expect(add.status, await add.clone().text()).toBe(200);

    const refused = await as(people["finance"]!, "POST", "/backfill/cash",
      { cashDate: day(-35), direction: "in", amount: 1, purpose: `${TAG} acct`, person: "x" });
    expect(refused.status).toBe(403);
    const reads = await view(people["finance"]!);
    expect([reads.mayWrite, reads.showsId]).toEqual([false, false]);
    expect(reads.cash.filter((c) => String(c["purpose"]).startsWith(TAG))).toHaveLength(3);
    expect(reads.stays.every((s) => s["idNumber"] === null && s["visaNumber"] === null)).toBe(true);
    expect((await view()).stays.some((s) => s["idNumber"] === "DL0420110012345"), "the GM sees it").toBe(true);
  });
});

describe("the days it takes", () => {
  it("is only days before the hotel's first day, never a future one", async () => {
    const onFirst = await as(people["gm"]!, "POST", "/backfill/stays", stay({ arrival: first, departure: day(1) }));
    expect(onFirst.status).toBe(409);
    expect(await reasonOf(onFirst)).toMatch(/^Only days before the hotel's first day, .*use the normal screens\.$/);

    const stillIn = await as(people["gm"]!, "POST", "/backfill/stays", stay({ arrival: day(-1), departure: day(1) }));
    expect(await reasonOf(stillIn)).toMatch(/^A backfilled stay ends by the hotel's first day/);

    /* Never a future date: the database's own test covers a first day still
       to come; here a far one is past the first day too. */
    const future = await as(people["gm"]!, "POST", "/backfill/cash",
      { cashDate: "2099-01-01", direction: "in", amount: 1, purpose: `${TAG} later`, person: "x" });
    expect(await reasonOf(future)).toMatch(/^Only days before the hotel's first day/);
    expect(await sql("select 1 from backfill_cash where purpose = $1", [`${TAG} later`])).toHaveLength(0);

    const lastNight = await as(people["gm"]!, "POST", "/backfill/stays",
      stay({ roomId: room2, arrival: day(-1), departure: first }));
    expect(lastNight.status, "a guest who left on the first morning is backfilled").toBe(200);
  });
});

describe("a stay", () => {
  it("keeps a figure nobody typed empty - a dash, never a zero", async () => {
    const res = await as(people["gm"]!, "POST", "/backfill/stays", stay({ guestName: `${TAG} Dash` }));
    expect(res.status, await res.clone().text()).toBe(200);
    const s = (await view()).stays.find((x) => x["guestName"] === `${TAG} Dash`)!;
    expect([s["rate"], s["roomCharges"], s["gst"], s["otherCharges"], s["paid"], s["billNumber"]])
      .toEqual([null, null, null, null, null, null]);
  });

  it("refuses a second stay in the room on one of the nights, naming the first", async () => {
    const res = await as(people["gm"]!, "POST", "/backfill/stays",
      stay({ guestName: `${TAG} Clash`, arrival: day(-39), departure: day(-37) }));
    expect(res.status).toBe(409);
    expect(await reasonOf(res)).toBe(
      `Room ${room1Number} is already backfilled for ${TAG} Dash, ${words(day(-40))} to ${words(day(-38))}.`);
  });

  it("asks a foreign guest for the passport and the visa (Form III)", async () => {
    const res = await as(people["gm"]!, "POST", "/backfill/stays", stay({
      guestName: `${TAG} Visitor`, nationality: "GB", idType: "passport", idNumber: "K1234567", roomId: room2,
      arrival: day(-36), departure: day(-35) }));
    expect(await reasonOf(res)).toBe("Type a foreign guest's visa or OCI number (Form III).");
  });

  it("is the returning guest the person chose, and a new guest otherwise", async () => {
    const res = await as(people["gm"]!, "POST", "/backfill/stays", stay({
      guestName: `${TAG} Returning`, phone: "9811100398", guestId: returning, roomId: room2,
      arrival: day(-34), departure: day(-33) }));
    expect(res.status, await res.clone().text()).toBe(200);
    const { id } = await res.json() as { id: string };
    expect((await view()).stays.find((s) => s.id === id)!.guestId).toBe(returning);

    const wrong = await as(people["gm"]!, "POST", "/backfill/stays", stay({
      guestName: `${TAG} Returning`, phone: "9811100999", guestId: returning, roomId: room2,
      arrival: day(-33), departure: day(-32) }));
    expect(await reasonOf(wrong)).toMatch(/^That guest no longer matches the phone or email typed/);
  });

  it("touches no live ledger: no booking, bill, payment, order or invoice", async () => {
    const count = async () => (await sql<{ n: string }>(
      `select (select count(*) from reservations where hotel_id = $1)
            + (select count(*) from folios where hotel_id = $1)
            + (select count(*) from payments where hotel_id = $1)
            + (select count(*) from pos_orders where hotel_id = $1)
            + (select count(*) from invoices where hotel_id = $1)
            + (select count(*) from cashier_movements where hotel_id = $1) as n`, [hotel]))[0]!.n;
    const before = await count();
    const res = await as(people["gm"]!, "POST", "/backfill/stays", stay({
      guestName: `${TAG} Ledger`, roomId: room2, arrival: day(-38), departure: day(-37),
      rate: 3000, roomCharges: 3000, gst: 360, paid: 3360, paidBy: "Cash", billNumber: "P-101" }));
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await count()).toBe(before);
  });
});

describe("the send tick (the owner's answer 3)", () => {
  it("is refused while sending is not set up, and without an email", async () => {
    noSending();
    const off = await as(people["gm"]!, "POST", "/backfill/stays", stay({
      guestName: `${TAG} Unsent`, email: "unsent@example.com", sendBill: true, roomId: room2,
      arrival: day(-30), departure: day(-29) }));
    expect(await reasonOf(off)).toMatch(/^The bill cannot be sent: Sending is not set up yet/);
    expect((await view()).sending.ok).toBe(false);

    setUpSending();
    const noEmail = await as(people["gm"]!, "POST", "/backfill/stays", stay({
      guestName: `${TAG} Unsent`, sendBill: true, roomId: room2, arrival: day(-30), departure: day(-29) }));
    expect(await reasonOf(noEmail)).toBe("Type the guest's email to send them the bill, or untick it.");
    expect(received).toHaveLength(0);
  });

  it("sends once, by email, with the hotel's own bill number - and a correction sends nothing", async () => {
    setUpSending();
    const res = await as(people["gm"]!, "POST", "/backfill/stays", stay({
      guestName: `${TAG} Sent`, email: "sent@example.com", sendBill: true, roomId: room2,
      arrival: day(-28), departure: day(-26), roomCharges: 6000, gst: 720, billNumber: "H-0042" }));
    expect(res.status, await res.clone().text()).toBe(200);
    const { id, sent } = await res.json() as { id: string; sent: unknown };
    expect(sent).toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ kind: "backfill-bill", channel: "email", to: { email: "sent@example.com" } });
    expect(received[0]!.data).toMatchObject({ billNumber: "H-0042", roomCharges: "INR 6,000.00", total: "INR 6,720.00",
      paid: "-" });
    expect(await sql("select 1 from messages_sent where about_kind = 'backfill-stay' and about_id = $1", [id]))
      .toHaveLength(1);

    const fix = await as(people["gm"]!, "PUT", `/backfill/stays/${id}`, stay({
      guestName: `${TAG} Sent`, email: "sent@example.com", sendBill: true, roomId: room2,
      arrival: day(-28), departure: day(-26), roomCharges: 6100, gst: 732, billNumber: "H-0042",
      idNumber: "", reason: "The bill said 6,100" }));
    expect(fix.status, await fix.clone().text()).toBe(200);
    expect(received, "a correction never sends").toHaveLength(1);
    expect(await sql("select 1 from messages_sent where about_kind = 'backfill-stay' and about_id = $1", [id]))
      .toHaveLength(1);
    const s = (await view()).stays.find((x) => x.id === id)!;
    expect([s["roomCharges"], s["changeReason"], s.message?.status]).toEqual([6100, "The bill said 6,100", "sent"]);
    expect(s["idNumber"], "a blank ID number keeps the one on file").toBe("DL0420110012345");
  });
});

describe("correcting and removing", () => {
  it("needs a reason for each, keeps the removed record and freezes it", async () => {
    const add = await as(people["gm"]!, "POST", "/backfill/bills", {
      outletId: (await sql<{ id: string }>("select id::text from pos_outlets where hotel_id = $1 limit 1", [hotel]))[0]!.id,
      billDate: day(-33), billNumber: "R-7", amount: 1000, gst: 50, total: 1050, paidBy: "UPI", note: TAG });
    expect(add.status, await add.clone().text()).toBe(200);
    const { id } = await add.json() as { id: string };

    expect((await as(people["gm"]!, "PUT", `/backfill/bills/${id}`, { billDate: day(-33) })).status).toBe(409);
    expect((await as(people["gm"]!, "POST", `/backfill/bills/${id}/remove`, {})).status).toBe(409);

    const removed = await as(people["gm"]!, "POST", `/backfill/bills/${id}/remove`, { reason: "Entered twice" });
    expect(removed.status, await removed.clone().text()).toBe(200);
    const kept = (await view()).bills.find((b) => b.id === id)!;
    expect([kept["removedReason"], kept["removedBy"]]).toEqual(["Entered twice", `${TAG} gm`]);

    const again = await as(people["gm"]!, "PUT", `/backfill/bills/${id}`, {
      outletId: kept["outletId"], billDate: day(-33), reason: "Back" });
    expect(again.status).toBe(409);
    expect(await sql("select 1 from backfill_restaurant_bills where id = $1", [id])).toHaveLength(1);
    expect(await sql(
      "select 1 from audit_log where table_name = 'backfill_restaurant_bills' and row_id = $1 and action = 'UPDATE'", [id]))
      .toHaveLength(1);
  });
});

async function reasonOf(res: Response): Promise<string | undefined> {
  return ((await res.json()) as { reason?: string }).reason;
}

function words(d: string) {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB",
    { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
