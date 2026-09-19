import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool, withUser } from "../../../src/db.ts";
import {
  buildReport, propertyFor, dailyFigures, sumDays,
  type ReportDoc, type ReportSection,
} from "../../../src/modules/reports/index.ts";
import { dayBook, type DayBook } from "../../../src/modules/accounting/dayBook.ts";

/* ══════════════════════════════════════════════════════════════════
   THE EXPORT AND THE REPORTS CANNOT DISAGREE

   That is the whole of this service, so it is most of this file. The
   test that matters is not "the export returns numbers" - it is that
   the number it returns for a day is the SAME NUMBER the Manager
   report prints for that day, built by the other service, from its
   own code, through its own front door. If somebody ever replaces
   `dailyFigures()` here with a query over `folio_postings` that looks
   equivalent, this file goes red.

   The rest are the refusals. A guard is not a guard until it has
   refused something, and every one below was watched failing with its
   check taken out - written up in the service's CHANGELOG.

   NOTHING HERE WRITES. This service posts nothing, so unlike the
   reports' own tests there is no ledger to put back afterwards: every
   case is a read, and the fixture is the demo as loaded.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const sql = async (text: string, params: unknown[] = []) => {
  const db = new (await import("pg")).default.Pool({ connectionString: SUPER });
  try { return await db.query(text, params); } finally { await db.end(); }
};

let ownerId: string;
/** Reception at 5EL. Holds `report` in the matrix and must still be
    refused: the brief's line is the owner, an administrator and the GM. */
let deskId: string;
let hotelId: string;
let businessDate: string;
/** The month so far at the demo property - a real range with real money
    in it, rather than dates this file made up. */
let from: string;
let to: string;

const call = (path: string, staff?: string) =>
  app.request(`/api/hotels${path}`, { headers: { "x-dev-staff-id": staff ?? ownerId } });

const book = async (path: string, staff?: string) => {
  const r = await call(path, staff);
  return { status: r.status, body: await r.json() };
};

beforeAll(async () => {
  const staff = await sql(
    "select id::text, email from staff where email in ('owner@fidato.in','agra@fidato.in')",
  );
  ownerId = staff.rows.find((r) => r.email === "owner@fidato.in")!.id;
  deskId = staff.rows.find((r) => r.email === "agra@fidato.in")!.id;

  const property = await withUser(ownerId, (client) => propertyFor(client, "5EL"));
  hotelId = property!.id;
  businessDate = property!.businessDate;
  from = `${businessDate.slice(0, 7)}-01`;
  to = businessDate;
});

afterAll(async () => { await closePool(); });

const theBook = () => withUser(ownerId, async (client) => {
  const property = await propertyFor(client, "5EL");
  return dayBook(client, property!, from, to);
});

/** A row of a built report, by its section and its label. Reading a
    figure out of another service's document by the words it prints is
    deliberate: if somebody renames "Room Charges" the export may have
    drifted with it, and that is worth being told about. */
function reportCell(doc: ReportDoc, section: string, label: string, column: string): number {
  const s = (doc.sections as ReportSection[]).find((x) => x.key === section);
  const row = s?.rows.find((r) => r.cells["label"] === label);
  return Number(row?.cells[column]);
}

describe("the day book is the figures the reports already print", () => {
  it("a day's room revenue is the Manager report's Room Charges for that day", async () => {
    const b = await theBook();
    /* The last day of the range - the business date, which is the day
       the Manager report is normally run for. */
    const day = b.days[b.days.length - 1]!;

    const manager = await withUser(ownerId, (client) =>
      buildReport(client, hotelId, "manager", { asOn: day.date }));

    expect(reportCell(manager, "room-charges", "Room Charges", "today")).toBe(day.room);
  });

  it("takes its figures through the reports door and adds nothing of its own", async () => {
    const b = await theBook();
    const figures = await withUser(ownerId, (client) =>
      dailyFigures(client, hotelId, from, to));
    const totals = sumDays(figures);

    /* Room, extras, tax, discount and receipts are the reports service's
       to define. This service may arrange them; it may not restate them. */
    expect(b.total.room).toBe(totals.room);
    expect(b.total.roomTax).toBe(totals.roomTax);
    expect(b.total.extra).toBe(totals.extra);
    expect(b.total.extraTax).toBe(totals.extraTax);
    expect(b.total.discount).toBe(totals.discount);
    expect(b.total.receipt).toBe(totals.receipt);
    expect(b.days.map((d) => d.room)).toEqual(figures.map((f) => f.room));
  });
});

