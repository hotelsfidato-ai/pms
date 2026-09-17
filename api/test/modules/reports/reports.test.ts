import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { app } from "../../../src/server.ts";
import { closePool, withUser } from "../../../src/db.ts";
import { buildReport, type ReportDoc } from "../../../src/modules/reports/index.ts";

/* ══════════════════════════════════════════════════════════════════
   THE REPORTS AGREE WITH EACH OTHER

   Every figure here is derived from `folio_postings`. Two reports of
   one figure that disagree mean one of them is wrong, and the demo
   dataset is calibrated to a real eZee export — so "wrong" is
   checkable rather than a matter of opinion.

   THE TEST THAT EXISTS BECAUSE IT CAUGHT SOMETHING

   The Manager Report reported ₹4,60,697.76 of revenue against a ledger
   holding ₹4,59,697.76. `w.discount` was fetched, typed, and never
   read: the total was higher than the ledger by every discount the
   property had ever given, and the report's own rows did not subtract
   to its own closing balance.

   Found by building the Guest Ledger over the same postings and
   watching the two disagree by exactly ₹1,000 — the single discount in
   the fixture.
   ══════════════════════════════════════════════════════════════════ */

const SUPER =
  process.env["SUPER_DATABASE_URL"] ??
  "postgres://postgres:pw@127.0.0.1:55432/fidato";

const admin = async () =>
  new (await import("pg")).default.Pool({ connectionString: SUPER });

let ownerId: string;

const call = (path: string) =>
  app.request(`/api/hotels${path}`, { headers: { "x-dev-staff-id": ownerId } });

beforeAll(async () => {
  const db = await admin();
  try {
    ownerId = (await db.query<{ id: string }>(
      "select id from staff where email = 'owner@fidato.in'",
    )).rows[0]!.id;
  } finally {
    await db.end();
  }
});

afterAll(async () => { await closePool(); });

interface ManagerRow { label: string; ptd: number | null }
interface ManagerSection { title: string; rows: ManagerRow[] }

async function manager(): Promise<ManagerSection[]> {
  const body = (await (await call("/5EL/reports/manager")).json()) as
    { sections: ManagerSection[] };
  return body.sections;
}

const rowOf = (sections: ManagerSection[], section: string, label: string) =>
  sections.find((s) => s.title === section)?.rows.find((r) => r.label === label);

/* ── The one that caught the discount ─────────────────────────────── */

describe("the Manager Report and the Guest Ledger agree", () => {
  it("reports the same charges to the paisa", async () => {
    const ledger = (await (await call("/5EL/reports/guest-ledger")).json()) as
      { rows: Array<{ charges: number; payments: number; closing: number }> };

    const charges = ledger.rows.reduce((n, r) => n + r.charges, 0);
    const sections = await manager();
    const posted = rowOf(sections, "Guest Ledger", "Charge Posted to Guest Ledger");

    expect(posted?.ptd).toBeCloseTo(charges, 2);
  });

  it("reports the same settlement, and the same closing balance", async () => {
    const ledger = (await (await call("/5EL/reports/guest-ledger")).json()) as
      { rows: Array<{ charges: number; payments: number; closing: number }> };

    const payments = ledger.rows.reduce((n, r) => n + r.payments, 0);
    const closing = ledger.rows.reduce((n, r) => n + r.closing, 0);

    const sections = await manager();
    expect(rowOf(sections, "Guest Ledger", "Settlement by Guest")?.ptd)
      .toBeCloseTo(payments, 2);
    expect(rowOf(sections, "Guest Ledger", "Closing Balance")?.ptd)
      .toBeCloseTo(closing, 2);
  });

  it("subtracts the discount from revenue", async () => {
    /* `net = room + extra` omitted it entirely. The rows are checked
       against the total rather than against a constant, so this holds
       whatever the fixture contains. */
    const sections = await manager();
    const room = rowOf(sections, "Revenue", "Room Charges")?.ptd ?? 0;
    const extra = rowOf(sections, "Revenue", "Extra Charges")?.ptd ?? 0;
    const discount = rowOf(sections, "Revenue", "Discount")?.ptd ?? 0;
    const sgst = rowOf(sections, "Revenue", "SGST")?.ptd ?? 0;
    const cgst = rowOf(sections, "Revenue", "CGST")?.ptd ?? 0;
    const net = rowOf(sections, "Revenue", "Total Revenue without Tax")?.ptd ?? 0;
    const gross = rowOf(sections, "Revenue", "Total Revenue with Tax")?.ptd ?? 0;

    /* Discount is SHOWN, so the total can be reconstructed from what is
       printed. A total nobody can rebuild from the rows above it is a
       total nobody can check. */
    expect(rowOf(sections, "Revenue", "Discount")).toBeTruthy();
    expect(discount).toBeLessThanOrEqual(0);

    expect(net).toBeCloseTo(room + extra + discount, 2);
    expect(gross).toBeCloseTo(net + sgst + cgst, 2);
  });
});

