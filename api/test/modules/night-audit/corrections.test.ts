import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool } from "../../../src/db.ts";
import type { ReportDoc } from "../../../src/modules/reports/index.ts";

/* ══════════════════════════════════════════════════════════════════
   CORRECTING A CLOSED DAY (D22-18; the owner's D24-1 to D24-9)

   At Pune, like nightAudit.test.ts: a guest is checked in, the day is
   closed through the real route, and its room charge is corrected by the
   GM. What is asserted:

     · the old line stays; the reversal and the right charge sit on the
       closed day; the Night Audit and Manager reports for that day move
       by exactly the difference; Closed days shows old → new
     · reception is refused, and every refusal writes nothing
     · taking a charge off a checked-out guest's bill is allowed (D24-8)
     · the desk's Reverse on that day says where to go (D24-9, D25-11)
     · every other charge is corrected the same way (D25-5 to D25-10): the
       laundry, a restaurant bill charged to the room (which stays under
       "POS to PMS Posting"), drinks under VAT (their VAT kept); drinks whose
       VAT bill stands, and a payment, are refused

   Each run closes one more day at Pune and leaves it closed, as
   nightAudit.test.ts does; the test database is dropped after the run.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";
const admin = async () =>
  new (await import("pg")).default.Pool({ connectionString: SUPER });

const tag = `NAC-${process.pid}`;
let ownerId: string;
let gmId: string;
let deskId: string;
let puneId: string;

const as = (who: string, path: string, body?: unknown) =>
  app.request(`/api/hotels/PUN${path}`, body === undefined
    ? { headers: { "x-dev-staff-id": who } }
    : {
        method: "POST",
        headers: { "x-dev-staff-id": who, "content-type": "application/json" },
        body: JSON.stringify(body),
      });

async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const db = await admin();
  try {
    return (await db.query(text, params)).rows as T[];
  } finally {
    await db.end();
  }
}

const businessDate = async () =>
  (await sql<{ d: string }>("select to_char(app.business_date($1), 'YYYY-MM-DD') as d", [puneId]))[0]!.d;

/** A guest in a room at Pune, checked in today for three nights. SQL, not the
    check-in flow: this file tests the correction, not check-in. */
async function checkIn(rate: number) {
  const bd = await businessDate();
  const [room] = await sql<{ id: string; number: string; type_id: string }>(
    `select rm.id, rm.number, rm.room_type_id as type_id from rooms rm
      where rm.hotel_id = $1 and rm.housekeeping_status = 'clean'
        and not exists (select 1 from room_assignments ra
                         where ra.room_id = rm.id and ra.released_at is null)
      order by rm.number limit 1`, [puneId]);
  const [guest] = await sql<{ id: string }>(
    "insert into guests (full_name, phone) values ($1, '+91 00000 00130') returning id",
    [`${tag} guest ${room!.number}`]);
  const [res] = await sql<{ id: string }>(
    `insert into reservations (hotel_id, guest_id, room_type_id, reference, check_in,
                               check_out, adults, status, source, agreed_rate)
     values ($1, $2, $3, $4, $5::date, $5::date + 3, 1, 'checked_in', 'direct', $6)
     returning id`,
    /* No timestamp at the end: app.next_reference takes the largest number a
       reference ends in, and this booking outlives the file (it sits on a
       closed day). A timestamp there broke every later booking at Pune. */
    [puneId, guest!.id, room!.type_id, `${tag}-${room!.number}`, bd, rate]);
  await sql(
    `insert into room_assignments (hotel_id, reservation_id, room_id, from_date, to_date, reason)
     values ($1, $2, $3, $4::date, $4::date + 3, 'arrival')`,
    [puneId, res!.id, room!.id, bd]);
  const [folio] = await sql<{ id: string }>(
    "insert into folios (hotel_id, reservation_id, status) values ($1, $2, 'open') returning id",
    [puneId, res!.id]);
  return { stayId: res!.id, folioId: folio!.id };
}

