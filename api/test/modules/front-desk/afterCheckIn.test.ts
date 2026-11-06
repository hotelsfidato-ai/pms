import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   AFTER CHECK-IN (the owner's D27-397, 6 November; migration 266)

   The GM undoes a check-in, cancels or voids a guest in house, and moves
   an in-house arrival; the owner and an Admin always may; the front desk
   asks the GM, and approving does it. All of it behind Front desk rules'
   "The GM may undo a check-in", on at every hotel. And how a payment was
   taken, changed with a reason; and a room type that follows the room when
   the menu's Change room type moves the guest. A property of its own.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
async function sql<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return (await db.query(text, values)).rows as T[]; } finally { await db.end(); }
}

const CODE = "ACI";
const OWNER = "dev-owner";
let hotelId = "";
let gm = "";
let desk = "";
let other = "";        // a room type other than STD
let closedStay = "";   // arrived 25 Aug, a day the Night audit closed
let closedPayment = "";

const call = (who: string, path: string, method = "GET", body?: unknown) =>
  app.request(`/api/hotels/${CODE}${path}`, {
    method,
    headers: {
      "x-dev-staff-id": who,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const said = async (res: Response) => ((await res.json()) as { reason?: string }).reason ?? "";

let n = 0;
async function booking(from = "2026-08-26", to = "2026-08-29", guest = "ACI guest") {
  n += 1;
  return (await sql<{ id: string }>(
    `insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out,
                               agreed_rate, status)
     values ($1, $2, (select id from guests where full_name = $5 limit 1),
             (select id from room_types where hotel_id = $1 and code = 'STD'),
             $3::date, $4::date, 2000, 'confirmed')
     returning id::text`, [hotelId, `${CODE}-${n}`, from, to, guest]))[0]!.id;
}
const checkIn = async (id: string, room: string) => {
  await sql("update rooms set housekeeping_status = 'clean' where hotel_id = $1 and number = $2", [hotelId, room]);
  const res = await call(desk, `/stays/${id}/check-in`, "POST", { roomNumber: room, adults: 1, idSkipReason: "Test" });
  expect(res.status, await res.clone().text()).toBe(200);
  return id;
};
const inHouse = async (room: string) => checkIn(await booking(), room);
const stay = async (id: string) => (await sql<{
  status: string; check_in: string; notes: string | null; rate: string; type: string;
}>(
  `select r.status, r.check_in::text, r.notes, r.agreed_rate::text as rate, rt.code as type
     from reservations r join room_types rt on rt.id = r.room_type_id where r.id = $1`, [id]))[0]!;
const room = async (number: string) => (await sql<{ hk: string; occ: string }>(
  "select housekeeping_status as hk, occupancy_status as occ from rooms where hotel_id = $1 and number = $2",
  [hotelId, number]))[0]!;
const held = async (id: string) => (await sql<{ room: string; from: string }>(
  `select rm.number as room, ra.from_date::text as from from room_assignments ra
     join rooms rm on rm.id = ra.room_id where ra.reservation_id = $1 and ra.released_at is null`, [id]));
/** The stay's room lines: each with whether it still stands and who reversed it. */
const roomLines = (id: string) => sql<{ amount: string; source: string | null; live: boolean; undone_by: string | null }>(
  `select fp.amount::text, fp.source_type as source,
          not exists (select 1 from folio_postings x where x.reverses_id = fp.id) as live,
          (select x.source_type from folio_postings x where x.reverses_id = fp.id) as undone_by
     from folio_postings fp
    where fp.reservation_id = $1 and fp.category = 'room' and fp.reverses_id is null
    order by fp.id`, [id]);
const pay = async (id: string, method: string, amount: number) => {
  const res = await call(desk, `/stays/${id}/payments`, "POST", { method, amount });
  expect(res.status, await res.clone().text()).toBe(200);
  return ((await res.json()) as { data: { id: string } }).data.id;
};
const undo = (who: string, id: string, reason = "Checked in the wrong booking") =>
  call(who, `/stays/${id}/undo-check-in`, "POST", { reason });
const ask = (id: string, body: Record<string, unknown>) => call(desk, `/stays/${id}/requests`, "POST", body);
type Approval = { id: string; kind: string; detail: string | null; mayDecide: boolean; status: string };
const approvalFor = async (who: string, part: string) => {
  const list = (await (await call(who, "/approvals?status=all")).json()) as { rows: Approval[] };
  return list.rows.find((a) => a.kind === "stay_request" && (a.detail ?? "").includes(part));
};
const request = async (id: string, kind: string) => (await sql<{ status: string }>(
  "select status from stay_requests where reservation_id = $1 and kind = $2 order by requested_at desc limit 1",
  [id, kind]))[0]?.status;

beforeAll(async () => {
  const owner = (await sql<{ id: string }>("select id::text from staff where email = 'owner@fidato.in'"))[0]!.id;
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER, max: 1 });
  try {
    await db.query("select set_config('app.user_id', $1, false)", [owner]);
    hotelId = (await db.query<{ id: string }>(
      "select app.provision_property_unchecked($1,'After Check-in API Test','Nowhere')::text as id", [CODE])).rows[0]!.id;
    await db.query(
      `update hotels set business_date = date '2026-08-25', check_in_time = '00:00', check_out_time = '23:59'
        where id = $1`, [hotelId]);
    other = (await db.query<{ code: string }>(
      "select code from room_types where hotel_id = $1 and code <> 'STD' order by code limit 1", [hotelId])).rows[0]!.code;
    await db.query("select app.bulk_create_rooms($1,'STD',1::smallint,101,120)", [hotelId]);
    await db.query("select app.bulk_create_rooms($1,$2,2::smallint,201,203)", [hotelId, other]);
    await db.query(`insert into tax_rules (hotel_id, kind, over_amount, rate, note)
                    values ($1, 'room', 0, 5, 'Test'), ($1, 'room', 7500, 18, 'Test')`, [hotelId]);
    await db.query("insert into guests (full_name) values ('ACI guest')");
    await db.query("insert into guests (full_name, nationality) values ('ACI visitor', 'GB')");
    const person = async (email: string, name: string, role: string) => {
      const { rows: [s] } = await db.query<{ id: string }>(
        `insert into staff (email, full_name) values ($1, $2)
         on conflict (email) do update set is_active = true returning id::text`, [email, name]);
      await db.query("insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)", [s!.id, hotelId, role]);
      return s!.id;
    };
    gm = await person("aci-gm@fidato.in", "ACI Manager", "gm");
    desk = await person("aci-desk@fidato.in", "ACI Reception", "front_desk");

    /* In house since 25 August, with ₹500 by UPI that day - then the day is
       closed by a Night audit. */
    closedStay = (await db.query<{ id: string }>(
      `insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate, status)
       values ($1, 'ACI-CLOSED', (select id from guests where full_name = 'ACI guest' limit 1),
               (select id from room_types where hotel_id = $1 and code = 'STD'),
               date '2026-08-25', date '2026-08-28', 2000, 'checked_in') returning id::text`, [hotelId])).rows[0]!.id;
    await db.query(
      `insert into room_assignments (hotel_id, reservation_id, room_id, from_date, to_date, reason)
       select $1, $2, id, date '2026-08-25', date '2026-08-28', 'arrival' from rooms where hotel_id = $1 and number = '120'`,
      [hotelId, closedStay]);
    const { rows: [f] } = await db.query<{ id: string }>(
      "insert into folios (hotel_id, reservation_id, status) values ($1, $2, 'open') returning id::text", [hotelId, closedStay]);
    closedPayment = (await db.query<{ id: string }>(
      `insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount)
       values ($1, $2, date '2026-08-25', 'payment', 'Received - UPI', -500) returning id::text`, [hotelId, f!.id])).rows[0]!.id;
    await db.query(
      "insert into payments (hotel_id, posting_id, method, method_label, amount) values ($1, $2, 'upi', 'UPI', 500)",
      [hotelId, closedPayment]);
    await db.query(
      `insert into night_audit_runs (hotel_id, business_date, status, completed_at)
       values ($1, date '2026-08-25', 'completed', now())`, [hotelId]);
  } finally { await db.end(); }
});

afterAll(async () => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER, max: 1 });
  try {
    await db.query("alter table folio_postings disable trigger folio_postings_append_only");
    await db.query("alter table hotels disable trigger hotels_no_delete");
    await db.query("alter table night_audit_runs disable trigger user");
    await db.query("delete from payments where hotel_id = $1", [hotelId]);
    await db.query("delete from folio_postings where hotel_id = $1", [hotelId]);
    await db.query("delete from folios where hotel_id = $1", [hotelId]);
    await db.query("delete from form_c_filings where hotel_id = $1", [hotelId]);
    await db.query("delete from staff_hotels where hotel_id = $1", [hotelId]);
    await db.query("delete from hotels where id = $1", [hotelId]);
    await db.query("alter table night_audit_runs enable trigger user");
    await db.query("alter table hotels enable trigger hotels_no_delete");
    await db.query("alter table folio_postings enable trigger folio_postings_append_only");
  } finally { await db.end(); }
  await closePool();
});