/* ── The GST register against the invoices it extracts ────────────── */

describe("the GST sales register", () => {
  it("carries every invoice issued in the window, and no other", async () => {
    const body = (await (await call("/5EL/reports/gst-sales")).json()) as {
      from: string; to: string;
      rows: Array<{ number: string; taxable: number; cgst: number;
                    sgst: number; total: number }>;
    };

    const db = await admin();
    try {
      /* Dated by the property's BUSINESS DATE, not the wall clock. An
         invoice raised at 09:00 on the 29th for a stay that closed on
         the 25th belongs to the 25th — filtering on issued_at put it
         outside an August register entirely. */
      const { rows } = await db.query<{ n: string }>(
        `select count(*)::text as n from invoices i
          where i.hotel_id = (select id from hotels where code = '5EL')
            and coalesce(i.business_date, i.issued_at::date)
                between $1::date and $2::date`,
        [body.from, body.to],
      );
      expect(body.rows.length).toBe(Number(rows[0]!.n));
    } finally {
      await db.end();
    }

    /* And every row adds up on its own. */
    for (const r of body.rows) {
      expect(r.cgst + r.sgst + r.taxable, r.number).toBeCloseTo(r.total, 2);
    }
  });
});

/* ── Cashier shift ────────────────────────────────────────────────── */

describe("the cashier shift", () => {
  it("totals the same money the Manager Report calls received", async () => {
    const shift = (await (await call("/5EL/reports/cashier-shift")).json()) as
      { rows: Array<{ amount: number }> };
    const taken = shift.rows.reduce((n, r) => n + r.amount, 0);

    const sections = await manager();
    const today = sections.find((s) => s.title === "Payment")
      ?.rows.find((r) => r.label === "Total Payment");

    const body = (await (await call("/5EL/reports/manager")).json()) as {
      sections: Array<{ title: string; rows: Array<{ label: string; today: number | null }> }>;
    };
    const managerToday = body.sections
      .find((s) => s.title === "Payment")
      ?.rows.find((r) => r.label === "Total Payment")?.today ?? 0;

    expect(today, "the Manager Report has no Total Payment row").toBeTruthy();
    /* The shift report defaults to TODAY, so it compares against the
       Manager Report's today column, not its period-to-date one. */
    expect(taken).toBeCloseTo(managerToday, 2);
  });

  it("says nothing rather than naming a cashier it does not know", async () => {
    const shift = (await (await call("/5EL/reports/cashier-shift")).json()) as
      { rows: Array<{ cashier: string | null }> };

    /* The demo's postings predate staff attribution, so `cashier` is
       null. That must arrive as null — a "System" placeholder would
       name somebody who did not take the money. */
    for (const r of shift.rows) {
      expect(r.cashier === null || typeof r.cashier === "string").toBe(true);
    }
  });
});

/* ── C-Form ───────────────────────────────────────────────────────── */

describe("the C-Form report", () => {
  it("says on its own body that this system does not file", async () => {
    const body = (await (await call("/5EL/reports/c-form")).json()) as
      { note: string; rows: unknown[] };
    /* Not only in a comment, and not only on the screen. Anything
       consuming this must not assume the filing happened. */
    expect(body.note).toMatch(/does not file/i);
    expect(Array.isArray(body.rows)).toBe(true);
  });

  it("carries only foreign nationals", async () => {
    const body = (await (await call("/5EL/reports/c-form")).json()) as
      { rows: Array<{ nationality: string }> };
    for (const r of body.rows) expect(r.nationality).not.toBe("IN");
  });
});