/** What a person at the desk does before closing: everyone due out, out. */
async function clearDueOuts() {
  const bd = await businessDate();
  const due = `select id from reservations
                where hotel_id = $1 and status = 'checked_in' and check_out <= $2::date`;
  await sql(`update room_assignments set released_at = now()
              where released_at is null and reservation_id in (${due})`, [puneId, bd]);
  await sql(`update folios set status = 'closed' where reservation_id in (${due})`, [puneId, bd]);
  await sql(`update reservations set status = 'checked_out' where id in (${due})`, [puneId, bd]);
}

let day: string;
let stay: { stayId: string; folioId: string };
let charge: string;
let laundry: string;
let food: string;
let drinks: string;
let payment: string;
let minibar: string;
let refund: string;
let vatBill: string;

beforeAll(async () => {
  [{ id: ownerId }] = await sql<{ id: string }>("select id from staff where email = 'owner@fidato.in'") as [{ id: string }];
  [{ id: puneId }] = await sql<{ id: string }>("select id from hotels where code = 'PUN'") as [{ id: string }];
  [{ id: gmId }] = await sql<{ id: string }>(
    "insert into staff (email, full_name) values ($1, 'Correction GM') returning id",
    [`${tag.toLowerCase()}-gm@fidato.in`]) as [{ id: string }];
  [{ id: deskId }] = await sql<{ id: string }>(
    "insert into staff (email, full_name) values ($1, 'Correction Desk') returning id",
    [`${tag.toLowerCase()}-desk@fidato.in`]) as [{ id: string }];
  await sql(`insert into staff_hotels (staff_id, hotel_id, role)
             values ($1, $3, 'gm'), ($2, $3, 'front_desk')`, [gmId, deskId, puneId]);

  /* A day with a room charge and a laundry charge on it, closed. */
  await clearDueOuts();
  stay = await checkIn(3000);
  day = await businessDate();
  const posted = await as(deskId, `/stays/${stay.stayId}/charges`,
    { category: "Laundry", description: `${tag} laundry`, amount: 200 });
  expect(posted.status, await posted.clone().text()).toBe(200);
  const bar = await as(deskId, `/stays/${stay.stayId}/charges`,
    { category: "Minibar", description: `${tag} minibar`, amount: 80 });
  expect(bar.status, await bar.clone().text()).toBe(200);
  /* A refund is a line above zero, like a charge: only its category keeps
     it off Closed days (a payment is below zero). */
  const back = await as(ownerId, `/stays/${stay.stayId}/charges`,
    { category: "Refund", description: `${tag} refund`, amount: 50, taxable: false });
  expect(back.status, await back.clone().text()).toBe(200);
  const paid = await as(ownerId, `/stays/${stay.stayId}/payments`, { method: "Cash", amount: 100 });
  expect(paid.status, await paid.clone().text()).toBe(200);
  /* A restaurant bill charged to the room: its food under GST and its drinks
     under VAT, as the till writes them (till.ts; alcoholVat.test.ts rings
     them there). Written here because Pune has no till, and this file tests
     the correction, not the till. */
  await sql(
    `insert into folio_postings (hotel_id, folio_id, business_date, category, description,
                                 amount, tax_rate, tax_amount, tax_scheme, source_type, source_id)
     values ($1, $2, $3::date, 'food', $4 || ' (5%)', 400, 5, 20, 'gst', 'pos', gen_random_uuid()),
            ($1, $2, $3::date, 'food', $4 || ' (VAT 10%)', 500, 10, 50, 'vat', 'pos', gen_random_uuid())`,
    [puneId, stay.folioId, day, `Restaurant - ${tag}`]);
  const closed = await as(ownerId, "/night-audit/run", { businessDate: day });
  expect(closed.status, await closed.clone().text()).toBe(200);

  [{ id: charge }] = await sql<{ id: string }>(
    `select id::text from folio_postings where folio_id = $1 and category = 'room'
        and business_date = $2::date`, [stay.folioId, day]) as [{ id: string }];
  const line = async (where: string) => (await sql<{ id: string }>(
    `select id::text from folio_postings where folio_id = $1 and ${where}`, [stay.folioId]))[0]!.id;
  laundry = await line(`description = '${tag} laundry'`);
  food = await line("source_type = 'pos' and tax_scheme = 'gst'");
  drinks = await line("source_type = 'pos' and tax_scheme = 'vat'");
  payment = await line("category = 'payment'");
  minibar = await line(`description = '${tag} minibar'`);
  refund = await line("category = 'refund'");
});