describe("the switch: Front desk rules, The GM may undo a check-in", () => {
  it("is on at the hotel, and in the session's rules", async () => {
    const body = (await (await app.request("/api/hotels", { headers: { "x-dev-staff-id": OWNER } })).json()) as {
      hotels: { code: string; deskRules: { gmMayUndoCheckIn: boolean } }[];
    };
    expect(body.hotels.find((h) => h.code === CODE)?.deskRules.gmMayUndoCheckIn).toBe(true);
  });

  it("off: the GM and the front desk are locked as before; the owner still may", async () => {
    const id = await inHouse("105");
    expect((await call(OWNER, "/front-desk", "PATCH", { gmMayUndoCheckIn: false })).status).toBe(200);
    try {
      const refused = await undo(gm, id);
      expect(refused.status).toBe(409);
      expect(await said(refused)).toMatch(/off at this hotel \(Settings, Front desk rules\)/);
      expect(await said(await ask(id, { kind: "undo_check_in", reason: "Wrong guest" }))).toMatch(/off at this hotel/);
      expect(await said(await call(gm, `/stays/${id}/void`, "POST", { reason: "Twice" }))).toMatch(/off at this hotel/);
      const res = await undo(OWNER, id);
      expect(res.status, await res.clone().text()).toBe(200);
      expect((await stay(id)).status).toBe("confirmed");
    } finally {
      expect((await call(OWNER, "/front-desk", "PATCH", { gmMayUndoCheckIn: true })).status).toBe(200);
    }
  });

  it("is a yes or a no", async () => {
    expect(await said(await call(OWNER, "/front-desk", "PATCH", { gmMayUndoCheckIn: "yes" })))
      .toBe("Whether the GM may undo a check-in is a yes or a no.");
  });
});