describe("money is money", () => {
  /** Rupees held as paise, so a comparison cannot be a float accident. */
  const paise = (n: number) => Math.round(n * 100);

  it("the days add up to the total of the range, to the paisa", async () => {
    const b = await theBook();
    const add = (pick: (d: DayBook["days"][number]) => number) =>
      b.days.reduce((t, d) => t + paise(pick(d)), 0);

    expect(add((d) => d.room)).toBe(paise(b.total.room));
    expect(add((d) => d.extra)).toBe(paise(b.total.extra));
    expect(add((d) => d.sales)).toBe(paise(b.total.sales));
    expect(add((d) => d.tax)).toBe(paise(b.total.tax));
    expect(add((d) => d.receipt)).toBe(paise(b.total.receipt));
  });

  it("every figure is two decimals and nothing drifts past them", async () => {
    const b = await theBook();
    const clean = (n: number) => expect(Math.round(n * 100) / 100).toBe(n);
    for (const d of b.days) {
      clean(d.room); clean(d.roomTax); clean(d.extra); clean(d.extraTax);
      clean(d.discount); clean(d.sales); clean(d.tax); clean(d.receipt);
    }
    clean(b.total.sales); clean(b.total.tax); clean(b.total.receipt);
  });

  it("sales are the room and the extras less the discount", async () => {
    const b = await theBook();
    for (const d of b.days) {
      expect(paise(d.sales)).toBe(paise(d.room) + paise(d.extra) - paise(d.discount));
      expect(paise(d.tax)).toBe(paise(d.roomTax) + paise(d.extraTax));
    }
  });
});

describe("a date belongs to the property", () => {
  /* This suite runs in UTC, as the hotel's own server does (root MEMORY
     297). A JS date anywhere in this service would move an Akkalkot sale
     into the day before on the way out, and these three would catch it:
     the range would start a day early, or come back one row short. */
  it("gives every day of the range, in order, and none of them moved", async () => {
    const b = await theBook();
    const expected = Number(to.slice(8, 10)) - Number(from.slice(8, 10)) + 1;

    expect(b.days).toHaveLength(expected);
    expect(b.days[0]!.date).toBe(from);
    expect(b.days[b.days.length - 1]!.date).toBe(to);
    expect(b.from).toBe(from);
    expect(b.to).toBe(to);
    for (const d of b.days) expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect([...b.days].sort((x, y) => x.date.localeCompare(y.date)).map((d) => d.date))
      .toEqual(b.days.map((d) => d.date));
  });

  it("heads the file with the property's own details, never a literal", async () => {
    const b = await theBook();
    const property = await withUser(ownerId, (client) => propertyFor(client, "5EL"));

    /* MEMORY 256: every report printed one hotel's name because a
       default sat in the code. The GSTIN and the name come from the
       property record through the reports door or they do not appear. */
    expect(b.property.name).toBe(property!.name);
    expect(b.property.code).toBe("5EL");
    expect(b.property.gstin).toBe(property!.gstin);
    expect(b.businessDate).toBe(property!.businessDate);
  });
});

