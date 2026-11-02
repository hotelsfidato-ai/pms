import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";

/* ══════════════════════════════════════════════════════════════════
   THE 16 HOURS AND CANCELLING AN AUDIT (the owner's D27-389, D27-390)

   1 November at Amrapali: 1 November closed at 23:36 and 2 November at
   23:37. Now a day that has not begun is never closed; today's date closes
   under 16 hours after the last audit only with a reason, from the owner, an
   Admin or the GM; and the owner or an Admin can cancel audits, back to a
   chosen day, with what was made since moved back to it.

   Its own property (NAG), on the hotel's real calendar, deleted afterwards.
   One story, in order: days behind are caught up, today is closed early by
   the GM, the owner cancels back to the day before, and that day's audit,
   run again, charges the night again.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ?? "postgres://postgres:pw@127.0.0.1:55432/fidato";
const CODE = "NAG";
const staff = new Map<string, string>();
let hotelId = "";
let today = "";
const day = (offset: number) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
let stay = { id: "", folio: "" };
let noShow = { id: "", assignment: "" };

const sql = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Client({ connectionString: SUPER });
  await db.connect();
  try { return (await db.query(text, params)).rows as T[]; } finally { await db.end(); }
};
const call = (who: string, path: string, method = "GET", body?: unknown) =>
  app.request(`/api/hotels/${CODE}${path}`, {
    method,
    headers: {
      "x-dev-staff-id": staff.get(who) ?? who,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const close = (who: string, businessDate: string, reason?: string) =>
  call(who, "/night-audit/run", "POST", { businessDate, ...(reason ? { reason } : {}) });
const onDate = async () =>
  (await sql<{ d: string }>("select app.business_date($1)::text as d", [hotelId]))[0]!.d;

beforeAll(async () => {
  const db = new (await import("pg")).default.Client({ connectionString: SUPER });
  await db.connect();
  try {
    const owner = (await db.query("select id::text from staff where email = 'owner@fidato.in'")).rows[0].id;
    staff.set("owner", owner);
    await db.query("select set_config('app.user_id', $1, false)", [owner]);
    hotelId = (await db.query(
      "select app.provision_property_unchecked($1, 'Night Audit Guard', 'Nowhere')::text as id", [CODE])).rows[0].id;
  } finally { await db.end(); }
  today = (await sql<{ d: string }>(
    "select (now() at time zone timezone)::date::text as d from hotels where id = $1", [hotelId]))[0]!.d;
  /* Two days behind, open from midnight (D27-338 is opensAt.test.ts's). */
  await sql("update hotels set business_date = $2::date, night_audit_opens_at = '00:00' where id = $1",
    [hotelId, day(-2)]);
  await sql(`insert into tax_rules (hotel_id, kind, rate) select $1, 'room', 5
              where not exists (select 1 from tax_rules where hotel_id = $1 and kind = 'room')`, [hotelId]);
  const type = (await sql<{ id: string }>(
    `insert into room_types (hotel_id, code, name) values ($1, 'NAGT', 'Guard test')
     on conflict (hotel_id, code) do update set name = excluded.name returning id::text`, [hotelId]))[0]!.id;
  const rooms = await sql<{ id: string }>(
    `insert into rooms (hotel_id, room_type_id, number) values ($1, $2, '901'), ($1, $2, '902')
     returning id::text`, [hotelId, type]);
  for (const role of ["gm", "admin", "front_desk"]) {
    const id = (await sql<{ id: string }>(
      `insert into staff (email, full_name, firebase_uid) values ($1, $2, $3)
       on conflict (email) do update set is_active = true returning id::text`,
      [`nag-${role}@fidato.in`, `NAG ${role}`, `test-uid-nag-${role}`]))[0]!.id;
    await sql("delete from staff_hotels where staff_id = $1", [id]);
    await sql("insert into staff_hotels (staff_id, hotel_id, role) values ($1, $2, $3)", [id, hotelId, role]);
    staff.set(role, id);
  }

  /* In house from two days ago for four nights, and an arrival for yesterday who never comes. */
  const guest = (await sql<{ id: string }>(
    "insert into guests (full_name) values ('NAG in house') returning id::text"))[0]!.id;
  stay.id = (await sql<{ id: string }>(
    `insert into reservations (hotel_id, guest_id, room_type_id, reference, check_in, check_out,
                               adults, status, source, agreed_rate)
     values ($1, $2, $3, 'NAG-STAY', $4::date, $5::date, 1, 'checked_in', 'direct', 2000)
     returning id::text`, [hotelId, guest, type, day(-2), day(2)]))[0]!.id;
  await sql(`insert into room_assignments (hotel_id, reservation_id, room_id, from_date, to_date, reason)
             values ($1, $2, $3, $4::date, $5::date, 'arrival')`, [hotelId, stay.id, rooms[0]!.id, day(-2), day(2)]);
  stay.folio = (await sql<{ id: string }>(
    "insert into folios (hotel_id, reservation_id, status) values ($1, $2, 'open') returning id::text",
    [hotelId, stay.id]))[0]!.id;
  /* The first night was charged at check-in, as check-in does. */
  await sql(`insert into folio_postings (hotel_id, folio_id, reservation_id, business_date, category,
                                         description, amount, tax_rate, tax_amount, source_type)
             values ($1, $2, $3, $4::date, 'room', 'Room 101 · 1 night', 2000, 5, 100, 'check_in')`,
    [hotelId, stay.folio, stay.id, day(-2)]);
  const late = (await sql<{ id: string }>(
    "insert into guests (full_name) values ('NAG never came') returning id::text"))[0]!.id;
  noShow.id = (await sql<{ id: string }>(
    `insert into reservations (hotel_id, guest_id, room_type_id, reference, check_in, check_out,
                               adults, status, source, agreed_rate)
     values ($1, $2, $3, 'NAG-NOSHOW', $4::date, $5::date, 1, 'confirmed', 'direct', 1500)
     returning id::text`, [hotelId, late, type, day(-1), day(1)]))[0]!.id;
  noShow.assignment = (await sql<{ id: string }>(
    `insert into room_assignments (hotel_id, reservation_id, room_id, from_date, to_date, reason)
     values ($1, $2, $3, $4::date, $5::date, 'arrival') returning id::text`,
    [hotelId, noShow.id, rooms[1]!.id, day(-1), day(1)]))[0]!.id;
});