describe("undo check-in", () => {
  let id = "";
  let upi = "";

  it("is the GM's: the front desk is told to ask", async () => {
    id = await inHouse("101");
    upi = await pay(id, "UPI", 1000);
    const res = await undo(desk, id);
    expect(res.status).toBe(409);
    expect(await said(res)).toBe("After check-in this is the GM's. Ask the GM: the request goes to their Approvals.");
  });

  it("needs a reason", async () => {
    expect(await said(await undo(gm, id, " "))).toBe("Say why the check-in is undone. It stays on the booking.");
  });

  it("is refused while a charge on the bill stands, and goes once it is reversed", async () => {
    const charged = await call(desk, `/stays/${id}/charges`, "POST",
      { category: "misc", description: "Laundry", amount: 300, taxable: false, businessDate: "2026-08-26" });
    expect(charged.status, await charged.clone().text()).toBe(200);
    const refused = await undo(gm, id);
    expect(await said(refused)).toBe("Laundry (₹300.00) is still on the bill. Reverse it on the bill first; payments stay on the bill as an advance.");
    expect((await stay(id)).status).toBe("checked_in");
    const [line] = await sql<{ id: string }>(
      "select fp.id::text from folio_postings fp join folios f on f.id = fp.folio_id where f.reservation_id = $1 and fp.description = 'Laundry'", [id]);
    expect((await call(gm, `/stays/${id}/charges/${line!.id}/reverse`, "POST", { reason: "Not ours" })).status).toBe(200);

    const res = await undo(gm, id);
    expect(res.status, await res.clone().text()).toBe(200);
  });

  it("puts the booking back to confirmed, arriving, with the reason - and the audit log says who", async () => {
    const s = await stay(id);
    expect(s.status).toBe("confirmed");
    expect(s.notes).toContain("Check-in undone - Checked in the wrong booking");
    const [audit] = await sql<{ actor: string }>(
      `select actor::text from audit_log where table_name = 'reservations' and row_id = $1
          and after->>'status' = 'confirmed' and before->>'status' = 'checked_in' order by id desc limit 1`, [id]);
    expect(audit?.actor).toBe(gm);
  });

  it("keeps the room the booking's, vacant and dirty", async () => {
    expect((await held(id)).map((h) => h.room)).toEqual(["101"]);
    expect(await room("101")).toEqual({ hk: "dirty", occ: "vacant" });
  });

  it("takes the check-in's own first night off, and leaves the payment as an advance", async () => {
    expect(await roomLines(id)).toEqual([expect.objectContaining({ source: "check_in", live: false, undone_by: "check_in_undo" })]);
    const [p] = await sql<{ live: boolean }>(
      "select not exists (select 1 from folio_postings x where x.reverses_id = $1::bigint) as live", [upi]);
    expect(p!.live).toBe(true);
  });

  it("checked in again, the first night is charged again", async () => {
    await checkIn(id, "101");
    const lines = await roomLines(id);
    expect(lines.filter((l) => l.live)).toEqual([expect.objectContaining({ source: "check_in", amount: "2000.00" })]);
  });

  it("is refused once the Night audit has closed the arrival day", async () => {
    expect(await said(await undo(gm, closedStay)))
      .toBe("The arrival day, 25 Aug, has been closed by a Night audit, so the check-in stays. Check the guest out instead.");
  });
});