describe("a day nobody has closed", () => {
  it("is exported with its figures and named, never treated as a zero", async () => {
    const b = await theBook();
    const closed = await sql(
      `select to_char(business_date, 'YYYY-MM-DD') as day
         from night_audit_runs
        where hotel_id = $1 and status = 'completed'
          and business_date between $2::date and $3::date`,
      [hotelId, from, to],
    );
    const shut = new Set(closed.rows.map((r) => r.day as string));

    expect(b.openDays).toEqual(b.days.filter((d) => !shut.has(d.date)).map((d) => d.date));
    for (const d of b.days) expect(d.closed).toBe(shut.has(d.date));

    /* The point of the whole column: an open day still carries what it
       has. Silence about a day is what an accountant files by mistake. */
    const open = b.days.filter((d) => !d.closed);
    for (const d of open) expect(typeof d.sales).toBe("number");
  });

  /* THE OTHER BRANCH, WHICH THE FIXTURE DOES NOT HOLD. The demo has no
     completed audit in the month at all, so every assertion above runs
     against `closed: false` and a column wired to the constant `false`
     would pass every one of them. So one day is closed here, read, and
     unclosed again - the scratch database is dropped after the run
     either way, but a test that leaves a closed day behind changes
     what every later file may post to (migration 012 refuses a posting
     on a closed date), and a cleanup nobody measures is a cleanup
     nobody has (root MEMORY 292). */
  it("says Closed for a day the night audit HAS run", async () => {
    const day = (await theBook()).days[0]!.date;
    const runs = () => sql(
      "select count(*)::int as n from night_audit_runs where hotel_id = $1 and business_date = $2::date",
      [hotelId, day],
    ).then((r) => r.rows[0]!.n as number);

    expect(await runs()).toBe(0);
    /* `completed_at` is NOT optional: `nar_completed_needs_finish`
       (migration 014) refuses a completed run with no finishing time,
       because the audit must insert `running`, post its charges, and only
       then mark itself complete - marking it complete first arms
       `app.reject_closed_business_date()` against the audit's own
       postings. Leaving it out is how the first version of this test
       failed with a constraint error that LOOKED like the guard working
       (ACC-9). */
    await sql(
      `insert into night_audit_runs (hotel_id, business_date, status, run_by, completed_at)
       values ($1, $2::date, 'completed', $3, now())`,
      [hotelId, day, ownerId],
    );
    try {
      const b = await theBook();
      expect(b.days[0]!.closed).toBe(true);
      expect(b.openDays).not.toContain(day);
    } finally {
      await sql(
        "delete from night_audit_runs where hotel_id = $1 and business_date = $2::date",
        [hotelId, day],
      );
    }

    /* Measured, not assumed. */
    expect(await runs()).toBe(0);
    expect((await theBook()).days[0]!.closed).toBe(false);
  });
});

describe("who may export, and what is refused", () => {
  it("answers the owner", async () => {
    const r = await book(`/5EL/accounting/day-book?from=${from}&to=${to}`);
    expect(r.status).toBe(200);
    expect(Array.isArray((r.body as DayBook).days)).toBe(true);
  });

  it("refuses reception, who holds `report` and is still not the three", async () => {
    const r = await book(`/5EL/accounting/day-book?from=${from}&to=${to}`, deskId);
    expect(r.status).toBe(403);
    expect((r.body as { error: string }).error).toMatch(/general manager/);
  });

  it("refuses a date that is not a date", async () => {
    expect((await book(`/5EL/accounting/day-book?from=25-08-2026&to=${to}`)).status).toBe(400);
    expect((await book(`/5EL/accounting/day-book?from=${from}&to=last%20tuesday`)).status).toBe(400);
    expect((await book(`/5EL/accounting/day-book?to=${to}`)).status).toBe(400);
  });

  it("refuses a last day that falls before the first", async () => {
    const r = await book(`/5EL/accounting/day-book?from=${to}&to=${from}`);
    expect(r.status).toBe(400);
    expect((r.body as { error: string }).error).toMatch(/before the first/);
  });

  it("refuses a range longer than a year", async () => {
    const r = await book("/5EL/accounting/day-book?from=2020-01-01&to=2026-12-31");
    expect(r.status).toBe(400);
    expect((r.body as { error: string }).error).toMatch(/a year at most/);

    /* And takes a whole one: 366 days inclusive is the boundary, not 365. */
    expect((await book("/5EL/accounting/day-book?from=2026-01-01&to=2026-12-31")).status).toBe(200);
  });

  it("answers 404 for a property that is not there", async () => {
    expect((await book(`/NOPE/accounting/day-book?from=${from}&to=${to}`)).status).toBe(404);
  });
});