afterAll(async () => {
  await closePool();
  await sql("update group_settings set night_audit_undo = 'any_date' where id = 1");
  for (const [t, trg] of [["folio_postings", "folio_postings_append_only"], ["invoices", "invoices_immutable"]]) {
    await sql(`alter table ${t} disable trigger ${trg}`);
    try { await sql(`delete from ${t} where hotel_id = $1`, [hotelId]); }
    finally { await sql(`alter table ${t} enable trigger ${trg}`); }
  }
  for (const t of ["folios", "room_assignments", "night_audit_undos", "night_audit_runs", "cashier_shifts", "reservations",
                   "tax_rules", "rooms", "room_types"]) {
    await sql(`delete from ${t} where hotel_id = $1`, [hotelId]);
  }
  await sql("alter table guests disable trigger guests_no_delete");
  try { await sql("delete from guests where full_name like 'NAG %'"); }
  finally { await sql("alter table guests enable trigger guests_no_delete"); }
  await sql("delete from staff_hotels where hotel_id = $1", [hotelId]);
  await sql("alter table hotels disable trigger hotels_no_delete");
  try { await sql("delete from hotels where id = $1", [hotelId]); }
  finally { await sql("alter table hotels enable trigger hotels_no_delete"); }
});

describe("never a day that has not begun (D27-389)", () => {
  it("refuses tomorrow for everybody, the owner too, and the checklist says why", async () => {
    await sql("update hotels set business_date = $2::date where id = $1", [hotelId, day(1)]);
    try {
      const list = (await (await call("owner", "/night-audit")).json()) as {
        canRun: { allowed: boolean; blockers: { id: string }[] };
      };
      expect(list.canRun.allowed).toBe(false);
      expect(list.canRun.blockers.map((b) => b.id)).toContain("not-begun");
      const res = await close("owner", day(1), "the owner says so");
      expect(res.status).toBe(409);
      expect(((await res.json()) as { reason: string }).reason).toMatch(/has not begun at the hotel/);
    } finally {
      await sql("update hotels set business_date = $2::date where id = $1", [hotelId, day(-2)]);
    }
  });
});