describe("Form C: submitted, the check-in stays; not submitted, it is simply no longer due", () => {
  const foreign = async (room: string) => {
    const id = await booking("2026-08-26", "2026-08-28", "ACI visitor");
    await sql("update reservations set status = 'checked_in' where id = $1", [id]);
    await sql(`insert into room_assignments (hotel_id, reservation_id, room_id, from_date, to_date, reason)
               select $1, $2, id, date '2026-08-26', date '2026-08-28', 'arrival' from rooms where hotel_id = $1 and number = $3`,
      [hotelId, id, room]);
    return id;
  };
  const register = async () => ((await (await call(OWNER, "/form-c")).json()) as {
    rows: { reservationId: string }[];
  }).rows.map((r) => r.reservationId);

  it("not submitted: due, and after the undo no longer in the register", async () => {
    const id = await foreign("107");
    expect(await register()).toContain(id);
    expect((await undo(gm, id)).status).toBe(200);
    expect(await register()).not.toContain(id);
  });

  it("submitted to the FRRO: the undo is refused, naming it", async () => {
    const id = await foreign("108");
    expect((await call(OWNER, `/form-c/${id}`, "POST", { reference: "FRRO2611001" })).status).toBe(200);
    expect(await said(await undo(gm, id))).toMatch(/Form C was submitted to the FRRO \(FRRO2611001\)\. The PMS cannot take back a report/);
  });
});