/* ══════════════════════════════════════════════════════════════════
   THE ONE ASSERTION THIS SERVICE EXISTS FOR

   ⚠ WRITTEN 19 SEPTEMBER, AFTER AN AUDIT FOUND THE EXPORT UNDERSTATING
   EVERY DAY A MEAL WAS PAID FOR AT THE RESTAURANT.

   `dailyFigures` sums `folio_postings`, and a POS order only reaches a
   folio when it is charged TO A ROOM. Settled in cash, by card or by UPI
   at the outlet, it never touches one. So the Day Book's Sales was the
   hotel's revenue only, while the Manager report has always printed
   `Total Revenue = PMS Revenue + POS Revenue` — and the accountant was
   handed the smaller of the two.

   The branch's own tests could not see it: one pinned room charges, and
   the other compared the Day Book's extras against `sumDays(dailyFigures)`
   — BOTH SIDES OF THAT COMPARISON COME FROM THE SAME PARTIAL SOURCE, so
   it agreed with itself while both were wrong.

   This one makes the meal itself, in cash, and asks the export whether it
   can see it. That is the only shape that fails when a whole revenue
   stream goes missing.
   ══════════════════════════════════════════════════════════════════ */
describe("the export and the Manager report cannot disagree", () => {
  const TAG = `DAYBOOK-POS-${process.pid}`;

  afterAll(async () => {
    /* Only what this block made. The order's lines and tenders go with
       it; nothing else on the property is touched (MEMORY 292). */
    await sql(
      `delete from pos_orders where order_no like $1`, [`${TAG}%`]);
  });

  it("counts a meal paid for in cash at the restaurant, which never reaches a folio", async () => {
    const { rows: setup } = await sql(
      `select h.id::text as hotel,
              to_char(app.business_date(h.id), 'YYYY-MM-DD') as day,
              o.id::text as outlet,
              s.id::text as staff
         from hotels h
         join pos_outlets o on o.hotel_id = h.id and o.is_active
         join staff s on s.email = 'owner@fidato.in'
        where h.code = '5EL' limit 1`);
    expect(setup[0], "the demo property has an outlet").toBeTruthy();
    const { hotel, day, outlet, staff } = setup[0] as
      { hotel: string; day: string; outlet: string; staff: string };

    const before = await book(`/5EL/accounting/day-book?from=${day}&to=${day}`);
    const salesBefore = (before.body as { total: { sales: number } }).total.sales;

    /* One order, one line, settled in CASH at the outlet — so it lands
       in `pos_orders` and touches no folio, which is precisely the case
       that was invisible to this export.

       ⚠ IN THAT ORDER, AND THE LEDGER INSISTS ON IT. A settled order's
       lines cannot be changed — "Settle corrections with a credit on the
       folio, not by editing a paid bill." So the meal is rung up while
       the order is open and the order is settled afterwards, which is
       what a till does anyway. */
    const { rows: made } = await sql(
      `insert into pos_orders (hotel_id, outlet_id, order_no, business_date,
                               opened_by, status)
       values ($1, $2, $3, $4::date, $5, 'open') returning id::text`,
      [hotel, outlet, `${TAG}-1`, day, staff]);
    const orderId = made[0]!.id as string;

    await sql(
      `insert into pos_order_lines (hotel_id, order_id, item_id, name, qty, unit_price, tax_rate, added_by)
       select $2, $1, i.id, i.name, 2, 1200, coalesce(i.tax_rate, 0), $3
         from pos_menu_items i
         join pos_menu_categories c on c.id = i.category_id
        where c.hotel_id = $2 limit 1`,
      [orderId, hotel, staff]);

    const { rows: lines } = await sql(
      "select count(*)::int as n from pos_order_lines where order_id = $1", [orderId]);
    expect(lines[0]!.n, "the meal was rung up").toBe(1);

    /* Paid at the till. Cash deliberately: settled to a room would need
       a ticket and WOULD reach a folio, which is the case that already
       worked and is not what this is about. */
    await sql(
      `update pos_orders
          set status = 'settled', settled_by = $2, settled_at = now(),
              payment_method = 'cash'
        where id = $1`,
      [orderId, staff]);

    const after = await book(`/5EL/accounting/day-book?from=${day}&to=${day}`);
    expect(after.status).toBe(200);
    const body = after.body as
      { days: { date: string; pos: number; sales: number }[];
        total: { sales: number; pos: number } };
    const row = body.days.find((d) => d.date === day);
    expect(row, `the export has a row for ${day}`).toBeTruthy();

    /* ₹2,400 of food, paid for at the till. Before 19 September this was
       0 and Sales did not move. */
    expect(row!.pos, "the export sees what the restaurant sold").toBeGreaterThan(0);
    expect(body.total.sales, "and Sales grew by it")
      .toBeGreaterThan(salesBefore);
  });
});