describe("sixteen hours (D27-389)", () => {
  it("never holds days already over: reception catches up two in a row", async () => {
    expect((await close("front_desk", day(-2))).status).toBe(200);
    const second = await close("front_desk", day(-1));
    expect(second.status, await second.clone().text()).toBe(200);
    expect(await onDate()).toBe(today);
  });

  it("refuses reception today, and tells the GM and the owner what they may do", async () => {
    const desk = (await (await call("front_desk", "/night-audit")).json()) as {
      canRun: { allowed: boolean; reason: string }; early: { may: string };
    };
    expect(desk.early.may).toBe("refused");
    expect(desk.canRun.allowed).toBe(false);
    expect(desk.canRun.reason).toMatch(/16 hours after the last one/);
    const refused = await close("front_desk", today);
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { reason: string }).reason).toMatch(/16 hours/);

    const gm = (await (await call("gm", "/night-audit")).json()) as { early: { may: string }; calendarDate: string };
    expect(gm.early.may).toBe("warning");
    expect(gm.calendarDate).toBe(today);
    expect(((await (await call("owner", "/night-audit")).json()) as { early: { may: string } }).early.may).toBe("reason");
    expect(((await (await call("admin", "/night-audit")).json()) as { early: { may: string } }).early.may).toBe("reason");
  });

  it("lets the GM close today only with a reason, and keeps it with the run", async () => {
    const bare = await close("gm", today);
    expect(bare.status).toBe(409);
    expect(((await bare.json()) as { needsReason: boolean }).needsReason).toBe(true);

    const res = await close("gm", today, "The night auditor left early");
    expect(res.status, await res.clone().text()).toBe(200);
    const [run] = await sql<{ early_reason: string; early_by: string }>(
      "select early_reason, early_by::text from night_audit_runs where hotel_id = $1 and business_date = $2::date",
      [hotelId, today]);
    expect(run).toEqual({ early_reason: "The night auditor left early", early_by: staff.get("gm") });
    const days = (await (await call("owner", "/night-audit/runs")).json()) as { earlyReason: string | null }[];
    expect(days[0]!.earlyReason).toBe("The night auditor left early");
  });
});

