import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../src/server.ts";
import { closePool } from "../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE BELL FOLLOWS THE READ RULES - the owner's D27-153, 28 September

   A guest's name only for a role holding `customer`, a balance only for
   one holding `invoice`; everybody else still gets the alert. And a
   guest's message to the desk rings it (QA GP-5), for the roles that
   read guests' messages (D27-144). Everything here is named NTFTEST and
   removed afterwards.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

type Bell = Array<{ id: string; title: string; body: string }>;
const bell = async (who: string, asOn: string) =>
  (await (await app.request(`/api/hotels/5EL/notifications?asOn=${asOn}`,
    { headers: { "x-dev-staff-id": who } })).json()) as Bell;

const ids: string[] = [];
const person = async (key: string, role: string) => {
  const { rows } = await sql(
    `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
     on conflict (email) do update set is_active = true returning id::text`,
    [`ntf-${key}@fidato.in`, `NTFTEST ${key}`, `test-uid-ntf-${key}`]);
  const id = rows[0].id as string;
  ids.push(id);
  await sql("delete from staff_hotels where staff_id = $1", [id]);
  await sql("insert into staff_hotels (staff_id, hotel_id, role) select $1, id, $2 from hotels where code = '5EL'",
    [id, role]);
  return id;
};

let desk: string;
let housekeeping: string;
/* The day with the most arrivals still to come, and their names. */
let day: string;
let arriving: string[];

beforeAll(async () => {
  desk = await person("desk", "front_desk");
  housekeeping = await person("housekeeping", "housekeeping");
  const { rows } = await sql(
    `select r.check_in::text as day, array_agg(g.full_name) as names
       from reservations r join guests g on g.id = r.guest_id join hotels h on h.id = r.hotel_id
      where h.code = '5EL' and r.status = 'confirmed' and r.check_out > r.check_in
      group by r.check_in order by count(*) desc, r.check_in limit 1`);
  day = rows[0].day;
  arriving = rows[0].names;
});

afterAll(async () => {
  await sql("delete from guest_requests where what = 'NTFTEST towels'");
  await sql("delete from staff_hotels where staff_id = any($1)", [ids]);
  await sql("update staff set is_active = false where id = any($1)", [ids]);
  await closePool();
});

describe("the bell (D27-153)", () => {
  it("names the arriving guests to reception, and to housekeeping only the rooms", async () => {
    const toDesk = JSON.stringify(await bell(desk, day));
    const toHousekeeping = await bell(housekeeping, day);
    expect(arriving.some((n) => toDesk.includes(n)), "reception reads the names").toBe(true);
    for (const n of arriving) expect(JSON.stringify(toHousekeeping), n).not.toContain(n);
    /* The alert itself still reaches housekeeping. */
    expect(toHousekeeping.some((x) => x.id === "arrivals-outstanding")).toBe(true);
  });
});

describe("a guest's message to the desk (QA GP-5)", () => {
  it("rings the bell for reception, and not for housekeeping", async () => {
    await sql(
      `insert into guest_requests (hotel_id, reservation_id, kind, what)
       select r.hotel_id, r.id, 'desk', 'NTFTEST towels' from reservations r
         join hotels h on h.id = r.hotel_id
        where h.code = '5EL' and r.status = 'checked_in' order by r.reference limit 1`);
    expect((await bell(desk, day)).some((x) => x.id === "guest-messages-waiting")).toBe(true);
    expect((await bell(housekeeping, day)).some((x) => x.id === "guest-messages-waiting")).toBe(false);
  });
});

/* THE OWNER'S D27-226 (1 October): a guest owes only their own bill. The bell
   summed a stay's lines by the stay each POSTING names, so a guest the group
   pays for, leaving today, rang "outstanding" for the company's nights on the
   group's master bill. */