/* The stay, its bill and its corrections stay behind: they are on a closed
   day, append-only, and the test database is dropped after the run. What
   later files need back is Pune's room, and nobody else's staff. */
afterAll(async () => {
  await sql("delete from night_audit_runs where hotel_id = $1 and business_date = '2020-01-01'", [puneId]);
  /* Released, then clean again: a release dirties the room (074), and the
     files after this one look for a clean, free room at Pune. */
  await sql("update room_assignments set released_at = now() where reservation_id = $1 and released_at is null",
    [stay.stayId]);
  await sql(`update rooms set housekeeping_status = 'clean'
              where id in (select room_id from room_assignments where reservation_id = $1)`, [stay.stayId]);
  await sql("update reservations set status = 'checked_out' where id = $1", [stay.stayId]);
  await sql("delete from staff_hotels where staff_id in ($1, $2)", [gmId, deskId]);
  await closePool();
});

/* ── The reports for one day ──────────────────────────────────────── */

const report = async (key: string) =>
  (await (await as(ownerId, `/reports/${key}?asOn=${day}`)).json()) as ReportDoc;

const cells = (doc: ReportDoc, section: string, pick: (c: Record<string, unknown>) => boolean) => {
  const r = doc.sections.find((s) => s.key === section)?.rows.find((x) => pick(x.cells));
  expect(r, `${doc.report} / ${section}`).toBeDefined();
  return r!.cells as Record<string, number>;
};

const figures = async () => {
  const na = await report("night-audit");
  const mgr = await report("manager");
  const roomCharges = cells(na, "room-charges", (c) => String(c["room"]).startsWith("Total"));
  const sales = cells(na, "daily-sales", (c) => c["salesType"] === "Total");
  const today = (section: string, label: string) =>
    cells(mgr, section, (c) => c["label"] === label)["today"]!;
  return {
    naRoom: roomCharges["offered"]!,
    naTax: roomCharges["tax"]!,
    salesRoom: sales["room"]!,
    salesExtra: sales["extra"]!,
    salesExtraTax: sales["extraTax"]!,
    salesTotal: sales["totalSales"]!,
    managerRoom: today("room-charges", "Room Charges"),
    managerLaundry: today("extra-charges", "Laundry"),
    managerFood: today("extra-charges", "Food"),
    managerPos: today("revenue", "POS to PMS Posting"),
  };
};

/** How far each figure moved. */
const moved = (a: Awaited<ReturnType<typeof figures>>, b: typeof a) =>
  Object.fromEntries(Object.keys(a).map((k) =>
    [k, Math.round((b[k as keyof typeof a] - a[k as keyof typeof a]) * 100) / 100]));

const correct = (postingId: string, newAmount: number, reason: string) =>
  as(gmId, `/night-audit/days/${day}/corrections`, { postingId, newAmount, reason });

/** The line a correction put on the bill in place of `postingId`. */
const rightCharge = async (postingId: string) => (await sql<{
  id: string; amount: string; tax_rate: string; tax_amount: string; tax_scheme: string;
}>(
  `select n.id::text, n.amount::text, n.tax_rate::text, n.tax_amount::text, n.tax_scheme
     from closed_day_corrections c
     join folio_postings n on n.source_id = c.id and n.reverses_id is null
    where c.posting_id = $1`, [postingId]))[0]!;

const written = async () => (await sql<{ n: string }>(
  `select (select count(*) from closed_day_corrections where hotel_id = $1)
        + (select count(*) from folio_postings where hotel_id = $1) as n`, [puneId]))[0]!.n;

/* ── The correction ───────────────────────────────────────────────── */

