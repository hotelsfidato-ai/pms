import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   A COMPANY OVER ITS CREDIT LIMIT (the owner's D27-275 part 5)

   credit_limit was shown and never asked. Now a booking or a charge billed
   to a company whose City ledger balance (what it owes the hotel now) plus
   this amount is over its limit is refused, "<Company> is over its credit
   limit by ₹x." The owner, an administrator or the GM may allow it with a
   reason, and the allowance is in the activity log. No limit: no check.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const TAG = "CRLM";
let hotelId: string;
let typeId: string;
let source: string;
let company: string;
let stay: string;
/** What the company owes after the first bill is sent to it. */
let sent = 0;
const staff = new Map<string, string>();

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Client({ connectionString: SUPER });
  await db.connect();
  try { return await db.query(text, params); } finally { await db.end(); }
};

const person = async (role: string) => {
  const { rows } = await sql(
    `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
     on conflict (email) do update set is_active = true returning id::text`,
    [`crlm-${role}@fidato.in`, `${TAG} ${role}`, `test-uid-crlm-${role}`]);
  const id = rows[0].id as string;
  await sql("delete from staff_hotels where staff_id = $1", [id]);
  await sql("insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)", [id, hotelId, role]);
  return id;
};

const call = (role: string, path: string, body: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method: "POST",
    headers: { "x-dev-staff-id": staff.get(role)!, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const answer = async (res: Response) => (await res.json()) as { ok: boolean; reason?: string; needs?: string };

const book = (role: string, name: string, extra: Record<string, unknown> = {}) =>
  call(role, "/bookings", {
    guestName: `${TAG} ${name}`, checkIn: "2029-06-10", checkOut: "2029-06-12",
    bookingSourceId: source, companyId: company,
    lines: [{ roomTypeId: typeId, mealPlan: "EP", adults: 1, children: 0, rooms: 1, agreedRate: 3000 }],
    ...extra,
  });
const charge = (role: string, extra: Record<string, unknown> = {}) =>
  call(role, `/stays/${stay}/charges`, {
    category: "Miscellaneous", description: `${TAG} transport`, amount: 1000, taxable: false, ...extra,
  });
const limit = (rupees: number | null) =>
  sql("update companies set credit_limit = $2 where id = $1", [company, rupees]);
/** The bill the company is sent: a "Bill to company" settle of the stay's balance. */
const owed = async () => Number((await sql(
  `select coalesce(sum(fp.amount + fp.tax_amount), 0)::text as n
     from folio_postings fp join folios f on f.id = fp.folio_id where f.reservation_id = $1`,
  [stay])).rows[0].n);
const allowances = async () => (await sql(
  `select a.reason, a.over_by::float8 as over_by, l.actor::text as actor
     from credit_limit_allowances a
     join audit_log l on l.table_name = 'credit_limit_allowances' and l.row_id = a.id::text
    where a.company_id = $1 order by a.allowed_at`, [company])).rows;
/** A stay booked at ₹3,000 a night for two nights, with its GST: what a booking bills. */
const bookingTotal = async () => Number((await sql(
  "select (2 * (3000 + round(3000 * coalesce(app.gst_rate_or_null($1, 'room', 3000), 0) / 100, 2)))::text as n",
  [hotelId])).rows[0].n);

beforeAll(async () => {
  hotelId = (await sql("select id::text from hotels where code = '5EL'")).rows[0].id;
  typeId = (await sql(
    "select id::text from room_types where hotel_id = $1 and is_active order by sort_order limit 1",
    [hotelId])).rows[0].id;
  source = (await sql("select id::text from booking_sources where is_active order by name limit 1")).rows[0].id;
  company = (await sql(
    `insert into companies (name, credit_allowed) values ($1, true)
     on conflict do nothing returning id::text`, [`${TAG} Travels`])).rows[0]?.id
    ?? (await sql("select id::text from companies where name = $1", [`${TAG} Travels`])).rows[0].id;
  for (const role of ["front_desk", "gm"]) staff.set(role, await person(role));
});

afterAll(async () => {
  const ids = (await sql(
    `select r.id::text from reservations r join guests g on g.id = r.guest_id where g.full_name like $1`,
    [`${TAG} %`])).rows.map((r) => r.id as string);
  await sql("delete from credit_limit_allowances where company_id = $1", [company]);
  await sql(`delete from payments where posting_id in (select fp.id from folio_postings fp
               join folios f on f.id = fp.folio_id where f.reservation_id = any($1::uuid[]))`, [ids]);
  await sql("alter table folio_postings disable trigger user");
  try {
    await sql(`delete from folio_postings where folio_id in
                 (select id from folios where reservation_id = any($1::uuid[]))`, [ids]);
  } finally { await sql("alter table folio_postings enable trigger user"); }
  await sql("delete from folios where reservation_id = any($1::uuid[])", [ids]);
  await sql("delete from reservations where id = any($1::uuid[])", [ids]);
  await sql("delete from companies where id = $1", [company]);
  await sql("alter table guests disable trigger guests_no_delete");
  try { await sql("delete from guests where full_name like $1", [`${TAG} %`]); }
  finally { await sql("alter table guests enable trigger guests_no_delete"); }
  await closePool();
});

describe("a company's credit limit (D27-275)", () => {
  it("asks nothing where no limit is set", async () => {
    await limit(null);
    const res = await book("front_desk", "No limit");
    expect(res.status, await res.clone().text()).toBe(200);
    stay = (await sql(
      `select r.id::text from reservations r join guests g on g.id = r.guest_id where g.full_name = $1`,
      [`${TAG} No limit`])).rows[0].id;
  });

  it("lets a charge under the limit through, and counts what the company already owes", async () => {
    await limit(100000);
    expect((await charge("front_desk")).status).toBe(200);

    /* The bill goes to the company: the City ledger's Debit. */
    sent = await owed();
    const pay = await call("front_desk", `/stays/${stay}/payments`, { method: "Bill to company", amount: sent });
    expect(pay.status, await pay.clone().text()).toBe(200);

    /* ₹1,000 more is over by exactly what it owes plus ₹1,000, less the limit. */
    await limit(sent + 500);
    const res = await charge("front_desk");
    expect(res.status).toBe(409);
    const said = await answer(res);
    expect(said.reason).toBe(`${TAG} Travels is over its credit limit by ₹500.00.`);
    expect(said.needs).toBe("credit-limit");
  });

  it("refuses reception's allow; the GM's, with a reason, goes through and is logged", async () => {
    const before = await owed();
    const desk = await charge("front_desk", { overLimitReason: "Known client" });
    expect(desk.status).toBe(409);
    expect((await answer(desk)).reason).toMatch(/owner, an administrator or the general manager/);

    const blank = await charge("gm", { overLimitReason: "  " });
    expect(blank.status).toBe(409);

    const gm = await charge("gm", { overLimitReason: "Pays monthly, cleared by the owner" });
    expect(gm.status, await gm.clone().text()).toBe(200);
    expect(await owed()).toBe(before + 1000);
    expect(await allowances()).toEqual([
      { reason: "Pays monthly, cleared by the owner", over_by: 500, actor: staff.get("gm") },
    ]);
  });

  it("refuses a booking over the limit, and the GM may allow it", async () => {
    /* Owed now: the one bill sent. The GM's charge is on a bill not sent yet. */
    await limit(sent + (await bookingTotal()) - 1);
    const refused = await book("front_desk", "Over limit");
    expect(refused.status).toBe(409);
    expect((await answer(refused)).reason).toBe(`${TAG} Travels is over its credit limit by ₹1.00.`);
    expect((await sql("select count(*)::int as n from guests where full_name = $1", [`${TAG} Over limit`]))
      .rows[0].n, "a refusal writes nothing").toBe(0);

    const allowed = await book("gm", "Over limit", { overLimitReason: "Group booking agreed by the owner" });
    expect(allowed.status, await allowed.clone().text()).toBe(200);
    expect((await allowances()).map((a) => a.reason)).toContain("Group booking agreed by the owner");
  });
});