describe("a guest the group pays for (D27-226)", () => {
  let stay = "";
  let groupId = "";
  afterAll(async () => {
    await sql("alter table folio_postings disable trigger folio_postings_append_only");
    await sql("delete from folio_postings where reservation_id = $1", [stay]);
    await sql("alter table folio_postings enable trigger folio_postings_append_only");
    await sql("delete from folios where reservation_id = $1 or group_id = $2", [stay, groupId]);
    await sql("delete from reservations where id = $1", [stay]);
    await sql("delete from reservation_groups where id = $1", [groupId]);
  });

  it("does not ring 'outstanding' for the nights on the group's bill", async () => {
    const { rows: [h] } = await sql(
      "select id::text, app.business_date(id)::text as day from hotels where code = '5EL'");
    groupId = (await sql("insert into reservation_groups (name) values ('NTFTEST group') returning id::text"))
      .rows[0].id;
    stay = (await sql(
      `insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
                                 agreed_rate, status, group_id, route_room_to_group)
       select $1, 'NTFTEST-ROUTED', (select id from guests limit 1),
              (select id from room_types where hotel_id = $1 limit 1),
              $2::date - 1, $2::date, 3000, 'checked_in', $3, true
       returning id::text`, [h.id, h.day, groupId])).rows[0].id;
    await sql("insert into folios (hotel_id, reservation_id) values ($1, $2)", [h.id, stay]);
    const master = (await sql(
      "insert into folios (hotel_id, group_id) values ($1, $2) returning id::text", [h.id, groupId])).rows[0].id;
    await sql(
      `insert into folio_postings (hotel_id, folio_id, reservation_id, business_date, category,
                                   description, amount, tax_rate, tax_amount)
       values ($1, $2, $3, $4::date, 'room', 'Room - · 1 night', 3000, 5, 150)`,
      [h.id, master, stay, h.day]);
    const owner = (await sql("select id::text from staff where email = 'owner@fidato.in'")).rows[0].id;
    expect((await bell(owner, h.day)).some((x) => x.id === `balance-${stay}`)).toBe(false);
  });
});

/* THE BELL IN ONE PASS (D27-387, the load test): a charge taken back counts for
   nothing and neither does its reversal, so a stay paid beyond what is left is
   a refund for that sum, whatever status the stay is in. */
describe("a refund, summed in one pass (D27-387)", () => {
  let stay = "";
  afterAll(async () => {
    await sql("alter table folio_postings disable trigger folio_postings_append_only");
    await sql("delete from folio_postings where reservation_id = $1", [stay]);
    await sql("alter table folio_postings enable trigger folio_postings_append_only");
    await sql("delete from folios where reservation_id = $1", [stay]);
    await sql("delete from reservations where id = $1", [stay]);
  });

  it("leaves a reversed charge and its reversal out of the balance", async () => {
    const { rows: [h] } = await sql(
      "select id::text, app.business_date(id)::text as day from hotels where code = '5EL'");
    stay = (await sql(
      `insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
                                 agreed_rate, status)
       select $1, 'NTFTEST-REFUND', (select id from guests limit 1),
              (select id from room_types where hotel_id = $1 limit 1),
              $2::date - 2, $2::date - 1, 3000, 'checked_out'
       returning id::text`, [h.id, h.day])).rows[0].id;
    const bill = (await sql(
      "insert into folios (hotel_id, reservation_id) values ($1, $2) returning id::text", [h.id, stay])).rows[0].id;
    const line = (amount: number, reverses: string | null) => sql(
      `insert into folio_postings (hotel_id, folio_id, reservation_id, business_date, category,
                                   description, amount, tax_rate, tax_amount, reverses_id)
       values ($1, $2, $3, $4::date, 'misc', 'NTFTEST', $5, 0, 0, $6) returning id::text`,
      [h.id, bill, stay, h.day, amount, reverses]);
    const charge = (await line(1000, null)).rows[0].id;
    await line(-1000, charge);
    await line(-500, null);
    const owner = (await sql("select id::text from staff where email = 'owner@fidato.in'")).rows[0].id;
    const refund = (await bell(owner, h.day)).find((x) => x.id === `refund-${stay}`);
    expect(refund?.title).toContain("₹500 to refund");
  });
});