describe("the GM corrects a room charge on a closed day", () => {
  it("keeps the old line, puts the reversal and the right charge on that day, and moves its reports by exactly the difference", async () => {
    const before = await figures();

    const res = await as(gmId, `/night-audit/days/${day}/corrections`,
      { postingId: charge, newAmount: 2500, reason: "Corporate rate, not rack" });
    expect(res.status, await res.clone().text()).toBe(200);

    const lines = await sql<{ amount: string; tax_amount: string; reverses_id: string | null; source_type: string }>(
      `select amount::text, tax_amount::text, reverses_id::text, source_type from folio_postings
        where folio_id = $1 and business_date = $2::date and category = 'room' order by id`,
      [stay.folioId, day]);
    expect(lines.map((l) => [Number(l.amount), Number(l.tax_amount), l.reverses_id, l.source_type])).toEqual([
      [3000, 150, null, "night_audit"],
      [-3000, -150, charge, "correction"],
      [2500, 125, null, "correction"],
    ]);

    const after = await figures();
    expect(after.naRoom - before.naRoom).toBeCloseTo(-500, 2);
    expect(after.naTax - before.naTax).toBeCloseTo(-25, 2);
    expect(after.salesRoom - before.salesRoom).toBeCloseTo(-500, 2);
    expect(after.managerRoom - before.managerRoom).toBeCloseTo(-500, 2);

    const [kept] = await sql<{ old_amount: string; new_amount: string; reason: string; corrected_by: string }>(
      "select old_amount::text, new_amount::text, reason, corrected_by::text from closed_day_corrections where posting_id = $1",
      [charge]);
    expect(kept).toEqual({ old_amount: "3000.00", new_amount: "2500.00",
      reason: "Corporate rate, not rack", corrected_by: gmId });
  });

  it("shows on Closed days as old → new, and in the day's corrections", async () => {
    const runs = (await (await as(deskId, "/night-audit/runs")).json()) as Array<{
      businessDate: string; revenuePosted: number | null; correctedRevenue: number | null; corrections: number;
    }>;
    const row = runs.find((r) => r.businessDate === day)!;
    expect(row.corrections).toBe(1);
    expect(row.correctedRevenue).toBeCloseTo(row.revenuePosted! - 500, 2);

    const dayView = (await (await as(deskId, `/night-audit/days/${day}/charges`)).json()) as {
      charges: Array<{ description: string; amount: number }>;
      corrections: Array<{ oldAmount: number; newAmount: number; reason: string; by: string }>;
    };
    expect(dayView.corrections).toEqual([expect.objectContaining({
      oldAmount: 3000, newAmount: 2500, reason: "Corporate rate, not rack", by: "Correction GM" })]);
    expect(dayView.charges.some((c) => c.amount === 3000)).toBe(false);
  });
});

