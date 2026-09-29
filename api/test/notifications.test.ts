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