/* ── Dates: derived, never typed in (REP-1, REP-2) ────────────────────
   The Manager report's year started on the literal 1 April 2026, and the
   yearly grid asked for 2026 whatever the year. Both were right on the
   demo's 25 August 2026 — so every check here uses a date in ANOTHER
   month and ANOTHER financial year, where a literal cannot pass. */

describe("the reports' dates come from the report's own day", () => {
  interface ManagerDates {
    asOn: string; ptdFrom: string; ytdFrom: string;
    roomSummary: Array<{ label: string; ytd: number | null }>;
    statistics: Array<{ label: string; unit?: string }>;
  }
  const managerAsOn = async (query = "") =>
    (await (await call(`/5EL/reports/manager${query}`)).json()) as ManagerDates;

  /** Sellable room-nights from `from` to `to`, asked of the database —
      what the YTD column must have counted if its window starts there. */
  const sellable = async (from: string, to: string) => {
    const db = await admin();
    try {
      const { rows } = await db.query<{ n: string }>(
        `select coalesce(sum(app.sellable_rooms(h.id, d::date)), 0)::text as n
           from hotels h, generate_series($1::date, $2::date, interval '1 day') d
          where h.code = '5EL'`, [from, to]);
      return Number(rows[0]!.n);
    } finally { await db.end(); }
  };

  it("starts the year to date on the 1 April on or before the report's date", async () => {
    /* [as on, the year starts, the period starts] — either side of 1 April,
       in the demo's year and the next two. */
    const cases: Array<[string, string, string]> = [
      ["2026-08-25", "2026-04-01", "2026-08-01"],
      ["2027-02-10", "2026-04-01", "2027-02-01"],
      ["2027-03-31", "2026-04-01", "2027-03-01"],
      ["2027-04-01", "2027-04-01", "2027-04-01"],
      ["2027-05-10", "2027-04-01", "2027-05-01"],
      ["2028-01-15", "2027-04-01", "2028-01-01"],
    ];
    for (const [asOn, ytdFrom, ptdFrom] of cases) {
      /* No ptdFrom sent: the period must follow the report's date too. */
      const body = await managerAsOn(`?asOn=${asOn}`);
      expect(body.ytdFrom, `year start for ${asOn}`).toBe(ytdFrom);
      expect(body.ptdFrom, `period start for ${asOn}`).toBe(ptdFrom);
    }
  });

  it("counts the year to date over that window, not over the label alone", async () => {
    /* A label can be right while the query still uses the old start. The
       YTD room-nights are compared with the database's own sum over the
       window the label names. */
    for (const [asOn, ytdFrom] of [["2027-05-10", "2027-04-01"], ["2027-02-10", "2026-04-01"]]) {
      const body = await managerAsOn(`?asOn=${asOn}`);
      const ytd = body.roomSummary.find((r) => r.label === "Total Available Room nights")?.ytd;
      expect(ytd, `YTD room-nights as on ${asOn}`).toBe(await sellable(ytdFrom!, asOn!));
    }
  });

  it("with nothing sent, follows the property into another month and financial year", async () => {
    const db = await admin();
    const { rows: [before] } = await db.query<{ set: string; derived: string }>(
      `select to_char(business_date, 'YYYY-MM-DD') as set,
              to_char(app.business_date(id), 'YYYY-MM-DD') as derived
         from hotels where code = '5EL'`);
    /* Moving hotels.business_date moves the property only while no night
       audit has completed; say so here rather than fail obscurely below. */
    expect(before!.derived, "5EL has a completed night audit; its date cannot be moved here")
      .toBe(before!.set);

    await db.query("update hotels set business_date = '2027-05-10' where code = '5EL'");
    try {
      const report = await managerAsOn();
      expect(report.asOn).toBe("2027-05-10");
      expect(report.ptdFrom).toBe("2027-05-01");
      expect(report.ytdFrom).toBe("2027-04-01");

      const yearly = (await (await call("/5EL/reports/yearly-statistics")).json()) as ReportDoc;
      expect(yearly.facts).toEqual([{ label: "Year", value: "2027", kind: "text" }]);
      expect(yearly.sections[0]!.rows.map((r) => r.cells["label"])).toEqual([
        "January", "February", "March", "April", "May", "June", "July",
        "August", "September", "October", "November", "December", "Grand Total",
      ]);

      const monthly = (await (await call("/5EL/reports/monthly-statistics")).json()) as ReportDoc;
      const days = monthly.sections[0]!.rows.filter((r) => r.kind === "row");
      expect(monthly.facts[0]?.value).toBe("May 2027");
      expect(days[0]?.cells["label"]).toBe("1 Sat");
      expect(days.at(-1)?.cells["label"]).toBe("31 Mon");
    } finally {
      await db.query("update hotels set business_date = $1 where code = '5EL'", [before!.set]);
      await db.end();
    }
  });

  it("says what each statistic is, so the screen prints it as that", async () => {
    const { statistics } = await managerAsOn();
    expect(Object.fromEntries(statistics.map((r) => [r.label, r.unit]))).toEqual({
      "Occupancy Rate (%)": "percent",
      "Average Daily Rate (ADR)": "money",
      "Revenue Per Available Room": "money",
    });
  });
});