describe("cancel a guest in house: the undo, then the booking's cancel", () => {
  let id = "";
  it("the front desk asks", async () => {
    id = await inHouse("102");
    expect(await said(await call(desk, `/stays/${id}/cancel-in-house`, "POST", { reason: "Plans changed" })))
      .toMatch(/^After check-in this is the GM's/);
  });

  it("the terms first, and nothing written", async () => {
    const res = await call(gm, `/stays/${id}/cancel-in-house`, "POST", { dryRun: true });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, preview: { terms: null, charge: null } });
    expect((await stay(id)).status).toBe("checked_in");
    expect((await roomLines(id)).every((l) => l.live)).toBe(true);
  });

  it("cancelled, the room free and dirty, the first night off", async () => {
    const res = await call(gm, `/stays/${id}/cancel-in-house`, "POST", { reason: "Plans changed" });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await stay(id)).status).toBe("cancelled");
    expect(await held(id)).toEqual([]);
    expect((await room("102")).hk).toBe("dirty");
    expect((await roomLines(id))[0]).toMatchObject({ live: false, undone_by: "check_in_undo" });
  });
});

describe("void a guest in house: the undo, then the void", () => {
  it("still refused with a payment on the bill - and nothing of the undo is left", async () => {
    const id = await inHouse("103");
    await pay(id, "UPI", 500);
    const res = await call(gm, `/stays/${id}/void`, "POST", { reason: "Entered twice" });
    expect(await said(res)).toMatch(/That is a cancellation, not a void/);
    expect((await stay(id)).status).toBe("checked_in");
    expect((await roomLines(id)).every((l) => l.live)).toBe(true);
  });

  it("voided, with only the check-in's own night on the bill", async () => {
    const id = await inHouse("104");
    const res = await call(gm, `/stays/${id}/void`, "POST", { reason: "Entered twice" });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await stay(id)).status).toBe("void");
    expect(await held(id)).toEqual([]);
  });

  it("the front desk is told to ask", async () => {
    const id = await inHouse("106");
    expect(await said(await call(desk, `/stays/${id}/void`, "POST", { reason: "Twice" }))).toMatch(/^After check-in this is the GM's/);
  });
});

describe("the arrival of a guest in house", () => {
  let late = "";
  it("the front desk may not move it", async () => {
    /* Booked for 25 August, a closed day; came on the 26th. */
    late = await checkIn(await booking("2026-08-25", "2026-08-28"), "109");
    expect(await said(await call(desk, `/stays/${late}`, "PATCH", { checkIn: "2026-08-26" })))
      .toBe("they arrived on 2026-08-25, and that cannot move");
  });

  it("asked, the GM's approval moves it to the business date, and the room hold with it", async () => {
    expect((await ask(late, { kind: "arrival", checkIn: "2026-08-26", reason: "Came a day late" })).status).toBe(200);
    const a = await approvalFor(gm, "Change the arrival from 2026-08-25 to 2026-08-26");
    expect(a).toMatchObject({ mayDecide: true, status: "pending" });
    const ok = await call(gm, `/approvals/${a!.id}/approved`, "POST", {});
    expect(ok.status, await ok.clone().text()).toBe(200);
    expect((await stay(late)).check_in).toBe("2026-08-26");
    expect((await held(late))[0]?.from).toBe("2026-08-26");
    expect(await request(late, "arrival")).toBe("approved");
  });

  it("into a closed day the approval is refused, and the request waits", async () => {
    expect((await ask(late, { kind: "arrival", checkIn: "2026-08-25", reason: "Back again" })).status).toBe(200);
    const a = await approvalFor(gm, "Change the arrival from 2026-08-26 to 2026-08-25");
    const res = await call(gm, `/approvals/${a!.id}/approved`, "POST", {});
    expect(res.status).toBe(409);
    expect(await said(res)).toMatch(/the night of 2026-08-25 is closed by a Night audit/);
    expect(await request(late, "arrival")).toBe("pending");
    expect((await approvalFor(gm, "to 2026-08-25"))?.status).toBe("pending");
    expect(await said(await call(gm, `/approvals/${a!.id}/rejected`, "POST", {}))).toMatch(/Say why/);
    expect((await call(gm, `/approvals/${a!.id}/rejected`, "POST", { note: "That day is closed" })).status).toBe(200);
    expect(await request(late, "arrival")).toBe("rejected");
  });

  it("the GM moves it directly", async () => {
    const id = await checkIn(await booking("2026-08-25", "2026-08-28"), "110");
    const res = await call(gm, `/stays/${id}`, "PATCH", { checkIn: "2026-08-26" });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await stay(id)).check_in).toBe("2026-08-26");
  });
});