describe("the GM corrects the day's other charges (D25-5 to D25-10)", () => {
  it("the laundry: the right charge at the tax it was charged at, and the day's reports move by exactly the difference", async () => {
    const before = await figures();
    const res = await correct(laundry, 150, "Two shirts, not three");
    expect(res.status, await res.clone().text()).toBe(200);

    const [old] = await sql<{ tax_rate: string; tax_amount: string }>(
      "select tax_rate::text, tax_amount::text from folio_postings where id = $1", [laundry]);
    const now = await rightCharge(laundry);
    expect([Number(now.amount), now.tax_rate, now.tax_scheme]).toEqual([150, old!.tax_rate, "gst"]);
    const taxDiff = Number(now.tax_amount) - Number(old!.tax_amount);

    expect(moved(before, await figures())).toEqual({
      naRoom: 0, naTax: 0, salesRoom: 0,
      salesExtra: -50, salesExtraTax: taxDiff, salesTotal: -50 + taxDiff,
      managerRoom: 0, managerLaundry: -50, managerFood: 0, managerPos: 0,
    });
  });

  it("a restaurant bill charged to the room: the room bill's line only, still under POS to PMS Posting - corrected twice", async () => {
    const before = await figures();
    const res = await correct(food, 300, "One dish sent back");
    expect(res.status, await res.clone().text()).toBe(200);
    const now = await rightCharge(food);
    expect([Number(now.amount), Number(now.tax_rate), Number(now.tax_amount), now.tax_scheme])
      .toEqual([300, 5, 15, "gst"]);
    const once = await figures();
    expect(moved(before, once)).toEqual({
      naRoom: 0, naTax: 0, salesRoom: 0, salesExtra: -100, salesExtraTax: -5, salesTotal: -105,
      managerRoom: 0, managerLaundry: 0, managerFood: 0, managerPos: -105,
    });

    /* A correction of the correction keeps where the charge came from. */
    const again = await correct(now.id, 250, "And a drink not served");
    expect(again.status, await again.clone().text()).toBe(200);
    expect(moved(once, await figures())).toMatchObject({ managerFood: 0, managerPos: -52.5, salesExtra: -50 });

    const dayView = (await (await as(gmId, `/night-audit/days/${day}/charges`)).json()) as {
      charges: Array<{ id: string; kind: string }>;
    };
    const last = await rightCharge(now.id);
    expect(dayView.charges.find((c) => c.id === last.id)?.kind).toBe("restaurant");
  });

  it("drinks under VAT with no VAT bill yet: corrected like any charge, their VAT kept", async () => {
    const before = await figures();
    const res = await correct(drinks, 400, "Poured one, billed two");
    expect(res.status, await res.clone().text()).toBe(200);
    const now = await rightCharge(drinks);
    expect([Number(now.amount), Number(now.tax_rate), Number(now.tax_amount), now.tax_scheme])
      .toEqual([400, 10, 40, "vat"]);
    expect(moved(before, await figures())).toMatchObject({
      salesExtra: -100, salesExtraTax: -10, managerFood: 0, managerPos: -110,
    });
  });
});

/** The room line on the closed day that still stands. */
const standing = async () => (await sql<{ id: string }>(
  `select id::text from folio_postings fp where folio_id = $1 and business_date = $2::date
      and category = 'room' and reverses_id is null
      and not exists (select 1 from folio_postings r where r.reverses_id = fp.id)`,
  [stay.folioId, day]))[0]!.id;

describe("what is refused, writing nothing", () => {
  const refused = async (who: string, date: string, body: unknown) => {
    const was = await written();
    const res = await as(who, `/night-audit/days/${date}/corrections`, body);
    expect(await written()).toBe(was);
    return { status: res.status, text: await res.text() };
  };

  it("reception", async () => {
    const r = await refused(deskId, day, { postingId: await standing(), newAmount: 2000, reason: "x" });
    expect(r.status).toBe(403);
  });

  it("no reason", async () => {
    const r = await refused(gmId, day, { postingId: await standing(), newAmount: 2000, reason: "  " });
    expect(r.status).toBe(400);
  });

  it("a line already corrected", async () => {
    const r = await refused(gmId, day, { postingId: charge, newAmount: 2000, reason: "again" });
    expect(r.status).toBe(409);
  });

  it("a refund: not a charge (D25-5)", async () => {
    const r = await refused(gmId, day, { postingId: refund, newAmount: 20, reason: "counted wrong" });
    expect(r.status).toBe(409);
    expect(r.text).toContain("Payments, refunds and discounts are not corrected here.");
  });

  it("a day not closed", async () => {
    const r = await refused(gmId, await businessDate(), { postingId: charge, newAmount: 2000, reason: "x" });
    expect(r.status).toBe(409);
    expect(r.text).toContain("is not closed");
  });

  it("a day older than last month", async () => {
    await sql(`insert into night_audit_runs (hotel_id, business_date, status, completed_at)
               values ($1, '2020-01-01', 'completed', now()) on conflict do nothing`, [puneId]);
    const r = await refused(gmId, "2020-01-01", { postingId: charge, newAmount: 2000, reason: "x" });
    expect(r.status).toBe(409);
    expect(r.text).toContain("this month's and last month's");
  });

  it("a bill with a tax invoice: a credit note is for that", async () => {
    const [{ id: inv }] = await sql<{ id: string }>(
      `insert into invoices (hotel_id, folio_id, fin_year, number, total, tax_total)
       values ($1, $2, '2099-00', $3, 2625, 125) returning id`,
      [puneId, stay.folioId, `${tag}-INV`]) as [{ id: string }];
    const r = await refused(gmId, day, { postingId: await standing(), newAmount: 2000, reason: "x" });
    expect(r.status).toBe(409);
    expect(r.text).toContain(`This bill has tax invoice ${tag}-INV. Issue a credit note instead.`);

    /* Its drinks' VAT bill, issued with it as the invoice route does (135). */
    [{ n: vatBill }] = await sql<{ n: string }>("select app.issue_vat_bill($1, null) as n", [inv]) as [{ n: string }];

    /* An invoice is never deleted; a credit note spends it, and the bill may
       then be corrected (and invoiced again). */
    await sql(`insert into invoices (hotel_id, folio_id, fin_year, number, total, tax_total, credits_id, reason)
               values ($1, $2, '2099-00', $3, -2625, -125, $4, 'test')`,
      [puneId, stay.folioId, `${tag}-CN`, inv]);
  });
});