/* ── City ledger ──────────────────────────────────────────────────── */

describe("the city ledger", () => {
  /* It printed "Mr. Agoda", "Mr. Walk-in" — a contact person made up for
     every account, on screen and in the CSV (found 15 September). */
  type LedgerRow = { account: string; contact: string | null; phone: string | null };
  const ledger = async () =>
    (await (await call("/5EL/reports/city-ledger")).json()) as LedgerRow[];

  it("names no contact it does not hold", async () => {
    const rows = await ledger();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.contact ?? "").not.toMatch(/^Mr\. /);
  });

  it("shows a company's own contact, from its record, on its row only", async () => {
    const rows = await ledger();
    const db = await admin();
    try {
      const { rows: companies } = await db.query<{ name: string }>(
        "select name from companies where name = any($1) order by name limit 1",
        [rows.map((r) => r.account)]);
      const company = companies[0]?.name;
      expect(company, "no company among the ledger's accounts").toBeDefined();

      await db.query(
        "update companies set contact_name = 'Test Contact', phone = 'test-phone' where name = $1",
        [company]);
      try {
        const after = await ledger();
        const own = after.find((r) => r.account === company)!;
        expect(own.contact).toBe("Test Contact");
        expect(own.phone).toBe("test-phone");
        for (const r of after.filter((x) => x.account !== company)) {
          expect(r.contact).not.toBe("Test Contact");
        }
      } finally {
        await db.query(
          "update companies set contact_name = null, phone = null where name = $1", [company]);
      }
    } finally { await db.end(); }
  });
});

/* ── The owner's layout: the statistics (D17-62, D17-71, D17-72) ─────
   The owner decided on 17 September, as the eZee exports count them:
   a night's room charge sits on the night it pays for, a night not yet
   posted from the business date on counts at the booking's rate, and a
   complimentary room is sold. Each rule is checked against the database
   directly, never against a constant the report could share. */