describe("cancelling night audits (D27-390)", () => {
  it("is the owner's and an Admin's alone", async () => {
    expect((await call("front_desk", "/night-audit/undo")).status).toBe(403);
    expect((await call("gm", "/night-audit/undo", "POST", { backTo: today, reason: "no" })).status).toBe(403);
    expect((await call("admin", "/night-audit/undo")).status).toBe(200);
  });

  it("dry-runs what it would do, and writes nothing", async () => {
    /* Trade on the day that should not have opened: a charge and a drawer. */
    await sql(`insert into folio_postings (hotel_id, folio_id, reservation_id, business_date, category,
                                           description, amount, tax_rate, tax_amount, source_type)
               values ($1, $2, $3, $4::date, 'misc', 'Mineral water', 100, 0, 0, 'manual')`,
      [hotelId, stay.folio, stay.id, day(1)]);
    await sql(`insert into cashier_shifts (hotel_id, staff_id, business_date, opened_at, closed_at, counted_cash, closed_by)
               values ($1, $2, $3::date, now(), now(), 0, $2)`, [hotelId, staff.get("gm"), day(1)]);

    const res = await call("owner", `/night-audit/undo?to=${day(-1)}`);
    const dry = (await res.json()) as {
      ok: boolean; days: string[]; audits: { businessDate: string }[]; chargesReversed: number;
      noShowsRestored: number; moves: { table: string; byDay: Record<string, number> }[];
    };
    expect(dry.ok, JSON.stringify(dry)).toBe(true);
    expect(dry.days).toEqual([today, day(-1), day(-2)]);
    expect(dry.audits.map((a) => a.businessDate)).toEqual([day(-1), today]);
    expect(dry.chargesReversed).toBe(2);
    expect(dry.noShowsRestored).toBe(1);
    expect(dry.moves.find((m) => m.table === "folio_postings")!.byDay).toEqual({ [day(1)]: 1 });
    expect(dry.moves.find((m) => m.table === "cashier_shifts")!.byDay).toEqual({ [day(1)]: 1 });
    expect(await onDate()).toBe(day(1));
  });

  it("goes one audit at a time when the group says so", async () => {
    expect((await call("gm", "/night-audit/undo-mode", "PUT", { mode: "one_at_a_time" })).status).toBe(403);
    expect((await call("owner", "/night-audit/undo-mode", "PUT", { mode: "one_at_a_time" })).status).toBe(200);
    try {
      const dry = (await (await call("owner", `/night-audit/undo?to=${day(-1)}`)).json()) as { ok: boolean; refusal: string };
      expect(dry.ok).toBe(false);
      expect(dry.refusal).toMatch(/one at a time/);
    } finally {
      expect((await call("owner", "/night-audit/undo-mode", "PUT", { mode: "any_date" })).status).toBe(200);
    }
  });

  it("is refused while a GST tax invoice stands on those days", async () => {
    const [inv] = await sql<{ id: string }>(
      `insert into invoices (hotel_id, folio_id, fin_year, number, total, tax_total, business_date, issued_by)
       values ($1, $2, '2026-27', 'NAG/1', 100, 0, $3::date, $4) returning id::text`,
      [hotelId, stay.folio, day(1), staff.get("owner")]);
    try {
      const res = await call("owner", "/night-audit/undo", "POST", { backTo: day(-1), reason: "Test" });
      expect(res.status).toBe(409);
      expect(((await res.json()) as { reason: string }).reason).toMatch(/GST tax invoice NAG\/1.*credit note/);
      expect(await onDate()).toBe(day(1));
    } finally {
      await sql("alter table invoices disable trigger invoices_immutable");
      try { await sql("delete from invoices where id = $1", [inv!.id]); }
      finally { await sql("alter table invoices enable trigger invoices_immutable"); }
    }
  });

  it("goes back to the chosen day: charges reversed, the no-show booked again, the trade moved", async () => {
    expect((await call("owner", "/night-audit/undo", "POST", { backTo: day(-1) })).status).toBe(400);
    const res = await call("owner", "/night-audit/undo", "POST",
      { backTo: day(-1), reason: "Closed twice by mistake" });
    const done = (await res.json()) as { ok: boolean; businessDate: string; roomsHeldAgain: number };
    expect(res.status, JSON.stringify(done)).toBe(200);
    expect(done.businessDate).toBe(day(-1));
    expect(done.roomsHeldAgain).toBe(1);

    expect(await sql("select business_date::text as d, status from night_audit_runs where hotel_id = $1 order by 1",
      [hotelId])).toEqual([
      { d: day(-2), status: "completed" }, { d: day(-1), status: "cancelled" }, { d: today, status: "cancelled" }]);
    const reversed = await sql<{ d: string; amount: string }>(
      `select business_date::text as d, amount::text from folio_postings
        where folio_id = $1 and source_type = 'night_audit_undo' order by 1`, [stay.folio]);
    expect(reversed).toEqual([{ d: day(-1), amount: "-2000.00" }, { d: today, amount: "-2000.00" }]);
    expect(await sql("select status from reservations where id = $1", [noShow.id])).toEqual([{ status: "confirmed" }]);
    expect(await sql("select released_at from room_assignments where id = $1", [noShow.assignment]))
      .toEqual([{ released_at: null }]);
    expect(await sql("select business_date::text as d from folio_postings where folio_id = $1 and source_type = 'manual'",
      [stay.folio])).toEqual([{ d: day(-1) }]);
    expect(await sql("select business_date::text as d from cashier_shifts where hotel_id = $1", [hotelId]))
      .toEqual([{ d: day(-1) }]);

    const undos = (await (await call("owner", "/night-audit/undos")).json()) as
      { reason: string; backTo: string; audits: number }[];
    expect(undos[0]).toMatchObject({ reason: "Closed twice by mistake", backTo: day(-1), audits: 2 });
    expect(await sql("select count(*)::int as n from audit_log where table_name = 'night_audit_undos' and hotel_id = $1",
      [hotelId])).toEqual([{ n: 1 }]);
  });

  it("charges the night again when the day is closed again", async () => {
    const res = await close("owner", day(-1));
    expect(res.status, await res.clone().text()).toBe(200);
    const [standing] = await sql<{ n: number; total: string }>(
      `select count(*)::int as n, sum(amount)::text as total from folio_postings
        where folio_id = $1 and category = 'room' and business_date = $2::date`, [stay.folio, day(-1)]);
    expect(standing).toEqual({ n: 3, total: "2000.00" });
    expect(await sql("select status from reservations where id = $1", [noShow.id])).toEqual([{ status: "no_show" }]);
  });

  /* A bill line the application may not update at all (no grant); a closed
     drawer it may update, so there the guard alone must hold. */
  it("cannot be faked by setting the cancel's flag from the application", async () => {
    const db = new (await import("pg")).default.Client({
      connectionString: process.env["DATABASE_URL"] ?? "postgres://pms_app:CHANGE_ME_app@127.0.0.1:55432/fidato",
    });
    await db.connect();
    try {
      await db.query("begin");
      await db.query("select set_config('app.user_id', $1, true), set_config('app.audit_undo', $2, true)",
        [staff.get("owner"), hotelId]);
      await expect(db.query(
        "update cashier_shifts set business_date = business_date - 1 where hotel_id = $1",
        [hotelId])).rejects.toThrow(/already closed/);
    } finally {
      await db.query("rollback").catch(() => {});
      await db.end();
    }
  });
});