describe("drinks whose VAT bill stands (D25-7)", () => {
  it("are refused, writing nothing, once the tax invoice is spent", async () => {
    const was = await written();
    const res = await correct((await rightCharge(drinks)).id, 300, "x");
    expect(await written()).toBe(was);
    expect(res.status).toBe(409);
    expect(await res.text()).toContain(`This bill has VAT bill ${vatBill}. Cancel the VAT bill instead.`);
  });
});

describe("the desk's Reverse on a closed day (D24-9, D25-11)", () => {
  it("sends a room charge to Closed days", async () => {
    const res = await as(ownerId, `/stays/${stay.stayId}/charges/${await standing()}/reverse`, {});
    expect(res.status).toBe(409);
    expect(await res.text()).toContain("This day is closed - correct it on Closed days.");
  });

  it("sends every other charge there too", async () => {
    const res = await as(ownerId, `/stays/${stay.stayId}/charges/${minibar}/reverse`, {});
    expect(res.status).toBe(409);
    expect(await res.text()).toContain("This day is closed - correct it on Closed days.");
  });

  it("says a payment is not changed", async () => {
    const res = await as(ownerId, `/stays/${stay.stayId}/charges/${payment}/reverse`, {});
    expect(res.status).toBe(409);
    expect(await res.text()).toContain("This day is closed. Its payments, refunds and discounts are not changed - put the difference right today.");
  });
});

describe("a guest who has left and paid (D24-8)", () => {
  it("can have the charge taken off: the reversal alone, and the bill shows what they are owed", async () => {
    await sql("update reservations set status = 'checked_out' where id = $1", [stay.stayId]);
    await sql("update folios set status = 'closed' where id = $1", [stay.folioId]);
    const line = (await sql<{ id: string }>(
      `select id::text from folio_postings fp where folio_id = $1 and source_type = 'correction'
          and category = 'room' and reverses_id is null`, [stay.folioId]))[0]!.id;

    const res = await as(gmId, `/night-audit/days/${day}/corrections`,
      { postingId: line, newAmount: 0, reason: "Guest had left the day before" });
    expect(res.status, await res.clone().text()).toBe(200);

    const [{ n, total }] = await sql<{ n: string; total: string }>(
      `select count(*)::text as n, sum(amount)::text as total from folio_postings
        where folio_id = $1 and category = 'room'`, [stay.folioId]) as [{ n: string; total: string }];
    expect([n, Number(total)]).toEqual(["4", 0]);

    /* A correction of a correction still moves the audit's figure: the
       3,000 it posted is now all gone from it. The four corrections of the
       other charges are counted and move no room revenue. */
    const runs = (await (await as(gmId, "/night-audit/runs")).json()) as Array<{
      businessDate: string; revenuePosted: number; correctedRevenue: number; corrections: number;
    }>;
    const row = runs.find((r) => r.businessDate === day)!;
    expect(row.corrections).toBe(6);
    expect(row.correctedRevenue).toBeCloseTo(row.revenuePosted - 3000, 2);
  });
});