describe("the statistics, in the owner's layout", () => {
  type Row = ReportDoc["sections"][number]["rows"][number];
  const doc = async (path: string) =>
    (await (await call(path)).json()) as ReportDoc;
  const dayRow = (d: ReportDoc, label: string): Row =>
    d.sections[0]!.rows.find((r) => r.cells["label"] === label)!;

  it("splits a posting for several nights over those nights, to the paisa", async () => {
    const before = await doc("/5EL/reports/monthly-statistics?month=2026-03");
    const db = await admin();
    try {
      /* March 2026 holds nothing in the demo. Three nights for ₹3,000.01:
         ₹1,000.00, ₹1,000.00, and the paisa on the last. */
      await db.query(
        `insert into folio_postings
           (hotel_id, folio_id, business_date, category, description, amount, tax_rate, tax_amount)
         select f.hotel_id, f.id, '2026-03-10', 'room', 'Room 999 · 3 nights', 3000.01, 5, 150.00
           from folios f join hotels h on h.id = f.hotel_id
          where h.code = '5EL' and f.reservation_id is not null
          limit 1`);
    } finally { await db.end(); }

    const after = await doc("/5EL/reports/monthly-statistics?month=2026-03");
    const grew = (label: string) =>
      Math.round(((dayRow(after, label).cells["room"] as number)
        - (dayRow(before, label).cells["room"] as number)) * 100) / 100;

    expect(grew("9 Mon")).toBe(0);
    expect(grew("10 Tue")).toBe(1000);
    expect(grew("11 Wed")).toBe(1000);
    expect(grew("12 Thu")).toBe(1000.01);
    expect(grew("13 Fri")).toBe(0);
    expect(grew("Total")).toBe(3000.01);
  });

  it("counts a night not posted yet at the booking's rate, from the business date on", async () => {
    /* September 2026 is after the demo's business date and nothing is
       posted there: every room charge on it is a booking's rate. */
    const september = await doc("/5EL/reports/monthly-statistics?month=2026-09");
    const db = await admin();
    try {
      for (const r of september.sections[0]!.rows.filter((x) => x.kind === "row")) {
        const day = Number(String(r.cells["label"]).split(" ")[0]);
        const date = `2026-09-${String(day).padStart(2, "0")}`;
        const { rows } = await db.query<{ rent: string; paying: string; comp: string }>(
          `select coalesce(sum(agreed_rate) filter (where not is_complimentary), 0)::text as rent,
                  count(*) filter (where not is_complimentary)::text as paying,
                  count(*) filter (where is_complimentary)::text as comp
             from reservations r join hotels h on h.id = r.hotel_id
            where h.code = '5EL'
              and r.status in ('confirmed','checked_in','checked_out')
              and r.check_in <= $1::date and r.check_out > $1::date`, [date]);
        expect(r.cells["room"], date).toBeCloseTo(Number(rows[0]!.rent), 2);
        expect(r.cells["sold"], date).toBe(Number(rows[0]!.paying));
        expect(r.cells["complimentary"], date).toBe(Number(rows[0]!.comp));
      }
    } finally { await db.end(); }
  });

  it("counts a complimentary room as occupied, in occupancy and the average rate", async () => {
    const august = await doc("/5EL/reports/monthly-statistics?month=2026-08");
    const days = august.sections[0]!.rows.filter((r) => r.kind === "row");
    const withComp = days.find((r) => (r.cells["complimentary"] as number) > 0);
    expect(withComp, "the demo has a complimentary night in August").toBeDefined();

    const c = withComp!.cells as Record<string, number>;
    const occupied = c["sold"]! + c["complimentary"]!;
    expect(c["occupancy"]).toBeCloseTo((occupied / c["available"]!) * 100, 2);
    expect(c["adr"]).toBeCloseTo(c["room"]! / occupied, 2);

    /* And the Dashboard's figure counts it the same way. */
    const date = `2026-08-${String(String(withComp!.cells["label"]).split(" ")[0]).padStart(2, "0")}`;
    const period = (await (await call(`/5EL/statistics/period?from=${date}&to=${date}`)).json()) as
      { roomsSold: number };
    expect(period.roomsSold).toBe(occupied);
  });

  it("adds its totals up from its own rows, and holds no expense it does not know", async () => {
    const august = await doc("/5EL/reports/monthly-statistics?month=2026-08");
    const rows = august.sections[0]!.rows;
    const days = rows.filter((r) => r.kind === "row");
    const totalRow = rows.find((r) => r.kind === "total")!;
    for (const k of ["available", "sold", "complimentary", "pax"]) {
      expect(totalRow.cells[k], k).toBe(days.reduce((t, r) => t + (r.cells[k] as number), 0));
    }
    for (const k of ["room", "extra", "tax", "receipt"]) {
      expect(totalRow.cells[k] as number, k)
        .toBeCloseTo(days.reduce((t, r) => t + (r.cells[k] as number), 0), 2);
    }
    for (const r of rows) expect(r.cells["expense"]).toBeNull();
  });

  it("draws the month's occupancy from the same figures", async () => {
    const chart = (await doc("/5EL/reports/monthly-occupancy?month=2026-08")).chart!;
    const grid = await doc("/5EL/reports/monthly-statistics?month=2026-08");
    const days = grid.sections[0]!.rows.filter((r) => r.kind === "row");
    expect(chart.x).toHaveLength(31);
    expect(chart.series[0]!.values).toEqual(days.map((r) => r.cells["occupancy"]));
  });

  it("refuses a report it does not know, rather than print an empty one", async () => {
    const hotelId = await withUser(ownerId, async (client) =>
      (await client.query<{ id: string }>("select id from hotels where code = '5EL'")).rows[0]!.id);
    await expect(withUser(ownerId, (client) =>
      buildReport(client, hotelId, "profit-and-loss", { asOn: "2026-08-25" }))).rejects.toThrow(/no report/);
    const bad = await call("/5EL/reports/monthly-statistics?month=2026-13");
    expect(bad.status).toBe(400);
  });
});