describe("the front desk asks the GM", () => {
  let id = "";
  let upi = "";
  it("undo: sent with a reason, once, in the GM's inbox; approved, it is done", async () => {
    id = await inHouse("111");
    expect(await said(await ask(id, { kind: "undo_check_in", reason: "" }))).toBe("Say why, for the GM.");
    expect((await ask(id, { kind: "undo_check_in", reason: "Wrong guest" })).status).toBe(200);
    expect(await said(await ask(id, { kind: "undo_check_in", reason: "Again" }))).toBe("This is already with the GM.");
    expect((await approvalFor(desk, "Undo the check-in"))?.mayDecide).toBe(false);
    const a = await approvalFor(gm, `Undo the check-in - ACI guest, room 111`);
    expect(a).toMatchObject({ mayDecide: true, status: "pending" });
    expect((await call(gm, `/approvals/${a!.id}/approved`, "POST", {})).status).toBe(200);
    expect((await stay(id)).status).toBe("confirmed");
    expect(await request(id, "undo_check_in")).toBe("approved");
  });

  it("asked about a charge still on the bill: refused before it reaches the GM", async () => {
    const other = await inHouse("112");
    await call(desk, `/stays/${other}/charges`, "POST",
      { category: "misc", description: "Minibar", amount: 150, taxable: false, businessDate: "2026-08-26" });
    expect(await said(await ask(other, { kind: "void", reason: "Twice" }))).toMatch(/^Minibar \(₹150\.00\) is still on the bill/);
  });

  it("the rate: approved, the night charged is corrected", async () => {
    id = await inHouse("113");
    upi = await pay(id, "UPI", 700);
    expect((await ask(id, { kind: "rate", rate: 2500, reason: "Corporate rate" })).status).toBe(200);
    const a = await approvalFor(gm, "Change the rate to ₹2,500.00 a night");
    expect((await call(gm, `/approvals/${a!.id}/approved`, "POST", {})).status).toBe(200);
    expect((await stay(id)).rate).toBe("2500.00");
    expect((await roomLines(id)).filter((l) => l.live).map((l) => l.amount)).toEqual(["2500.00"]);
  });

  it("how a payment was taken: approved, the payment reversed and taken the new way, the same amount and day", async () => {
    await pay(await inHouse("116"), "Cash", 100);   // the desk's drawer is open
    expect((await ask(id, { kind: "payment_method", postingId: upi, method: "Cash", reason: "Paid in cash" })).status).toBe(200);
    const a = await approvalFor(gm, "Change how ₹700.00 was paid: UPI to Cash");
    expect((await call(gm, `/approvals/${a!.id}/approved`, "POST", {})).status).toBe(200);
    const lines = await sql<{ description: string; amount: string; day: string; by: string; method: string | null; live: boolean }>(
      `select fp.description, fp.amount::text, fp.business_date::text as day, fp.posted_by::text as by, p.method,
              not exists (select 1 from folio_postings x where x.reverses_id = fp.id) as live
         from folio_postings fp join folios f on f.id = fp.folio_id left join payments p on p.posting_id = fp.id
        where f.reservation_id = $1 and fp.category = 'payment' order by fp.id`, [id]);
    expect(lines).toEqual([
      expect.objectContaining({ description: "Received - UPI", amount: "-700.00", live: false }),
      expect.objectContaining({ description: "Reversal - Received - UPI (why: UPI to Cash: Paid in cash (asked, approved))", amount: "700.00" }),
      expect.objectContaining({ description: "Received - Cash (was UPI)", amount: "-700.00", day: "2026-08-26", by: desk, method: "cash", live: true }),
    ]);
  });

  it("the GM does it themselves", async () => {
    expect(await said(await call(gm, `/stays/${id}/requests`, "POST", { kind: "undo_check_in", reason: "x" })))
      .toBe("You may do this yourself, from the guest's menu.");
    expect(await said(await call(gm, `/stays/${id}/requests`, "POST", { kind: "rate", rate: 1, reason: "x" })))
      .toBe("You may do this yourself.");
  });

  it("with no rule at the hotel, nothing is sent", async () => {
    await sql("update approval_rules set is_active = false where hotel_id = $1 and kind = 'stay_request'", [hotelId]);
    try {
      expect(await said(await ask(id, { kind: "undo_check_in", reason: "Wrong guest" })))
        .toBe("Nobody is set to approve these at this hotel. Call the GM.");
    } finally {
      await sql("update approval_rules set is_active = true where hotel_id = $1 and kind = 'stay_request'", [hotelId]);
    }
  });
});

