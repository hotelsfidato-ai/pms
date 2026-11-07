import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   BRINGING IN AN OLD SYSTEM'S GUESTS AND BOOKINGS (D27-383 item 7;
   migration "old system import")

   Settings → Bring in old data. Who may (the owner and an Admin; not the
   GM, not reception), a fault in the file saving nothing, a check saving
   nothing, a guest on file waiting for keep/merge/skip and a merge filling
   only what is empty, never a whole ID number, a booking to come refused
   where the hotel has no such room type or the nights are full, no rate a
   dash that check-in refuses, an advance a payment on its day and never an
   invoice or a drawer, a past stay history only, the same booking never
   twice, and the undo: everything, all or nothing, only while untouched.
   Everything is tagged OSI; its bookings are 300 days ahead, in a room type
   of its own with one room, which nothing else uses.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const TAG = "OSI";

async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const call = (who: string, method: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/5EL${path}`, {
    method,
    headers: { "x-dev-staff-id": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

type Row = { line: number; action: string; problems: string[]; refused?: string; notes: string[]; matches?: { id: string }[] };
type Out = { ok: boolean; reason?: string; importId?: string; rows: Row[]; counts: Record<string, number>; columns: Record<string, string> };

const people: Record<string, string> = {};
let hotel = "";
let today = "";
let first = "";
/* Before the first day AND before the hotel's own today: an advance's day. */
let paidBy = "";
let source = "";

const ahead = (days: number) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10).split("-").reverse().join("/");
};
const before = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10).split("-").reverse().join("/");
};
const csv = (lines: string[]) => Buffer.from(lines.join("\r\n"), "utf-8").toString("base64");
const send = async (kind: "guests" | "bookings", lines: string[], extra: Record<string, unknown> = {},
  save = true, who = people["owner"]!) => {
  const res = await call(who, "POST", `/imports/${kind}${save ? "" : "/check"}`,
    { name: `${TAG}-${kind}.csv`, data: csv(lines), system: "IDS", ...extra });
  return { status: res.status, body: (await res.json()) as Out };
};

const book = (ref: string, guest: string, phone: string, from: number, to: number, rest: string) =>
  `${ref},${TAG} ${guest},${phone},${ahead(from)},${ahead(to)},${rest}`;

const GUEST_HEAD = "Guest Name,Mobile,Email,City,Nationality,ID Proof,ID No,DOB,Company,GSTIN,Remarks";
const BOOK_HEAD = "Booking No,Guest,Mobile,Arrival,Departure,Room Type,Room No,Rate,Plan,Adults,Source,Advance,Paid On,Payment Mode";

beforeAll(async () => {
  hotel = (await sql<{ id: string }>("select id::text from hotels where code = '5EL'"))[0]!.id;
  ({ today, first, paidBy } = (await sql<{ today: string; first: string; paidBy: string }>(
    `select app.business_date(h.id)::text as today, app.backfill_first_day(h.id)::text as first,
            least(app.backfill_first_day(h.id), (now() at time zone h.timezone)::date)::text as "paidBy"
       from hotels h where h.id = $1`, [hotel]))[0]!);
  source = (await sql<{ name: string }>("select name from booking_sources where is_active order by name limit 1"))[0]!.name;
  people["owner"] = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  for (const role of ["admin", "gm", "front_desk"]) {
    const [p] = await sql<{ id: string }>(
      `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
       on conflict (email) do update set is_active = true returning id::text`,
      [`osi-${role}@fidato.in`, `${TAG} ${role}`, `test-uid-osi-${role}`]);
    people[role] = p!.id;
    await sql("delete from staff_hotels where staff_id = $1", [p!.id]);
    await sql("insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)", [p!.id, hotel, role]);
  }
  /* A room type of this test's own, with ONE room: the second booking for
     the same nights finds it full. */
  const [rt] = await sql<{ id: string }>(
    `insert into room_types (hotel_id, code, name, base_occupancy, max_occupancy)
     values ($1, 'OSI', 'Osi Suite', 2, 3) returning id::text`, [hotel]);
  await sql("insert into rooms (hotel_id, room_type_id, number) values ($1, $2, 'OSI1')", [hotel, rt!.id]);
});

afterAll(async () => {
  const ids = Object.entries(people).filter(([r]) => r !== "owner").map(([, id]) => id);
  await sql("delete from staff_hotels where staff_id = any($1)", [ids]);
  await sql("update staff set is_active = false where id = any($1)", [ids]);
  await closePool();
});

describe("who may", () => {
  it("the GM and reception are refused, in words, and nothing is read", async () => {
    for (const who of ["gm", "front_desk"]) {
      const list = await call(people[who]!, "GET", "/imports");
      expect(list.status).toBe(403);
      const out = await send("guests", [GUEST_HEAD, `${TAG} Nobody,,,,,,,,,,`], {}, false, people[who]!);
      expect(out.status).toBe(403);
      expect(out.body.reason).toMatch(/owner or an administrator/);
    }
  });

  it("an Admin at the hotel may", async () => {
    const list = await call(people["admin"]!, "GET", "/imports");
    expect(list.status).toBe(200);
  });
});

describe("the guests' file", () => {
  it("a fault in one row saves nothing, and every fault is listed by its row", async () => {
    const out = await send("guests", [GUEST_HEAD,
      `${TAG} Fine,9811100801,,,IN,,,,,,`,
      `${TAG} Bad Phone,98111,,,IN,,,,,,`,
      `${TAG} Bad Date,9811100803,,,IN,,,31/02/1990,,,`,
      `${TAG} Bad Gstin,9811100804,,,IN,,,,Acme,27AAPFU0939F1ZX,`]);
    expect(out.status).toBe(409);
    expect(out.body.reason).toMatch(/3 rows have a fault in the file\. Nothing was saved/);
    expect(out.body.rows.find((r) => r.line === 3)!.problems.join()).toMatch(/phone/i);
    expect(out.body.rows.find((r) => r.line === 4)!.problems.join()).toMatch(/not a date/);
    expect(out.body.rows.find((r) => r.line === 5)!.problems.join()).toMatch(/GSTIN/);
    expect(await sql("select 1 from guests where full_name like $1", [`${TAG} %`])).toHaveLength(0);
    expect(await sql("select 1 from data_imports where file_name like $1", [`${TAG}-%`])).toHaveLength(0);
  });

  it("the same person twice in one file is a fault", async () => {
    const out = await send("guests", [GUEST_HEAD, `${TAG} Twin,9811100805,,,,,,,,,`, `${TAG} Twin B,9811100805,,,,,,,,,`], {}, false);
    expect(out.body.rows[1]!.problems.join()).toMatch(/same phone as row 2/);
  });

  it("a check saves nothing; the save keeps only the last four of an ID, and the company in the notes", async () => {
    const lines = [GUEST_HEAD, `${TAG} Asha,9811100811,osi.asha@example.com,Pune,Indian,Aadhaar,2345 6789 0123,14/02/1985,Rao Traders,27AAPFU0939F1ZV,High floor`];
    const checked = await send("guests", lines, {}, false);
    expect(checked.body.ok).toBe(true);
    expect(checked.body.counts["new"]).toBe(1);
    expect(await sql("select 1 from guests where full_name = $1", [`${TAG} Asha`])).toHaveLength(0);

    const saved = await send("guests", lines);
    expect(saved.status).toBe(200);
    const [g] = await sql<{ notes: string; nationality: string; id_number: string | null; date_of_birth: string; everything: string }>(
      `select g.notes, g.nationality, d.id_number, d.date_of_birth::text, row_to_json(g)::text || coalesce(row_to_json(d)::text, '') as everything
         from guests g left join guest_documents d on d.guest_id = g.id where g.full_name = $1`, [`${TAG} Asha`]);
    expect(g!.nationality).toBe("IN");
    expect(g!.notes).toBe("High floor · Company: Rao Traders · GSTIN 27AAPFU0939F1ZV · ID in IDS: Aadhaar ending 0123");
    expect(g!.id_number).toBeNull();
    expect(g!.date_of_birth).toBe("1985-02-14");
    expect(g!.everything).not.toMatch(/23456789|2345 6789/);
    const [d] = await sql<{ rows_in: number; rows_refused: number; made_by: string; columns: Record<string, string> }>(
      "select rows_in, rows_refused, made_by::text, columns from data_imports where id = $1", [saved.body.importId]);
    expect(d).toMatchObject({ rows_in: 1, rows_refused: 0, made_by: people["owner"] });
    expect(d!.columns["idNumber"]).toBe("ID No");
  });

  it("a guest already on file waits for a choice; merge fills only what is empty; skip is recorded", async () => {
    const lines = [GUEST_HEAD,
      `${TAG} Asha Again,9811100811,osi.other@example.com,,,,,,,,Second note`,
      `${TAG} Fresh,9811100812,,,,,,,,,`];
    const waiting = await send("guests", lines);
    expect(waiting.status).toBe(409);
    expect(waiting.body.reason).toMatch(/already on file\. Nothing was saved: choose keep, merge or skip/);
    expect(await sql("select 1 from guests where full_name = $1", [`${TAG} Fresh`])).toHaveLength(0);

    const asha = waiting.body.rows[0]!.matches![0]!.id;
    const merged = await send("guests", lines, { choices: { 2: { action: "merge", guestId: asha } } });
    expect(merged.status).toBe(200);
    const [g] = await sql<{ full_name: string; email: string; notes: string }>(
      "select full_name, email::text, notes from guests where id = $1", [asha]);
    /* On file: the name, the email and the notes stay as they were. */
    expect(g).toMatchObject({ full_name: `${TAG} Asha`, email: "osi.asha@example.com" });
    expect(g!.notes).toMatch(/^High floor/);
    expect(await sql("select 1 from guests where full_name = $1", [`${TAG} Asha Again`])).toHaveLength(0);

    const skipped = await send("guests", [GUEST_HEAD, `${TAG} Fresh Again,9811100812,,,,,,,,,`],
      { choices: { 2: { action: "skip" } } });
    /* Nothing to bring in: refused, and nothing recorded. */
    expect(skipped.status).toBe(409);
    expect(skipped.body.reason).toMatch(/Nothing in this file would be brought in/);
  });
});

describe("the bookings' file", () => {
  it("a fault saves nothing: a meal plan, a method or an advance from after the first day", async () => {
    const out = await send("bookings", [BOOK_HEAD,
      book("OSI-F1", "Plan", "9811100821", 300, 302, `Osi Suite,,3000,XYZ,2,${source},,,`),
      book("OSI-F2", "Method", "9811100822", 304, 306, `Osi Suite,,3000,EP,2,${source},500,${before(paidBy, 3)},Barter`),
      book("OSI-F3", "Late", "9811100823", 308, 310, `Osi Suite,,3000,EP,2,${source},500,${ahead(1)},Cash`)]);
    expect(out.status).toBe(409);
    expect(out.body.rows[0]!.problems.join()).toMatch(/not a meal plan/);
    expect(out.body.rows[1]!.problems.join()).toMatch(/not one of this hotel's payment methods/);
    expect(out.body.rows[2]!.problems.join()).toMatch(/before the hotel's first day here/);
    expect(await sql("select 1 from reservations where notes like 'Brought in from IDS (OSI-F%'")).toHaveLength(0);
  });

  let importId = "";
  let drawers = 0;
  it("refused where there is no such room type or the nights are full; the rest saved together", async () => {
    drawers = (await sql("select 1 from cashier_shifts where hotel_id = $1", [hotel])).length;
    const out = await send("bookings", [BOOK_HEAD,
      book("OSI-1", "Ravi", "9811100831", 300, 303, `Osi Suite,OSI1,3500,EP,2,${source},2000,${before(paidBy, 5)},Cash`),
      book("OSI-2", "Meera", "9811100832", 301, 302, `OSI,,3500,EP,2,${source},,,`),
      book("OSI-3", "Sunil", "9811100833", 300, 302, `Penthouse,,5000,EP,2,${source},,,`),
      book("OSI-4", "Leela", "9811100834", 310, 312, `Osi Suite,,,EP,2,${source},,,`),
      `OSI-0,${TAG} Ravi,9811100831,${before(today, 40)},${before(today, 38)},Deluxe,301,4000,EP,2,Walk-in,,,`,
      `OSI-5,${TAG} Anil,9811100835,${before(today, 1)},${ahead(2)},Osi Suite,,4200,EP,1,${source},,,`]);
    expect(out.status).toBe(200);
    importId = out.body.importId!;
    const by = (line: number) => out.body.rows.find((r) => r.line === line)!;
    expect(by(2).action).toBe("booking");
    expect(by(3)).toMatchObject({ action: "refused" });
    expect(by(3).refused).toMatch(/no room free/);
    expect(by(4).refused).toMatch(/no room type "Penthouse"/);
    expect(by(5).action).toBe("booking");
    expect(by(6).action).toBe("stay");
    expect(by(7).refused).toMatch(/In the house today/);
    const [d] = await sql<{ rows_in: number; rows_refused: number; refused: { line: number }[] }>(
      "select rows_in, rows_refused, refused from data_imports where id = $1", [importId]);
    expect(d).toMatchObject({ rows_in: 6, rows_refused: 3 });
    expect(d!.refused.map((r) => r.line)).toEqual([3, 4, 7]);
  });

  it("a booking to come is an ordinary confirmed one, its room held; its advance a payment on its day, never an invoice or a drawer", async () => {
    const [r] = await sql<{ id: string; status: string; agreed_rate: string; room: string; notes: string }>(
      `select id::text, status, agreed_rate::text, app.stay_room(id) as room, notes from reservations
        where notes = 'Brought in from IDS (OSI-1).'`);
    expect(r).toMatchObject({ status: "confirmed", agreed_rate: "3500.00", room: "OSI1" });
    const pay = await sql<{ business_date: string; amount: string; description: string; method: string }>(
      `select fp.business_date::text, fp.amount::text, fp.description, p.method
         from folio_postings fp join payments p on p.posting_id = fp.id where fp.reservation_id = $1`, [r!.id]);
    expect(pay).toHaveLength(1);
    expect(pay[0]).toMatchObject({ amount: "-2000.00", description: "Advance - Cash, brought in from IDS", method: "cash" });
    /* Its own day, before the hotel's first day here: in no live day's takings. */
    expect(pay[0]!.business_date < first).toBe(true);
    expect(await sql("select 1 from invoices i join folios f on f.id = i.folio_id where f.reservation_id = $1", [r!.id])).toHaveLength(0);
    expect((await sql("select 1 from cashier_shifts where hotel_id = $1", [hotel])).length).toBe(drawers);
  });

  it("no rate: a dash, listed for the desk, and check-in refuses it", async () => {
    const [r] = await sql<{ id: string; agreed_rate: string | null }>(
      "select id::text, agreed_rate from reservations where notes like 'Brought in from IDS (OSI-4).%'");
    expect(r!.agreed_rate).toBeNull();
    const list = (await (await call(people["owner"]!, "GET", "/imports")).json()) as { noRate: { id: string }[] };
    expect(list.noRate.map((n) => n.id)).toContain(r!.id);
    const checkIn = await call(people["owner"]!, "POST", `/stays/${r!.id}/check-in`, {});
    expect(checkIn.status).toBe(409);
    expect(((await checkIn.json()) as { reason: string }).reason).toMatch(/no rate\. Set its rate first/);
    /* And the database's own guard behind the words. */
    await expect(sql("update reservations set status = 'checked_in' where id = $1", [r!.id])).rejects.toThrow(/reservations_rate_by_arrival/);
  });

  it("a past stay is history only: a visit on Guest 360, never a booking, a bill or tax", async () => {
    const [s] = await sql<{ guest_id: string; room_type: string; reference: string }>(
      "select guest_id::text, room_type, reference from imported_stays where import_id = $1", [importId]);
    expect(s).toMatchObject({ room_type: "Deluxe", reference: "OSI-0" });
    expect(await sql("select 1 from reservations where notes like '%(OSI-0)%'")).toHaveLength(0);
    /* Ravi's booking to come and his past stay are one guest. */
    const [ravi] = await sql<{ id: string }>("select guest_id::text as id from reservations where notes = 'Brought in from IDS (OSI-1).'");
    expect(s!.guest_id).toBe(ravi!.id);
    const [v] = await sql<{ n: number }>("select app.guest_visits($1) as n", [s!.guest_id]);
    expect(v!.n).toBe(1);
  });

  it("the same booking is never brought in twice", async () => {
    const out = await send("bookings", [BOOK_HEAD,
      book("OSI-1", "Ravi", "9811100831", 300, 303, `Osi Suite,,3500,EP,2,${source},,,`)]);
    expect(out.status).toBe(409);
    expect(out.body.rows[0]!.refused).toMatch(/Already brought in/);
  });
});

describe("the undo", () => {
  it("is refused once anything it brought in has been touched, and changes nothing", async () => {
    const [imp] = await sql<{ id: string }>(
      "select id::text from data_imports where kind = 'bookings' and file_name = $1 and undone_at is null", [`${TAG}-bookings.csv`]);
    await sql("update reservations set special_request = 'Late arrival' where notes like 'Brought in from IDS (OSI-4).%'");
    const out = await call(people["owner"]!, "POST", `/imports/${imp!.id}/undo`);
    expect(out.status).toBe(409);
    expect(((await out.json()) as { reason: string }).reason).toMatch(/^Nothing was undone: FH-.* changed since it came in/);
    expect(await sql("select 1 from reservations where notes like 'Brought in from IDS (OSI-%'")).toHaveLength(2);
  });

  it("takes everything back while untouched: guests, bookings, rooms, advances and past stays", async () => {
    const out = await send("bookings", [BOOK_HEAD,
      book("OSI-U1", "Undo Me", "9811100841", 320, 322, `Osi Suite,OSI1,3600,EP,2,${source},700,${before(paidBy, 2)},UPI`),
      `OSI-U0,${TAG} Undo Past,9811100842,${before(today, 60)},${before(today, 58)},Suite,,,EP,2,,,,`]);
    expect(out.status).toBe(200);
    const id = out.body.importId!;
    expect(await sql("select 1 from guests where full_name like $1", [`${TAG} Undo%`])).toHaveLength(2);

    expect((await call(people["gm"]!, "POST", `/imports/${id}/undo`)).status).toBe(403);
    const undone = await call(people["admin"]!, "POST", `/imports/${id}/undo`);
    expect(undone.status).toBe(200);
    expect(await sql("select 1 from guests where full_name like $1", [`${TAG} Undo%`])).toHaveLength(0);
    expect(await sql("select 1 from reservations where notes like '%(OSI-U1)%'")).toHaveLength(0);
    expect(await sql("select 1 from folio_postings where source_id = $1", [id])).toHaveLength(0);
    expect(await sql("select 1 from imported_stays where import_id = $1", [id])).toHaveLength(0);
    const [d] = await sql<{ undone_by: string }>("select undone_by::text from data_imports where id = $1", [id]);
    expect(d!.undone_by).toBe(people["admin"]);

    const again = await call(people["owner"]!, "POST", `/imports/${id}/undo`);
    expect(((await again.json()) as { reason: string }).reason).toBe("This import was undone already.");
  });

  it("a merge undone empties again only what it filled", async () => {
    const [asha] = await sql<{ id: string }>("select id::text from guests where full_name = $1", [`${TAG} Asha`]);
    await sql("update guests set phone = null where id = $1", [asha!.id]);
    const merged = await send("guests", [GUEST_HEAD, `${TAG} Asha,9811100851,osi.asha@example.com,,,,,,,,`],
      { choices: { 2: { action: "merge", guestId: asha!.id } } });
    expect(merged.status).toBe(200);
    expect((await sql<{ phone: string }>("select phone from guests where id = $1", [asha!.id]))[0]!.phone).toBe("9811100851");
    expect((await call(people["owner"]!, "POST", `/imports/${merged.body.importId}/undo`)).status).toBe(200);
    const [g] = await sql<{ phone: string | null; email: string }>("select phone, email::text from guests where id = $1", [asha!.id]);
    expect(g).toEqual({ phone: null, email: "osi.asha@example.com" });
  });
});