describe("how a payment was taken, changed by the GM", () => {
  let id = "";
  let cash = "";
  it("is not the front desk's", async () => {
    id = await inHouse("114");
    cash = await pay(id, "Cash", 400);
    expect((await call(desk, `/stays/${id}/payments/${cash}/method`, "POST", { method: "UPI", reason: "x" })).status).toBe(403);
  });

  it("refused: no reason, the same way, Bill to company, a closed day", async () => {
    const change = (posting: string, method: string, reason = "Typed wrong", stayId = id) =>
      call(gm, `/stays/${stayId}/payments/${posting}/method`, "POST", { method, reason });
    expect(await said(await change(cash, "UPI", ""))).toMatch(/^Say why it is changed/);
    expect(await said(await change(cash, "Cash"))).toBe("It was taken by Cash already.");
    expect(await said(await change(cash, "Bill to company"))).toMatch(/^Billing a company is not a way of paying/);
    expect(await said(await change(closedPayment, "Cash", "Typed wrong", closedStay))).toMatch(/^This day is closed by the Night audit/);
  });

  it("refused once the cash drawer it was counted in is closed", async () => {
    await sql(`update cashier_shifts set counted_cash = 0, closed_by = staff_id, closed_at = now()
                where hotel_id = $1 and staff_id = $2 and closed_at is null`, [hotelId, desk]);
    expect(await said(await call(gm, `/stays/${id}/payments/${cash}/method`, "POST", { method: "UPI", reason: "Typed wrong" })))
      .toMatch(/^The cash drawer this payment was counted in has been closed/);
  });

  it("to cash: refused while the person who took it has no drawer open", async () => {
    const upi = await pay(id, "UPI", 200);
    expect(await said(await call(gm, `/stays/${id}/payments/${upi}/method`, "POST", { method: "Cash", reason: "Paid in cash" })))
      .toMatch(/^The person who took it has no cash drawer open/);
  });
});

describe("Change room type: the booking's type follows the room", () => {
  it("a move with changeType gives the booking the room's type; a plain move keeps the booked type (D27-328)", async () => {
    const id = await inHouse("115");
    const plain = await call(gm, `/stays/${id}/move`, "POST", { roomNumber: "201", from: "2026-08-26", reason: "upgrade" });
    expect(plain.status, await plain.clone().text()).toBe(200);
    expect((await stay(id)).type).toBe("STD");
    const typed = await call(gm, `/stays/${id}/move`, "POST",
      { roomNumber: "202", from: "2026-08-26", reason: "upgrade", changeType: true, agreedRate: 3000 });
    expect(typed.status, await typed.clone().text()).toBe(200);
    expect(await stay(id)).toMatchObject({ type: other, rate: "3000.00" });
  });
});
